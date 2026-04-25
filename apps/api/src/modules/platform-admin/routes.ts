import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  ilike,
  or,
  count,
} from "drizzle-orm";
import IORedis from "ioredis";
import { z } from "zod";
import { db, schema } from "@pettahpro/db";
import { hashPassword, verifyPassword } from "../identity/password.js";
import {
  buildOtpauthUri,
  buildQrCodeDataUrl,
  consumeBackupCode,
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  verifyTotp,
} from "../identity/mfa.js";
import {
  consumePlatformMfaChallenge,
  createPlatformMfaChallenge,
  readPlatformMfaChallenge,
} from "./mfa-challenge.js";
import {
  createPlatformSession,
  destroyAllPlatformSessionsForUser,
  destroyPlatformSession,
  readPlatformSession,
  type PlatformRole,
  type PlatformSession,
} from "./sessions.js";
import {
  PLATFORM_SESSION_COOKIE,
  clearPlatformCsrfCookie,
  clearPlatformSessionCookie,
  setPlatformCsrfCookie,
  setPlatformSessionCookie,
} from "./cookies.js";
import { recordPlatformAuditEvent } from "./audit.js";
import { buildSystemHealthPayload } from "../../plugins/system-health.js";
import { autoRemoveRedundantAddons } from "../../lib/plan-gate.js";
import { runRenewalCron } from "../subscription/renewal-cron.js";

const SESSION_TTL = 60 * 60 * 12; // match cookies.ts / sessions.ts

// Rate limits tuned for a human operator. Login gets a harder cap than
// the tenant login because the platform surface is smaller (one
// handful of admins, not thousands of users) and credential-stuffing
// here pays out much bigger than it does on a tenant login.
const LOGIN_RATE_LIMIT = { max: 5, timeWindow: "1 minute" };

const LoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

// #55 — MFA step-2 + enrol + disable. Same shape as the tenant side.
// Code envelope is deliberately loose (min 1 / max 20) — TOTP vs backup
// is distinguished at verify time by testing the 6-digit shape first.
const LoginMfaSchema = z.object({
  challengeId: z.string().min(1).max(128),
  code: z.string().min(1).max(20),
});

const MfaVerifyEnrollSchema = z.object({
  tempToken: z.string().min(1).max(128),
  code: z.string().min(6).max(10),
});

const MfaDisableSchema = z.object({
  code: z.string().min(1).max(20),
});

const SuspendSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

const ReactivateSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

// List query — small + flat. Status filter accepts the current shape
// of tenants.status plus "all". Search is substring on slug + business
// name, case-insensitive.
const ListTenantsQuerySchema = z.object({
  status: z
    .enum(["all", "active", "suspended", "trial", "past-due", "churned"])
    .optional()
    .default("all"),
  // #66 — Plan / subscription filters. These live alongside the existing
  // `status` (tenant-lifecycle) filter because the two concepts drifted
  // apart once #61 introduced its own subscriptions.status. Billing ops
  // typically filters on subscription state ("who's past_due?"), lifecycle
  // ops filters on tenant state ("who did we suspend?"). Both stay.
  plan: z.string().trim().max(32).optional(),
  subscriptionStatus: z
    .enum(["all", "trial", "active", "past_due", "cancelled"])
    .optional()
    .default("all"),
  // "Trials ending in the next 7 days" shortcut for revenue outreach.
  // Narrower window than the trial_ends_at ever — we want the list ops
  // should call TODAY, not the full trial pool.
  trialEndingSoon: z
    .union([z.literal("true"), z.literal("false"), z.literal("")])
    .optional(),
  search: z.string().trim().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const PLATFORM_ROLE_VALUES: readonly PlatformRole[] = [
  "super_admin",
  "support",
  "billing",
];

/**
 * Narrow a string off the DB into the PlatformRole union. Unknown values
 * fall back to super_admin so a corrupt row never silently strips
 * privileges (fail-open on the role column is deliberate — the CHECK
 * constraint on the column is the real enforcement, this is belt-and-braces
 * for TypeScript). If you ever see "super_admin" where you expected
 * another role, chase the CHECK constraint — the column got bypassed.
 */
export function asPlatformRole(value: string): PlatformRole {
  return (PLATFORM_ROLE_VALUES as readonly string[]).includes(value)
    ? (value as PlatformRole)
    : "super_admin";
}

/**
 * #56 — role gate. `requireRole(session, ["super_admin"])` etc. Returns
 * true if the session's role is in the allowlist, otherwise writes a
 * 403 and returns false. Also audits the denied attempt so we can
 * spot a compromised support-role credential probing higher-privilege
 * endpoints.
 */
export async function requirePlatformRole(
  req: FastifyRequest,
  reply: FastifyReply,
  session: PlatformSession,
  allowed: readonly PlatformRole[],
): Promise<boolean> {
  if (allowed.includes(session.role)) return true;
  await recordPlatformAuditEvent({
    platformUserId: session.platformUserId,
    platformUserEmail: session.email,
    kind: "platform.forbidden",
    summary: `Role ${session.role} denied on ${req.method} ${req.url}`,
    tenantId: null,
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
    metadata: { allowed: [...allowed], role: session.role, path: req.url },
  });
  reply.status(403).send({
    error: {
      code: "FORBIDDEN",
      message: "Your role can't perform this action.",
    },
  });
  return false;
}

/**
 * Pull the platform session off the signed cookie. Returns null and
 * writes the 401 for the caller so routes read top-to-bottom.
 */
export async function requirePlatformSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<PlatformSession | null> {
  const cookie = req.cookies[PLATFORM_SESSION_COOKIE];
  if (!cookie) {
    reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    return null;
  }
  const unsigned = req.unsignCookie(cookie);
  if (!unsigned.valid || !unsigned.value) {
    reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    return null;
  }
  const session = await readPlatformSession(unsigned.value);
  if (!session) {
    reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    return null;
  }
  return session;
}

export const platformAdminRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------
  // Auth: login, logout, me.
  // -------------------------------------------------------------------
  fastify.post(
    "/auth/login",
    { config: { rateLimit: LOGIN_RATE_LIMIT } },
    async (req, reply) => {
      const parsed = LoginSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const { email, password } = parsed.data;

      const rows = await db
        .select()
        .from(schema.platformUsers)
        .where(
          and(
            eq(schema.platformUsers.email, email),
            isNull(schema.platformUsers.deletedAt),
          ),
        )
        .limit(1);
      const user = rows[0];

      // Generic error on any failure mode so we don't enumerate which
      // field is wrong. Inactive and not-found look the same to the
      // client.
      const invalid = () =>
        reply.status(401).send({
          error: { code: "INVALID_CREDENTIALS", message: "Wrong email or password." },
        });

      if (!user || !user.isActive) {
        // Still run a dummy verify so the timing between "user not
        // found" and "wrong password" is indistinguishable.
        await verifyPassword(
          "$argon2id$v=19$m=19456,t=2,p=1$cGxhY2Vob2xkZXI$cGxhY2Vob2xkZXI",
          password,
        ).catch(() => false);
        return invalid();
      }

      const ok = await verifyPassword(user.passwordHash, password);
      if (!ok) return invalid();

      // #55 — If this platform user has MFA enabled, don't mint the
      // session on password alone. Same shape as the tenant login: stash
      // a pre-session challenge in Redis (5-min TTL) and return the
      // challenge ID. The real session comes from /auth/login/mfa after
      // the code verifies.
      const hasMfaRows = (await db.execute(
        sql`SELECT platform_user_has_mfa(${user.id}::uuid) AS has_mfa`,
      )) as unknown as Array<{ has_mfa: boolean }>;
      const hasMfa = hasMfaRows[0]?.has_mfa ?? false;

      if (hasMfa) {
        const challenge = await createPlatformMfaChallenge({
          platformUserId: user.id,
          email: user.email,
          ip: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
        return reply.send({ mfaRequired: true, challengeId: challenge.id });
      }

      await db
        .update(schema.platformUsers)
        .set({ lastLoginAt: new Date() })
        .where(eq(schema.platformUsers.id, user.id));

      const session = await createPlatformSession({
        platformUserId: user.id,
        email: user.email,
        role: asPlatformRole(user.role),
        ttlSeconds: SESSION_TTL,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      setPlatformSessionCookie(reply, session.id, SESSION_TTL);
      setPlatformCsrfCookie(reply, session.csrfToken, SESSION_TTL);

      await recordPlatformAuditEvent({
        platformUserId: user.id,
        platformUserEmail: user.email,
        kind: "platform.login",
        summary: `Platform login: ${user.email}`,
        tenantId: null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return reply.send({
        user: { id: user.id, email: user.email, fullName: user.fullName },
      });
    },
  );

  // #55 — Platform login step 2. Pre-session (no cookie yet). Takes the
  // challengeId from step 1 + the submitted TOTP or backup code, verifies
  // against the encrypted secret (+ hashed backup codes), and mints the
  // real session on success. Tight rate limit — same rationale as tenant
  // side: 6-digit space + ±1 step window = 3 valid codes per 90s, 5/min
  // exhausts the code space far slower than the 5-min challenge TTL.
  fastify.post(
    "/auth/login/mfa",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = LoginMfaSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const { challengeId, code } = parsed.data;

      const challenge = await readPlatformMfaChallenge(challengeId);
      if (!challenge) {
        return reply.status(401).send({
          error: {
            code: "MFA_CHALLENGE_EXPIRED",
            message: "This sign-in attempt has expired. Please start again.",
          },
        });
      }

      const mfaRows = (await db.execute(
        sql`SELECT * FROM platform_get_mfa_for_user(${challenge.platformUserId}::uuid)`,
      )) as unknown as Array<{
        platform_user_id: string;
        totp_secret_encrypted: string;
        backup_codes_hash: string[];
        enabled: boolean;
      }>;
      const mfa = mfaRows[0];
      if (!mfa || !mfa.enabled) {
        // Defensive: challenge existed but MFA row vanished. Consume
        // the challenge and treat as expired — don't silently fall back
        // to password-only, that would defeat the whole point.
        await consumePlatformMfaChallenge(challengeId);
        return reply.status(401).send({
          error: { code: "MFA_CHALLENGE_EXPIRED", message: "Please sign in again." },
        });
      }

      let verified = false;
      let consumedBackup = false;
      let remainingBackupHashes: string[] | null = null;

      try {
        const secret = decryptSecret(mfa.totp_secret_encrypted);
        if (/^\d{6}$/.test(code.replace(/\s+/g, ""))) {
          verified = verifyTotp(secret, code);
        }
      } catch (err) {
        req.log.error({ err }, "platform mfa totp decrypt failed");
      }

      if (!verified) {
        const remaining = await consumeBackupCode(code, mfa.backup_codes_hash);
        if (remaining !== null) {
          verified = true;
          consumedBackup = true;
          remainingBackupHashes = remaining;
        }
      }

      if (!verified) {
        // Audit failed attempts. Platform audit log is not tenant-scoped
        // so this is a straight insert; failures in the audit layer are
        // swallowed inside recordPlatformAuditEvent.
        await recordPlatformAuditEvent({
          platformUserId: challenge.platformUserId,
          platformUserEmail: challenge.email,
          kind: "platform.mfa_challenge_failed",
          summary: `Platform MFA challenge failed for ${challenge.email}`,
          tenantId: null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
        return reply.status(401).send({
          error: { code: "MFA_INVALID_CODE", message: "Wrong code. Try again." },
        });
      }

      // Success — consume challenge, stamp last_used_at + optionally
      // shortened backup array, bump last_login_at, mint session.
      await consumePlatformMfaChallenge(challengeId);
      await db.execute(
        sql`SELECT platform_record_mfa_success(${challenge.platformUserId}::uuid, ${
          remainingBackupHashes
        }::text[])`,
      );
      // #56 — pull the current role off the DB so the session is minted
      // with the latest value (a role change between challenge-issue
      // and MFA-verify would otherwise stamp a stale role onto the
      // session). The row is guaranteed to exist + be active because
      // /auth/login already checked.
      const roleRows = await db
        .select({ role: schema.platformUsers.role })
        .from(schema.platformUsers)
        .where(eq(schema.platformUsers.id, challenge.platformUserId))
        .limit(1);
      const userRole = asPlatformRole(roleRows[0]?.role ?? "super_admin");

      await db
        .update(schema.platformUsers)
        .set({ lastLoginAt: new Date() })
        .where(eq(schema.platformUsers.id, challenge.platformUserId));

      const session = await createPlatformSession({
        platformUserId: challenge.platformUserId,
        email: challenge.email,
        role: userRole,
        ttlSeconds: SESSION_TTL,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      setPlatformSessionCookie(reply, session.id, SESSION_TTL);
      setPlatformCsrfCookie(reply, session.csrfToken, SESSION_TTL);

      await recordPlatformAuditEvent({
        platformUserId: challenge.platformUserId,
        platformUserEmail: challenge.email,
        kind: "platform.login",
        summary: consumedBackup
          ? `Platform login: ${challenge.email} (MFA backup code)`
          : `Platform login: ${challenge.email} (MFA)`,
        tenantId: null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return reply.send({
        user: {
          id: challenge.platformUserId,
          email: challenge.email,
          // fullName is supplied by /auth/me on the next round-trip —
          // keeping this response narrow avoids surfacing a user shape
          // that the enrolment path doesn't know.
          fullName: "",
        },
        backupCodesRemaining: consumedBackup
          ? (remainingBackupHashes?.length ?? 0)
          : mfa.backup_codes_hash.length,
      });
    },
  );

  fastify.post("/auth/logout", async (req, reply) => {
    const cookie = req.cookies[PLATFORM_SESSION_COOKIE];
    if (cookie) {
      const unsigned = req.unsignCookie(cookie);
      if (unsigned.valid && unsigned.value) {
        const session = await readPlatformSession(unsigned.value);
        await destroyPlatformSession(unsigned.value);
        if (session) {
          await recordPlatformAuditEvent({
            platformUserId: session.platformUserId,
            platformUserEmail: session.email,
            kind: "platform.logout",
            summary: `Platform logout: ${session.email}`,
            tenantId: null,
            ipAddress: req.ip ?? null,
            userAgent: req.headers["user-agent"] ?? null,
          });
        }
      }
    }
    clearPlatformSessionCookie(reply);
    clearPlatformCsrfCookie(reply);
    return reply.send({ ok: true });
  });

  fastify.get("/auth/me", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const rows = await db
      .select({
        id: schema.platformUsers.id,
        email: schema.platformUsers.email,
        fullName: schema.platformUsers.fullName,
        isActive: schema.platformUsers.isActive,
      })
      .from(schema.platformUsers)
      .where(
        and(
          eq(schema.platformUsers.id, session.platformUserId),
          isNull(schema.platformUsers.deletedAt),
        ),
      )
      .limit(1);
    const user = rows[0];
    if (!user || !user.isActive) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    }

    // #55 — let the web layer know whether MFA is on so /platform/account
    // can render "enabled" vs "not enrolled" without a second round-trip.
    const mfaRows = (await db.execute(
      sql`SELECT platform_user_has_mfa(${user.id}::uuid) AS enabled`,
    )) as unknown as Array<{ enabled: boolean }>;
    const mfaEnabled = mfaRows[0]?.enabled ?? false;

    // #56 — role is returned so the web shell can render role-aware UI
    // (hide suspend buttons for support/billing, show/hide the Staff
    // sidebar for non-super_admin). We deliberately read the role from
    // the *session* rather than re-querying the DB: the session cache
    // is invalidated on role change, so it can't go stale in a way that
    // upgrades privilege. Worst case the UI shows a stale *narrower*
    // role for up to one request, then the server 403s and the client
    // refetches.
    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: session.role,
      },
      mfa: { enabled: mfaEnabled },
    });
  });

  // -------------------------------------------------------------------
  // Change own password. The only self-service account management we
  // expose in v0 — the rest (user management, role separation) comes
  // with L1 v1. For now the CLI seeds the first user; extras are
  // inserted via psql.
  // -------------------------------------------------------------------
  const ChangePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12).max(256),
  });

  fastify.post(
    "/auth/change-password",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;

      const parsed = ChangePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const { currentPassword, newPassword } = parsed.data;
      if (currentPassword === newPassword) {
        return reply.status(400).send({
          error: {
            code: "WEAK_PASSWORD",
            message: "Pick a password you haven't used here before.",
          },
        });
      }

      const rows = await db
        .select({
          id: schema.platformUsers.id,
          email: schema.platformUsers.email,
          passwordHash: schema.platformUsers.passwordHash,
        })
        .from(schema.platformUsers)
        .where(eq(schema.platformUsers.id, session.platformUserId))
        .limit(1);
      const user = rows[0];
      if (!user) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

      const ok = await verifyPassword(user.passwordHash, currentPassword);
      if (!ok) {
        return reply.status(400).send({
          error: { code: "WRONG_CURRENT_PASSWORD", message: "Current password didn't match." },
        });
      }

      const newHash = await hashPassword(newPassword);
      await db
        .update(schema.platformUsers)
        .set({ passwordHash: newHash, updatedAt: new Date() })
        .where(eq(schema.platformUsers.id, user.id));

      await recordPlatformAuditEvent({
        platformUserId: user.id,
        platformUserEmail: user.email,
        kind: "platform.password_changed",
        summary: `Changed own platform password (${user.email})`,
        tenantId: null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return reply.send({ ok: true });
    },
  );

  // -------------------------------------------------------------------
  // #55 — MFA (TOTP) enrol / verify / disable / status for platform
  // users. Exact structural parallel to the tenant-side flow in
  // identity/routes.ts — same two-step enrolment (Redis-held pending
  // secret + DB commit on verify), same disable invariant (requires a
  // valid code, not just a session), same hashed-backup-codes shape.
  // -------------------------------------------------------------------

  // 10-min Redis keyspace for pending enrolments. Separate prefix from
  // the tenant side so a captured tempToken can't cross realms.
  const PLATFORM_MFA_ENROL_PREFIX = "platform-mfa-enrol:";
  const PLATFORM_MFA_ENROL_TTL = 10 * 60;
  const platformEnrolRedis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

  fastify.post(
    "/auth/mfa/enroll",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;

      // Block re-enrolment when already enabled — users who want to
      // rotate disable first, then re-enrol. Two clicks is fine for a
      // rare path.
      const existingRows = (await db.execute(
        sql`SELECT platform_user_has_mfa(${session.platformUserId}::uuid) AS enabled`,
      )) as unknown as Array<{ enabled: boolean }>;
      if (existingRows[0]?.enabled) {
        return reply.status(409).send({
          error: {
            code: "MFA_ALREADY_ENABLED",
            message: "MFA is already enabled. Disable it first to re-enrol.",
          },
        });
      }

      const secret = generateTotpSecret();
      const otpauthUri = buildOtpauthUri(session.email, secret);
      let qrCodeDataUrl: string | null = null;
      try {
        qrCodeDataUrl = await buildQrCodeDataUrl(otpauthUri);
      } catch (err) {
        // Non-fatal — the otpauth URI + raw secret fallback are still
        // returned and every serious TOTP app accepts manual entry.
        req.log.warn({ err }, "platform mfa qr render failed, returning URI only");
      }

      const tempToken = randomBytes(18).toString("base64url");
      await platformEnrolRedis.set(
        PLATFORM_MFA_ENROL_PREFIX + tempToken,
        JSON.stringify({ platformUserId: session.platformUserId, secret }),
        "EX",
        PLATFORM_MFA_ENROL_TTL,
      );

      return reply.send({
        tempToken,
        otpauthUri,
        secret,
        qrCodeDataUrl,
      });
    },
  );

  fastify.post(
    "/auth/mfa/enroll/verify",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;

      const parsed = MfaVerifyEnrollSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const { tempToken, code } = parsed.data;

      const raw = await platformEnrolRedis.get(PLATFORM_MFA_ENROL_PREFIX + tempToken);
      if (!raw) {
        return reply.status(400).send({
          error: { code: "MFA_ENROLL_EXPIRED", message: "Enrolment timed out. Start again." },
        });
      }
      let pending: { platformUserId: string; secret: string };
      try {
        pending = JSON.parse(raw);
      } catch {
        return reply.status(400).send({
          error: { code: "MFA_ENROLL_EXPIRED", message: "Enrolment timed out. Start again." },
        });
      }

      // Defend against a captured tempToken from another tab — the
      // pending record must belong to the same platform user.
      if (pending.platformUserId !== session.platformUserId) {
        return reply.status(400).send({
          error: { code: "MFA_ENROLL_EXPIRED", message: "Enrolment timed out. Start again." },
        });
      }

      if (!verifyTotp(pending.secret, code)) {
        return reply.status(400).send({
          error: { code: "MFA_INVALID_CODE", message: "That code didn't match. Try again." },
        });
      }

      const backupCodes = generateBackupCodes();
      const hashes = await hashBackupCodes(backupCodes);
      const encrypted = encryptSecret(pending.secret);

      await db.execute(sql`
        INSERT INTO platform_user_mfa (
          platform_user_id, totp_secret_encrypted, backup_codes_hash,
          enabled, enrolled_at, created_at, updated_at
        ) VALUES (
          ${session.platformUserId}::uuid, ${encrypted}, ${hashes}::text[],
          true, now(), now(), now()
        )
        ON CONFLICT (platform_user_id) DO UPDATE SET
          totp_secret_encrypted = EXCLUDED.totp_secret_encrypted,
          backup_codes_hash = EXCLUDED.backup_codes_hash,
          enabled = true,
          enrolled_at = now(),
          updated_at = now()
      `);

      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.mfa_enrolled",
        summary: `Enabled platform two-factor auth (${session.email})`,
        tenantId: null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      await platformEnrolRedis.del(PLATFORM_MFA_ENROL_PREFIX + tempToken);

      return reply.send({ ok: true, backupCodes });
    },
  );

  fastify.post(
    "/auth/mfa/disable",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;

      const parsed = MfaDisableSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const { code } = parsed.data;

      const rows = await db
        .select({
          totpSecretEncrypted: schema.platformUserMfa.totpSecretEncrypted,
          backupCodesHash: schema.platformUserMfa.backupCodesHash,
        })
        .from(schema.platformUserMfa)
        .where(eq(schema.platformUserMfa.platformUserId, session.platformUserId))
        .limit(1);
      const mfaRow = rows[0];
      if (!mfaRow) {
        // Idempotent: if MFA was already off, a disable request is a
        // harmless no-op. Don't 404 — that would leak the state.
        return reply.send({ ok: true });
      }

      // Require a valid TOTP OR backup code to disable. The whole point
      // of this gate is that a stolen session cookie alone must not be
      // enough to silently disarm the second factor.
      let verified = false;
      try {
        const secret = decryptSecret(mfaRow.totpSecretEncrypted);
        if (/^\d{6}$/.test(code.replace(/\s+/g, ""))) {
          verified = verifyTotp(secret, code);
        }
      } catch (err) {
        req.log.error({ err }, "platform mfa disable: decrypt failed");
      }
      if (!verified) {
        const remaining = await consumeBackupCode(code, mfaRow.backupCodesHash);
        if (remaining !== null) verified = true;
      }

      if (!verified) {
        return reply.status(400).send({
          error: {
            code: "MFA_INVALID_CODE",
            message:
              "That code didn't match. Enter a current code from your authenticator (or a backup code) to turn MFA off.",
          },
        });
      }

      await db
        .delete(schema.platformUserMfa)
        .where(eq(schema.platformUserMfa.platformUserId, session.platformUserId));

      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.mfa_disabled",
        summary: `Disabled platform two-factor auth (${session.email})`,
        tenantId: null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return reply.send({ ok: true });
    },
  );

  fastify.get("/auth/mfa/status", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const rows = await db
      .select({
        enabled: schema.platformUserMfa.enabled,
        enrolledAt: schema.platformUserMfa.enrolledAt,
        lastUsedAt: schema.platformUserMfa.lastUsedAt,
        backupCodesHash: schema.platformUserMfa.backupCodesHash,
      })
      .from(schema.platformUserMfa)
      .where(eq(schema.platformUserMfa.platformUserId, session.platformUserId))
      .limit(1);
    const row = rows[0];

    return reply.send({
      enabled: row?.enabled ?? false,
      enrolledAt: row?.enrolledAt ?? null,
      lastUsedAt: row?.lastUsedAt ?? null,
      backupCodesRemaining: row ? row.backupCodesHash.length : 0,
    });
  });

  // -------------------------------------------------------------------
  // Tenant directory + detail.
  //
  // These are the core v0 reads. Privacy-respecting columns only (spec
  // §3.1) — business name, slug, status, country, created, user count,
  // last-active. We do NOT join any tenant-scoped data (invoices,
  // payments) — those are off-limits from the platform console.
  // -------------------------------------------------------------------

  fastify.get("/tenants", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const parsed = ListTenantsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const {
      status,
      plan,
      subscriptionStatus,
      trialEndingSoon,
      search,
      limit,
      offset,
    } = parsed.data;

    // Filter clauses. Status "all" is a no-op.
    const clauses = [isNull(schema.tenants.deletedAt)];
    if (status !== "all") {
      clauses.push(eq(schema.tenants.status, status));
    }
    if (search && search.length > 0) {
      const pat = `%${search}%`;
      const matcher = or(
        ilike(schema.tenants.businessName, pat),
        ilike(schema.tenants.slug, pat),
      );
      if (matcher) clauses.push(matcher);
    }
    // Subscription / plan filters (#66). tenant_subscriptions has no RLS
    // (#61) so we can join + filter server-side. plans.code is unique,
    // so filtering by plan code is O(index-seek) even on big tables.
    if (subscriptionStatus !== "all") {
      clauses.push(eq(schema.tenantSubscriptions.status, subscriptionStatus));
    }
    if (plan && plan.length > 0) {
      clauses.push(eq(schema.plans.code, plan));
    }
    // "Ends in the next 7 days AND not past it yet". The grace-period
    // job (#63) flips past_due → cancelled 7 days AFTER trial_ends_at,
    // so this window gives ops a full 7 days of notice before any
    // automation fires. We require subscriptionStatus='trial' implicitly
    // via trial_ends_at IS NOT NULL + being in the future.
    if (trialEndingSoon === "true") {
      clauses.push(isNotNull(schema.tenantSubscriptions.trialEndsAt));
      clauses.push(
        sql`${schema.tenantSubscriptions.trialEndsAt} >= NOW()`,
      );
      clauses.push(
        sql`${schema.tenantSubscriptions.trialEndsAt} < NOW() + interval '7 days'`,
      );
    }

    // Correlated subqueries for user count + last login per tenant.
    // Tenants table has no RLS so a direct query works; users/mfa do
    // have RLS but the aggregate-over-all-tenants case is served by
    // the `no app.tenant_id set` short-circuit — at the DB layer we'll
    // paginate via COUNT(*) over users with tenant_id in the returned
    // list instead. Simpler: LATERAL subqueries. Since LATERAL on a
    // column from outer won't go through RLS cleanly, use a separate
    // aggregate pull after the main tenant list and stitch client-side.
    const whereClause = and(...clauses);
    // LEFT JOIN subscription + plan so a tenant without a subscription row
    // (pre-backfill gap) still appears in the list — the UI just shows "—"
    // for plan. If we INNER-joined, those tenants would vanish and ops
    // would have no way to find them.
    const tenants = await db
      .select({
        id: schema.tenants.id,
        slug: schema.tenants.slug,
        businessName: schema.tenants.businessName,
        country: schema.tenants.country,
        timezone: schema.tenants.timezone,
        status: schema.tenants.status,
        createdAt: schema.tenants.createdAt,
        notes: schema.tenants.notes,
        subscriptionStatus: schema.tenantSubscriptions.status,
        billingCycle: schema.tenantSubscriptions.billingCycle,
        trialEndsAt: schema.tenantSubscriptions.trialEndsAt,
        currentPeriodEnd: schema.tenantSubscriptions.currentPeriodEnd,
        planCode: schema.plans.code,
        planName: schema.plans.name,
      })
      .from(schema.tenants)
      .leftJoin(
        schema.tenantSubscriptions,
        eq(schema.tenantSubscriptions.tenantId, schema.tenants.id),
      )
      .leftJoin(
        schema.plans,
        eq(schema.plans.id, schema.tenantSubscriptions.planId),
      )
      .where(whereClause)
      .orderBy(desc(schema.tenants.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ count: count() })
      .from(schema.tenants)
      .leftJoin(
        schema.tenantSubscriptions,
        eq(schema.tenantSubscriptions.tenantId, schema.tenants.id),
      )
      .leftJoin(
        schema.plans,
        eq(schema.plans.id, schema.tenantSubscriptions.planId),
      )
      .where(whereClause);
    const total = totalRows[0]?.count ?? 0;

    // Per-tenant aggregates. One batched query each so we don't N+1
    // the list page. Users live under RLS but SECURITY DEFINER isn't
    // needed here — the aggregate helpers below go through raw SQL
    // against the tables with explicit tenant_id IN (...) filters, and
    // the app role is granted SELECT on users anyway. With RLS
    // enabled, the filter still requires app.tenant_id to be set —
    // which it isn't for cross-tenant reads. Use a short SECURITY
    // DEFINER helper? No — simpler is to read the counts via the
    // raw pool that bypasses RLS (db connection with BYPASSRLS), or
    // a SECURITY DEFINER helper. We'll use a small helper function.
    const ids = tenants.map((t) => t.id);
    const aggregates = new Map<
      string,
      { userCount: number; lastLoginAt: Date | null }
    >();
    if (ids.length > 0) {
      // IN(...) with per-element ::uuid casts: postgres.js serializes a JS
      // string[] as a record, so `ANY(${ids}::uuid[])` errors with 42846.
      // postgres.js serializes a plain JS string[] as a composite
      // record rather than a pg array, so `$1::uuid[]` blows up with
      // "cannot cast type record to uuid[]". Build an explicit
      // parametrised IN list via sql.join instead — each id is cast
      // individually and the driver binds them as uuids.
      const idSql = sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const aggRows = (await db.execute(
        sql`
          SELECT t.id AS tenant_id,
                 platform_count_users(t.id) AS user_count,
                 platform_last_login(t.id)  AS last_login_at
            FROM tenants t
           WHERE t.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
           WHERE t.id IN (${idSql})
        `,
      )) as unknown as Array<{
        tenant_id: string;
        user_count: number | string;
        last_login_at: Date | string | null;
      }>;
      for (const r of aggRows) {
        aggregates.set(r.tenant_id, {
          userCount: Number(r.user_count) || 0,
          lastLoginAt: r.last_login_at
            ? new Date(r.last_login_at as string | Date)
            : null,
        });
      }
    }

    return reply.send({
      total,
      limit,
      offset,
      tenants: tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        businessName: t.businessName,
        country: t.country,
        timezone: t.timezone,
        status: t.status,
        createdAt: t.createdAt,
        notes: t.notes,
        userCount: aggregates.get(t.id)?.userCount ?? 0,
        lastLoginAt: aggregates.get(t.id)?.lastLoginAt ?? null,
        // #66 — plan + subscription summary. All nullable: a tenant with
        // no subscription row (pre-backfill) returns null for each, which
        // the UI renders as "—".
        planCode: t.planCode,
        planName: t.planName,
        subscriptionStatus: t.subscriptionStatus,
        billingCycle: t.billingCycle,
        trialEndsAt: t.trialEndsAt,
        currentPeriodEnd: t.currentPeriodEnd,
      })),
    });
  });

  fastify.get("/tenants/:id", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const tenantId = paramsParsed.data.id;

    const rows = await db
      .select()
      .from(schema.tenants)
      .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)))
      .limit(1);
    const tenant = rows[0];
    if (!tenant) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }

    const aggRows = (await db.execute(
      sql`SELECT platform_count_users(${tenantId}::uuid) AS user_count,
                  platform_last_login(${tenantId}::uuid)  AS last_login_at`,
    )) as unknown as Array<{
      user_count: number | string;
      last_login_at: Date | string | null;
    }>;
    const userCount = Number(aggRows[0]?.user_count) || 0;
    const lastLoginAt = aggRows[0]?.last_login_at
      ? new Date(aggRows[0].last_login_at as string | Date)
      : null;

    return reply.send({
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        businessName: tenant.businessName,
        country: tenant.country,
        timezone: tenant.timezone,
        status: tenant.status,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
        notes: tenant.notes,
        userCount,
        lastLoginAt,
      },
    });
  });

  // Anonymised user list for a tenant (spec §4.4). Returns role +
  // last-login only; email is revealed only when the caller passes
  // ?reveal=1 AND writes an audit line. v0 keeps this simple — no
  // ticket number gate — but the reveal itself is logged.
  const TenantUsersQuerySchema = z.object({
    reveal: z.coerce.boolean().optional().default(false),
    reason: z.string().trim().max(2000).optional(),
  });

  fastify.get("/tenants/:id/users", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const queryParsed = TenantUsersQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const tenantId = paramsParsed.data.id;
    const { reveal, reason } = queryParsed.data;

    if (reveal && (!reason || reason.length < 3)) {
      return reply.status(400).send({
        error: {
          code: "REASON_REQUIRED",
          message: "Pass a reason (e.g. ticket reference) to reveal email addresses.",
        },
      });
    }

    // #56 — reveal is the PII-sensitive mode. Only super_admin + support
    // can see raw emails; billing is locked to the anonymised list. The
    // role gate here is in addition to the audit trail — billing
    // shouldn't even be able to touch raw PII accidentally.
    if (
      reveal &&
      !(await requirePlatformRole(req, reply, session, ["super_admin", "support"]))
    ) {
      return;
    }

    const rows = (await db.execute(
      sql`SELECT * FROM platform_list_tenant_users(${tenantId}::uuid)`,
    )) as unknown as Array<{
      id: string;
      email: string;
      full_name: string;
      is_owner: boolean;
      is_active: boolean;
      last_login_at: Date | string | null;
    }>;

    if (reveal) {
      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.tenant_users_revealed",
        summary: `Revealed tenant user emails (tenant=${tenantId})`,
        reason: reason ?? null,
        tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    }

    let ownerIndex = 0;
    let userIndex = 0;
    const users = rows.map((r) => {
      const label = r.is_owner
        ? ownerIndex === 0
          ? "Owner"
          : `Owner #${++ownerIndex}`
        : `User #${++userIndex}`;
      if (r.is_owner && ownerIndex === 0) ownerIndex = 1;
      return {
        id: r.id,
        anonymousLabel: label,
        email: reveal ? r.email : null,
        fullName: reveal ? r.full_name : null,
        isOwner: r.is_owner,
        isActive: r.is_active,
        lastLoginAt: r.last_login_at ? new Date(r.last_login_at as string | Date) : null,
      };
    });

    return reply.send({ users });
  });

  // Platform audit entries scoped to a single tenant. `createdAt` DESC
  // — most recent first. Small limit because the list page isn't
  // paginated in v0 UX (just "here's what we did recently").
  fastify.get("/tenants/:id/platform-audit", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const tenantId = paramsParsed.data.id;

    const rows = await db
      .select({
        id: schema.platformAuditLog.id,
        platformUserEmail: schema.platformAuditLog.platformUserEmail,
        kind: schema.platformAuditLog.kind,
        summary: schema.platformAuditLog.summary,
        reason: schema.platformAuditLog.reason,
        createdAt: schema.platformAuditLog.createdAt,
      })
      .from(schema.platformAuditLog)
      .where(eq(schema.platformAuditLog.tenantId, tenantId))
      .orderBy(desc(schema.platformAuditLog.createdAt))
      .limit(100);

    return reply.send({ entries: rows });
  });

  // -------------------------------------------------------------------
  // Mutations: suspend / reactivate.
  //
  // A reason is required — see the Zod schema. The same reason flows
  // through to the platform audit log. A suspend flips the tenant
  // status to 'suspended' and leaves existing sessions alive (tenant
  // login guard rejects the next request cleanly with a clear message).
  // Reactivate flips back to 'active'. Idempotent on both sides.
  // -------------------------------------------------------------------

  // #59 — Core status-flip used by the single /suspend + /reactivate
  // endpoints AND the /tenants/bulk-action endpoint. Returns an outcome
  // rather than writing the response so the caller can aggregate
  // results across many tenants. All audit writes happen in here so
  // the single/bulk callers emit identical audit rows per tenant.
  type ApplyStatusOutcome =
    | { outcome: "ok"; status: "suspended" | "active" }
    | { outcome: "noop"; status: "suspended" | "active" | string }
    | { outcome: "not_found" };

  async function applyStatusToTenant(
    session: PlatformSession,
    tenantId: string,
    reason: string,
    nextStatus: "suspended" | "active",
    kind: "platform.tenant_suspended" | "platform.tenant_reactivated",
    summaryVerb: string,
    reqMeta: { ip: string | null; userAgent: string | null },
  ): Promise<ApplyStatusOutcome> {
    const rows = await db
      .select()
      .from(schema.tenants)
      .where(
        and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)),
      )
      .limit(1);
    const tenant = rows[0];
    if (!tenant) return { outcome: "not_found" };

    // Idempotent — if already in the target state, audit the attempt
    // and return success. Avoids UI flicker on a double-click and keeps
    // the bulk endpoint honest (we want an audit row for every tenant
    // the operator thought they were acting on, even the no-ops).
    if (tenant.status === nextStatus) {
      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: `${kind}.noop` as string,
        summary: `${summaryVerb} (no-op, already ${nextStatus}): ${tenant.businessName}`,
        reason,
        tenantId,
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
      });
      return { outcome: "noop", status: tenant.status };
    }

    await db
      .update(schema.tenants)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenantId));

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind,
      summary: `${summaryVerb}: ${tenant.businessName}`,
      reason,
      tenantId,
      ipAddress: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { outcome: "ok", status: nextStatus };
  }

  async function applyStatus(
    req: FastifyRequest,
    reply: FastifyReply,
    nextStatus: "suspended" | "active",
    kind: "platform.tenant_suspended" | "platform.tenant_reactivated",
    summaryVerb: string,
  ) {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    // #56 — suspend/reactivate is a super_admin-only mutation. Support
    // and billing can read status via /tenants but cannot flip it; they
    // escalate to a super_admin for that. The role gate also audits the
    // denied attempt so we can spot a compromised support credential
    // probing privileged endpoints.
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const schemaForBody = nextStatus === "suspended" ? SuspendSchema : ReactivateSchema;
    const bodyParsed = schemaForBody.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "REASON_REQUIRED",
          message: "A short reason is required for this action.",
        },
      });
    }

    const outcome = await applyStatusToTenant(
      session,
      paramsParsed.data.id,
      bodyParsed.data.reason,
      nextStatus,
      kind,
      summaryVerb,
      { ip: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null },
    );

    if (outcome.outcome === "not_found") {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    return reply.send({ ok: true, status: outcome.status });
  }

  fastify.post("/tenants/:id/suspend", async (req, reply) => {
    return applyStatus(req, reply, "suspended", "platform.tenant_suspended", "Suspended tenant");
  });

  fastify.post("/tenants/:id/reactivate", async (req, reply) => {
    return applyStatus(req, reply, "active", "platform.tenant_reactivated", "Reactivated tenant");
  });

  // -------------------------------------------------------------------
  // #59 — POST /tenants/bulk-action
  //
  // Operator ergonomics. Ticking 20 rows in the tenant list and hitting
  // "Suspend selected" is table stakes for a platform console. We fan
  // out to applyStatusToTenant for each id so the audit trail, idempotency,
  // and role check are identical to the single-tenant endpoint — no
  // parallel code path.
  //
  // A single reason covers the whole batch. The batch itself also gets
  // a dedicated audit row (`platform.tenants_bulk_acted`) so if anyone
  // later wonders "why did 14 tenants get suspended in the same minute?"
  // there's one row to anchor the investigation, plus 14 per-tenant
  // rows linked to it via a batchId in metadata.
  //
  // Limits: up to 100 ids per call. Larger than that is almost certainly
  // a mistake (or scripted — use the DB for that).
  // -------------------------------------------------------------------
  const BulkActionSchema = z.object({
    action: z.enum(["suspend", "reactivate"]),
    tenantIds: z.array(z.string().uuid()).min(1).max(100),
    reason: z.string().min(3).max(500),
  });

  fastify.post("/tenants/bulk-action", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    // Same gate as the single endpoints.
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const parsed = BulkActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", message: parsed.error.message },
      });
    }
    const { action, tenantIds, reason } = parsed.data;
    const nextStatus = action === "suspend" ? "suspended" : "active";
    const kind =
      action === "suspend"
        ? "platform.tenant_suspended"
        : "platform.tenant_reactivated";
    const summaryVerb =
      action === "suspend" ? "Suspended tenant" : "Reactivated tenant";

    // Dedupe ids so the operator can't accidentally double-count one
    // tenant as both a success and a no-op just because the UI let a
    // duplicate slip through.
    const uniqueIds = Array.from(new Set(tenantIds));
    const batchId = randomBytes(12).toString("hex");
    const reqMeta = {
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    };

    const results: Array<{
      tenantId: string;
      outcome: "ok" | "noop" | "not_found";
      status?: string;
    }> = [];

    // Serial. These are short UPDATEs, 100 of them at the absolute max,
    // and we'd rather preserve per-tenant audit ordering than parallelise
    // and race the audit writes.
    for (const id of uniqueIds) {
      const res = await applyStatusToTenant(
        session,
        id,
        `[batch ${batchId}] ${reason}`,
        nextStatus,
        kind,
        summaryVerb,
        reqMeta,
      );
      results.push({
        tenantId: id,
        outcome: res.outcome,
        status: res.outcome === "not_found" ? undefined : res.status,
      });
    }

    const okCount = results.filter((r) => r.outcome === "ok").length;
    const noopCount = results.filter((r) => r.outcome === "noop").length;
    const missingCount = results.filter((r) => r.outcome === "not_found").length;

    // Batch-level audit anchor — metadata carries the per-tenant
    // outcomes so the full picture is reconstructible without joining
    // every individual tenant row.
    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.tenants_bulk_acted",
      summary: `Bulk ${action}: ${okCount} ok, ${noopCount} no-op, ${missingCount} missing`,
      reason,
      tenantId: null,
      ipAddress: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      metadata: {
        batchId,
        action,
        requested: uniqueIds.length,
        results,
      },
    });

    return reply.send({
      ok: true,
      batchId,
      counts: { ok: okCount, noop: noopCount, notFound: missingCount },
      results,
    });
  });

  // -------------------------------------------------------------------
  // #56 — Platform staff management. Super-admin-only. Creates /
  // lists / edits / soft-deletes rows in `platform_users`. Role changes
  // and deactivations immediately invalidate the target user's active
  // sessions so the new gate takes effect without waiting for the
  // 12-hour session TTL to expire.
  //
  // Deliberately narrow scope:
  //   * no password *reset* endpoint — users change their own via
  //     /auth/change-password. An admin-forced reset is a "locked out
  //     operator" recovery flow that belongs to the CLI (+ a rotation
  //     story, gap K3) rather than a console button.
  //   * no email editing — email is the identity. Delete and recreate
  //     if someone's email actually changes. Prevents accidental
  //     identity swaps.
  // -------------------------------------------------------------------

  const PlatformUserCreateSchema = z.object({
    email: z.string().email().toLowerCase(),
    fullName: z.string().trim().min(1).max(255),
    password: z.string().min(12).max(256),
    role: z.enum(["super_admin", "support", "billing"]),
  });

  const PlatformUserPatchSchema = z
    .object({
      fullName: z.string().trim().min(1).max(255).optional(),
      role: z.enum(["super_admin", "support", "billing"]).optional(),
      isActive: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "No fields to update.",
    });

  fastify.get("/platform-users", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) return;

    const rows = await db
      .select({
        id: schema.platformUsers.id,
        email: schema.platformUsers.email,
        fullName: schema.platformUsers.fullName,
        role: schema.platformUsers.role,
        isActive: schema.platformUsers.isActive,
        lastLoginAt: schema.platformUsers.lastLoginAt,
        createdAt: schema.platformUsers.createdAt,
      })
      .from(schema.platformUsers)
      .where(isNull(schema.platformUsers.deletedAt))
      .orderBy(desc(schema.platformUsers.createdAt));

    return reply.send({
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.fullName,
        role: asPlatformRole(r.role),
        isActive: r.isActive,
        lastLoginAt: r.lastLoginAt,
        createdAt: r.createdAt,
      })),
    });
  });

  fastify.post(
    "/platform-users",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) return;

      const parsed = PlatformUserCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const { email, fullName, password, role } = parsed.data;

      // Uniqueness check on email (live rows only — soft-deleted rows
      // don't block re-use because the unique index is partial).
      const existing = await db
        .select({ id: schema.platformUsers.id })
        .from(schema.platformUsers)
        .where(
          and(
            eq(schema.platformUsers.email, email),
            isNull(schema.platformUsers.deletedAt),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        return reply.status(409).send({
          error: {
            code: "EMAIL_IN_USE",
            message: "A platform user with this email already exists.",
          },
        });
      }

      const passwordHash = await hashPassword(password);
      const inserted = await db
        .insert(schema.platformUsers)
        .values({
          email,
          fullName,
          passwordHash,
          role,
          isActive: true,
        })
        .returning({
          id: schema.platformUsers.id,
          email: schema.platformUsers.email,
          fullName: schema.platformUsers.fullName,
          role: schema.platformUsers.role,
          isActive: schema.platformUsers.isActive,
          createdAt: schema.platformUsers.createdAt,
        });
      const user = inserted[0];

      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.user.created",
        summary: `Created platform user ${email} (${role})`,
        tenantId: null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: { targetId: user?.id, targetEmail: email, role },
      });

      return reply.status(201).send({
        user: {
          id: user?.id,
          email: user?.email,
          fullName: user?.fullName,
          role: user ? asPlatformRole(user.role) : role,
          isActive: user?.isActive ?? true,
          createdAt: user?.createdAt,
        },
      });
    },
  );

  fastify.patch("/platform-users/:id", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) return;

    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const bodyParsed = PlatformUserPatchSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const targetId = paramsParsed.data.id;
    const patch = bodyParsed.data;

    const rows = await db
      .select()
      .from(schema.platformUsers)
      .where(
        and(
          eq(schema.platformUsers.id, targetId),
          isNull(schema.platformUsers.deletedAt),
        ),
      )
      .limit(1);
    const target = rows[0];
    if (!target) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }

    // Guardrails against locking yourself out of the console:
    //   * can't demote your own role (would 403 you off the staff page
    //     on the next click — a super_admin who wants to demote themself
    //     should have another super_admin do it).
    //   * can't deactivate yourself.
    // These are soft rails — a determined operator can ask another
    // super_admin to flip the switch.
    if (targetId === session.platformUserId) {
      if (patch.role && patch.role !== asPlatformRole(target.role)) {
        return reply.status(400).send({
          error: {
            code: "CANNOT_DEMOTE_SELF",
            message: "Ask another super-admin to change your role.",
          },
        });
      }
      if (patch.isActive === false) {
        return reply.status(400).send({
          error: {
            code: "CANNOT_DEACTIVATE_SELF",
            message: "You can't deactivate your own account.",
          },
        });
      }
    }

    // If demoting the last remaining super_admin, refuse — otherwise
    // the platform has no one who can manage staff or suspend tenants.
    // Cheaper than a DB constraint and far easier to explain in the
    // error message.
    const demotingFromSuperAdmin =
      target.role === "super_admin" && patch.role && patch.role !== "super_admin";
    const deactivatingSuperAdmin =
      target.role === "super_admin" && patch.isActive === false;
    if (demotingFromSuperAdmin || deactivatingSuperAdmin) {
      const otherSuperAdmins = await db
        .select({ count: count() })
        .from(schema.platformUsers)
        .where(
          and(
            eq(schema.platformUsers.role, "super_admin"),
            eq(schema.platformUsers.isActive, true),
            isNull(schema.platformUsers.deletedAt),
          ),
        );
      const total = Number(otherSuperAdmins[0]?.count ?? 0);
      // target counts in `total` — we need at least one OTHER super_admin
      // to remain active and undeleted.
      if (total <= 1) {
        return reply.status(400).send({
          error: {
            code: "LAST_SUPER_ADMIN",
            message:
              "This is the last active super-admin. Promote someone else first.",
          },
        });
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.fullName !== undefined) updates.fullName = patch.fullName;
    if (patch.role !== undefined) updates.role = patch.role;
    if (patch.isActive !== undefined) updates.isActive = patch.isActive;

    await db
      .update(schema.platformUsers)
      .set(updates)
      .where(eq(schema.platformUsers.id, targetId));

    const roleChanged = patch.role !== undefined && patch.role !== asPlatformRole(target.role);
    const deactivated = patch.isActive === false && target.isActive;
    const reactivated = patch.isActive === true && !target.isActive;

    // #56 — any change that narrows the target's privilege (role change
    // either way, deactivation) MUST invalidate their active sessions so
    // the cached role / cached active-flag can't serve one more request
    // at the old level. Reactivation doesn't need it (no session exists
    // to refresh anyway). Name changes are cosmetic — no invalidation.
    if (roleChanged || deactivated) {
      await destroyAllPlatformSessionsForUser(targetId);
    }

    if (roleChanged) {
      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.user.role_changed",
        summary: `Changed role of ${target.email} from ${target.role} to ${patch.role}`,
        tenantId: null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: {
          targetId,
          targetEmail: target.email,
          fromRole: target.role,
          toRole: patch.role,
        },
      });
    }
    if (deactivated) {
      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.user.deactivated",
        summary: `Deactivated platform user ${target.email}`,
        tenantId: null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: { targetId, targetEmail: target.email },
      });
    }
    if (reactivated) {
      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.user.reactivated",
        summary: `Reactivated platform user ${target.email}`,
        tenantId: null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: { targetId, targetEmail: target.email },
      });
    }

    return reply.send({ ok: true });
  });

  fastify.delete("/platform-users/:id", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) return;

    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const targetId = paramsParsed.data.id;

    if (targetId === session.platformUserId) {
      return reply.status(400).send({
        error: {
          code: "CANNOT_DELETE_SELF",
          message: "You can't delete your own account.",
        },
      });
    }

    const rows = await db
      .select()
      .from(schema.platformUsers)
      .where(
        and(
          eq(schema.platformUsers.id, targetId),
          isNull(schema.platformUsers.deletedAt),
        ),
      )
      .limit(1);
    const target = rows[0];
    if (!target) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }

    // Same last-super_admin guardrail as PATCH — deleting the final
    // super_admin would brick the console.
    if (target.role === "super_admin") {
      const otherSuperAdmins = await db
        .select({ count: count() })
        .from(schema.platformUsers)
        .where(
          and(
            eq(schema.platformUsers.role, "super_admin"),
            eq(schema.platformUsers.isActive, true),
            isNull(schema.platformUsers.deletedAt),
          ),
        );
      const total = Number(otherSuperAdmins[0]?.count ?? 0);
      if (total <= 1) {
        return reply.status(400).send({
          error: {
            code: "LAST_SUPER_ADMIN",
            message:
              "This is the last active super-admin. Promote someone else first.",
          },
        });
      }
    }

    // Soft-delete. Keep the email intact on the row so the audit log
    // remains readable; the partial unique index on email is `WHERE
    // deleted_at IS NULL`, so a new user can be created with the same
    // email later. `isActive = false` as belt-and-braces so any stale
    // query that forgets the deleted_at filter still treats the row
    // as non-usable.
    await db
      .update(schema.platformUsers)
      .set({
        deletedAt: new Date(),
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.platformUsers.id, targetId));

    await destroyAllPlatformSessionsForUser(targetId);

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.user.deleted",
      summary: `Deleted platform user ${target.email}`,
      tenantId: null,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: { targetId, targetEmail: target.email, role: target.role },
    });

    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------
  // #58 — Platform overview dashboard
  //
  // One endpoint, one round-trip, all the signals an ops human wants at
  // a glance: tenants-by-status, recent signups, active users on the
  // platform this week, impersonation pressure, and a short recent-audit
  // strip.  Readable by all three platform roles — billing needs the
  // MRR-shaped shape of this data as much as support does.  (No MRR
  // yet — #58 is scaffolding; pricing-engine will backfill.)
  //
  // All aggregates are a single DB round-trip via a CTE so the
  // dashboard doesn't fan out N counts.  Counts on tables outside RLS
  // (tenants / impersonation_* / platform_audit_log) use direct
  // filtered COUNTs; cross-tenant user counts go through the
  // SECURITY DEFINER helpers in 86-platform-overview.sql because
  // `users` is under RLS.
  // -------------------------------------------------------------------
  fastify.get("/overview", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const statusRows = (await db.execute(sql`
      SELECT status, COUNT(*)::bigint AS n
        FROM tenants
       WHERE deleted_at IS NULL
       GROUP BY status
    `)) as unknown as Array<{ status: string; n: number | string }>;

    const signupRows = (await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::bigint AS last_7,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::bigint AS last_30
        FROM tenants
       WHERE deleted_at IS NULL
    `)) as unknown as Array<{ last_7: number | string; last_30: number | string }>;

    const userRows = (await db.execute(sql`
      SELECT
        platform_total_user_count() AS total,
        platform_users_active_since(7) AS active_7,
        platform_users_active_since(30) AS active_30
    `)) as unknown as Array<{
      total: number | string;
      active_7: number | string;
      active_30: number | string;
    }>;

    // Impersonation counters — lazy sweep first so expired rows don't
    // show up as "pending" in the dashboard number.  This is the same
    // sweep the impersonation list endpoints do on read.
    await db.execute(sql`SELECT impersonation_sweep_expired()`);
    const impRows = (await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::bigint FROM impersonation_requests WHERE status = 'pending') AS pending,
        (SELECT COUNT(*)::bigint FROM impersonation_requests WHERE status = 'approved') AS approved_waiting,
        (SELECT COUNT(*)::bigint FROM impersonation_sessions WHERE ended_at IS NULL) AS active
    `)) as unknown as Array<{
      pending: number | string;
      approved_waiting: number | string;
      active: number | string;
    }>;

    const recentAudit = await db
      .select({
        id: schema.platformAuditLog.id,
        platformUserEmail: schema.platformAuditLog.platformUserEmail,
        kind: schema.platformAuditLog.kind,
        summary: schema.platformAuditLog.summary,
        reason: schema.platformAuditLog.reason,
        tenantId: schema.platformAuditLog.tenantId,
        createdAt: schema.platformAuditLog.createdAt,
      })
      .from(schema.platformAuditLog)
      .orderBy(desc(schema.platformAuditLog.createdAt))
      .limit(15);

    // Normalise the status map.  Every status in the CHECK constraint
    // is returned as a key — 0 where absent — so the UI doesn't need
    // fallback logic per-status.
    const byStatus: Record<string, number> = {
      active: 0,
      trial: 0,
      "past-due": 0,
      suspended: 0,
      churned: 0,
    };
    let totalTenants = 0;
    for (const r of statusRows) {
      const n = Number(r.n) || 0;
      byStatus[r.status] = n;
      totalTenants += n;
    }

    const signup = signupRows[0] ?? { last_7: 0, last_30: 0 };
    const usage = userRows[0] ?? { total: 0, active_7: 0, active_30: 0 };
    const imp = impRows[0] ?? { pending: 0, approved_waiting: 0, active: 0 };

    return reply.send({
      tenants: {
        total: totalTenants,
        byStatus,
        signupsLast7Days: Number(signup.last_7) || 0,
        signupsLast30Days: Number(signup.last_30) || 0,
      },
      users: {
        total: Number(usage.total) || 0,
        activeLast7Days: Number(usage.active_7) || 0,
        activeLast30Days: Number(usage.active_30) || 0,
      },
      impersonation: {
        pendingRequests: Number(imp.pending) || 0,
        approvedWaiting: Number(imp.approved_waiting) || 0,
        activeSessions: Number(imp.active) || 0,
      },
      recentAudit,
    });
  });

  // -------------------------------------------------------------------
  // #58 — Global platform audit feed
  //
  // The per-tenant /tenants/:id/platform-audit endpoint answers "what
  // did platform staff do to THIS business?".  This endpoint answers
  // "what did platform staff do, full stop?" — essential for a
  // security-conscious ops team doing periodic review (and for
  // answering the audit questions that come with B2B SaaS
  // procurement).
  //
  // Filters:
  //   - kind   : exact match on audit event kind
  //   - actor  : exact email match on the platform user
  //   - limit  : 1..500 (default 100)
  //   - offset : pagination
  // -------------------------------------------------------------------
  const ListAuditQuerySchema = z.object({
    kind: z.string().min(1).max(64).optional(),
    actor: z.string().email().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  });

  fastify.get("/audit", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const parsed = ListAuditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const { kind, actor, limit, offset } = parsed.data;

    const clauses = [];
    if (kind) clauses.push(eq(schema.platformAuditLog.kind, kind));
    if (actor) clauses.push(eq(schema.platformAuditLog.platformUserEmail, actor));
    const whereClause = clauses.length > 0 ? and(...clauses) : undefined;

    const rows = await db
      .select({
        id: schema.platformAuditLog.id,
        platformUserEmail: schema.platformAuditLog.platformUserEmail,
        kind: schema.platformAuditLog.kind,
        summary: schema.platformAuditLog.summary,
        reason: schema.platformAuditLog.reason,
        tenantId: schema.platformAuditLog.tenantId,
        createdAt: schema.platformAuditLog.createdAt,
      })
      .from(schema.platformAuditLog)
      .where(whereClause)
      .orderBy(desc(schema.platformAuditLog.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ count: count() })
      .from(schema.platformAuditLog)
      .where(whereClause);
    const total = Number(totalRows[0]?.count ?? 0);

    return reply.send({ total, limit, offset, entries: rows });
  });

  // -------------------------------------------------------------------
  // #58 — PATCH /tenants/:id
  //
  // Narrow by design — only the `notes` field is editable here.  Ops
  // humans annotate tenants ("watch this one, payment failed twice,"
  // "migrating from Tally, expect support ticket volume") and want
  // somewhere persistent to write it that isn't a Slack message.
  //
  // Status changes stay on the dedicated suspend/reactivate endpoints
  // because they have a REASON_REQUIRED contract + audit kinds we
  // don't want to collapse into a generic PATCH.
  //
  // super_admin and support can both write notes; billing is
  // read-only on tenant data by convention and sits this one out.
  // -------------------------------------------------------------------
  const PatchTenantSchema = z.object({
    notes: z.string().max(4000).nullable().optional(),
  });

  fastify.patch("/tenants/:id", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (
      !(await requirePlatformRole(req, reply, session, [
        "super_admin",
        "support",
      ]))
    ) {
      return;
    }

    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const bodyParsed = PatchTenantSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const tenantId = paramsParsed.data.id;
    const { notes } = bodyParsed.data;

    // Look up the current tenant so the audit diff is meaningful (we
    // log both the old and new notes as metadata).  If nothing is in
    // the patch body, we treat it as a no-op 204-style success rather
    // than a 400 — the UI can submit an empty PATCH as "touch" to
    // refresh updated_at without caring about the diff.
    const rows = await db
      .select({
        id: schema.tenants.id,
        businessName: schema.tenants.businessName,
        notes: schema.tenants.notes,
      })
      .from(schema.tenants)
      .where(
        and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)),
      )
      .limit(1);
    const tenant = rows[0];
    if (!tenant) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }

    if (notes !== undefined && notes !== tenant.notes) {
      await db
        .update(schema.tenants)
        .set({
          notes: notes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.tenants.id, tenantId));

      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.tenant_notes_updated",
        summary: `Updated notes on ${tenant.businessName}`,
        tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: {
          before: tenant.notes ?? "",
          after: notes ?? "",
        },
      });
    }

    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------
  // #59 — Per-user saved views for /platform/tenants + /platform/audit.
  //
  // Just named querystrings, pinned to one platform user. Strictly
  // scoped: every query filters by platform_user_id so nobody sees
  // another operator's views, and every mutation is gated to the same.
  // No audit — these are personal preferences, not state changes anyone
  // else cares about.
  //
  // The list is small (humans create, at most, a dozen views each) so
  // we don't paginate. One call returns them all for a scope.
  // -------------------------------------------------------------------
  const SavedViewScopeSchema = z.enum(["tenants", "audit"]);

  const CreateSavedViewSchema = z.object({
    scope: SavedViewScopeSchema,
    name: z.string().trim().min(1).max(80),
    queryString: z.string().max(2000).default(""),
  });

  fastify.get("/saved-views", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const parsed = z
      .object({ scope: SavedViewScopeSchema })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const rows = await db
      .select({
        id: schema.platformUserSavedViews.id,
        scope: schema.platformUserSavedViews.scope,
        name: schema.platformUserSavedViews.name,
        queryString: schema.platformUserSavedViews.queryString,
        createdAt: schema.platformUserSavedViews.createdAt,
        updatedAt: schema.platformUserSavedViews.updatedAt,
      })
      .from(schema.platformUserSavedViews)
      .where(
        and(
          eq(
            schema.platformUserSavedViews.platformUserId,
            session.platformUserId,
          ),
          eq(schema.platformUserSavedViews.scope, parsed.data.scope),
        ),
      )
      .orderBy(schema.platformUserSavedViews.name);

    return reply.send({ views: rows });
  });

  fastify.post("/saved-views", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const parsed = CreateSavedViewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", message: parsed.error.message },
      });
    }
    const { scope, name, queryString } = parsed.data;

    // Strip a leading `?` if the client pasted a full URL's search part.
    const qs = queryString.startsWith("?") ? queryString.slice(1) : queryString;

    try {
      const rows = await db
        .insert(schema.platformUserSavedViews)
        .values({
          platformUserId: session.platformUserId,
          scope,
          name,
          queryString: qs,
        })
        .returning({
          id: schema.platformUserSavedViews.id,
          scope: schema.platformUserSavedViews.scope,
          name: schema.platformUserSavedViews.name,
          queryString: schema.platformUserSavedViews.queryString,
          createdAt: schema.platformUserSavedViews.createdAt,
          updatedAt: schema.platformUserSavedViews.updatedAt,
        });
      return reply.send({ view: rows[0] });
    } catch (err: unknown) {
      // Treat the unique-constraint violation as a soft conflict — the
      // user probably meant to update the existing view. We surface
      // NAME_TAKEN so the UI can prompt for a different name (or offer
      // overwrite). An explicit PUT endpoint is overkill for this list
      // size; delete-then-create is enough.
      const code = (err as { code?: string } | null)?.code;
      if (code === "23505") {
        return reply
          .status(409)
          .send({ error: { code: "NAME_TAKEN", message: "Name in use." } });
      }
      throw err;
    }
  });

  fastify.delete("/saved-views/:id", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    // Scope the delete by platformUserId so a crafted id from another
    // operator's view can never be removed. Returning no row = 404.
    const deleted = await db
      .delete(schema.platformUserSavedViews)
      .where(
        and(
          eq(schema.platformUserSavedViews.id, parsed.data.id),
          eq(
            schema.platformUserSavedViews.platformUserId,
            session.platformUserId,
          ),
        ),
      )
      .returning({ id: schema.platformUserSavedViews.id });

    if (deleted.length === 0) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    return reply.send({ ok: true });
  });

  // #60 — Observability read-out for /platform/health.
  //
  // Intentionally open to all three platform roles: support/billing
  // engineers need to see whether the platform is healthy to triage
  // user complaints, even though they can't act on tenants. Nothing
  // here is tenant-private — it's aggregate API/infra state.
  fastify.get("/system-health", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const payload = await buildSystemHealthPayload();
    return reply.send(payload);
  });

  // Manually fire the renewal sweep (#124). Useful for ops to flush
  // pending state without waiting for the daily cron — e.g. confirm a
  // grandfathered addon got cancelled after a tenant cancelled, verify
  // a coupon ticked after a period rolled. Safe to call any time;
  // idempotent. Runs synchronously inside the request so the operator
  // sees the result counts inline.
  fastify.post("/subscription/renewal-sweep", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const result = await runRenewalCron(db, {
      info: (obj, msg) => req.log.info(obj, msg),
      error: (obj, msg) => req.log.error(obj, msg),
    });

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.subscription.renewal_sweep_run",
      summary: `Manual renewal sweep fired by operator`,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: { result },
    });

    return reply.send({ result });
  });

  // -------------------------------------------------------------------
  // #61 — Pricing plans + tenant subscriptions.
  //
  // Three endpoints in this PR:
  //   * GET  /plans                          — catalogue, any role
  //   * GET  /tenants/:id/subscription       — current subscription, any role
  //   * POST /tenants/:id/subscription/change-plan — super_admin, audited
  //
  // Billing role sees plans + subscriptions read-only (they need the
  // number to chase receivables), but only super_admin flips plans.
  // Self-serve plan change + payment collection lives in later PRs.
  // -------------------------------------------------------------------

  fastify.get("/plans", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const rows = await db
      .select({
        plan: schema.plans,
        currentVersionNumber: schema.planVersions.versionNumber,
      })
      .from(schema.plans)
      .leftJoin(
        schema.planVersions,
        eq(schema.planVersions.id, schema.plans.currentVersionId),
      )
      .orderBy(schema.plans.sortOrder, schema.plans.code);

    // Subscriber roll-up per plan: how many on the current version vs
    // older grandfathered versions. One query, group by (plan_id,
    // is-current-flag), then merge into the wire shape.
    const subRows = await db
      .select({
        planId: schema.tenantSubscriptions.planId,
        planVersionId: schema.tenantSubscriptions.planVersionId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(schema.tenantSubscriptions)
      .groupBy(
        schema.tenantSubscriptions.planId,
        schema.tenantSubscriptions.planVersionId,
      );
    const subsByPlan = new Map<string, { current: number; older: number }>();
    const planCurrentVersionId = new Map<string, string | null>();
    for (const row of rows) {
      planCurrentVersionId.set(row.plan.id, row.plan.currentVersionId);
    }
    for (const s of subRows) {
      const cur = subsByPlan.get(s.planId) ?? { current: 0, older: 0 };
      const isCurrent =
        s.planVersionId !== null &&
        planCurrentVersionId.get(s.planId) === s.planVersionId;
      if (isCurrent) cur.current += s.count;
      else cur.older += s.count;
      subsByPlan.set(s.planId, cur);
    }

    return reply.send({
      plans: rows.map((row) =>
        planToWire(row.plan, {
          currentVersionNumber: row.currentVersionNumber ?? null,
          subscribersOnVersion: subsByPlan.get(row.plan.id) ?? {
            current: 0,
            older: 0,
          },
        }),
      ),
    });
  });

  // -------------------------------------------------------------------
  // Plan editor (super_admin only). Closes the "edit prices outside of
  // a migration" todo on the read-only catalogue page from #61.
  //
  //   * GET    /plans/:id            — single plan, any role
  //   * POST   /plans                — create, super_admin
  //   * PATCH  /plans/:id            — update, super_admin
  //   * POST   /plans/:id/archive    — wind down, super_admin
  //   * POST   /plans/:id/unarchive  — resume selling, super_admin
  //
  // No DELETE on purpose. Hard-deleting a plan would orphan every
  // tenant_subscription row pointing at it (FK is RESTRICT). Archive
  // is the supported removal path; existing tenants stay grandfathered.
  // -------------------------------------------------------------------

  // Shared validators. Code is the stable machine handle (referenced by
  // requireFeature() / change-plan endpoints) so it's locked on update.
  const PlanCodeSchema = z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9_]*$/, "Code must be lowercase letters, digits, or underscores starting with a letter.");
  const NullableNonNegInt = z
    .number()
    .int()
    .nonnegative()
    .nullable();
  const FeatureCode = z.string().trim().min(1).max(64);
  const FeaturesArray = z.array(FeatureCode).max(64);

  const CreatePlanSchema = z.object({
    code: PlanCodeSchema,
    name: z.string().trim().min(1).max(80),
    tagline: z.string().trim().max(200).default(""),
    monthlyPriceCents: z.number().int().nonnegative(),
    yearlyPriceCents: z.number().int().nonnegative(),
    currency: z.string().trim().length(3).toUpperCase().default("LKR"),
    maxUsers: NullableNonNegInt.default(null),
    maxInvoicesMonthly: NullableNonNegInt.default(null),
    maxBranches: NullableNonNegInt.default(null),
    maxWarehouses: NullableNonNegInt.default(null),
    features: FeaturesArray.default([]),
    isPublic: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(32_767).default(0),
  });

  // Update is partial — every field optional, but at least one required
  // so an empty PATCH is a 400 rather than a silent no-op. Code is
  // intentionally absent: renaming the stable handle would orphan
  // requireFeature() calls + change-plan payloads. New plan = new code.
  const UpdatePlanSchema = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      tagline: z.string().trim().max(200).optional(),
      monthlyPriceCents: z.number().int().nonnegative().optional(),
      yearlyPriceCents: z.number().int().nonnegative().optional(),
      currency: z.string().trim().length(3).toUpperCase().optional(),
      maxUsers: NullableNonNegInt.optional(),
      maxInvoicesMonthly: NullableNonNegInt.optional(),
      maxBranches: NullableNonNegInt.optional(),
      maxWarehouses: NullableNonNegInt.optional(),
      features: FeaturesArray.optional(),
      isPublic: z.boolean().optional(),
      sortOrder: z.number().int().min(0).max(32_767).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "At least one field is required.",
    });

  function planToWire(
    p: typeof schema.plans.$inferSelect,
    extras?: { currentVersionNumber?: number | null; subscribersOnVersion?: { current: number; older: number } | null },
  ) {
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      tagline: p.tagline,
      monthlyPriceCents: p.monthlyPriceCents,
      yearlyPriceCents: p.yearlyPriceCents,
      currency: p.currency,
      maxUsers: p.maxUsers,
      maxInvoicesMonthly: p.maxInvoicesMonthly,
      maxBranches: p.maxBranches,
      maxWarehouses: p.maxWarehouses,
      features: p.features,
      isPublic: p.isPublic,
      isArchived: p.isArchived,
      sortOrder: p.sortOrder,
      currentVersionId: p.currentVersionId,
      // currentVersionNumber and subscribersOnVersion are joined-in
      // when the route resolves them; UI uses both to render
      // "v3 — 12 subscribers, 3 grandfathered on older versions".
      currentVersionNumber: extras?.currentVersionNumber ?? null,
      subscribersOnVersion: extras?.subscribersOnVersion ?? null,
    };
  }

  // Compute a shallow diff between two plan rows for the audit metadata.
  // Strings, numbers, booleans compared by `!==`; features array by
  // length + sorted-stringify so reordering doesn't show as a diff.
  function diffPlan(
    before: typeof schema.plans.$inferSelect,
    after: typeof schema.plans.$inferSelect,
  ): Record<string, { from: unknown; to: unknown }> {
    const out: Record<string, { from: unknown; to: unknown }> = {};
    const scalarKeys = [
      "name",
      "tagline",
      "monthlyPriceCents",
      "yearlyPriceCents",
      "currency",
      "maxUsers",
      "maxInvoicesMonthly",
      "maxBranches",
      "maxWarehouses",
      "isPublic",
      "isArchived",
      "sortOrder",
    ] as const;
    for (const k of scalarKeys) {
      if (before[k] !== after[k]) {
        out[k] = { from: before[k], to: after[k] };
      }
    }
    const beforeFeatures = [...(before.features ?? [])].sort();
    const afterFeatures = [...(after.features ?? [])].sort();
    if (
      beforeFeatures.length !== afterFeatures.length ||
      beforeFeatures.some((v, i) => v !== afterFeatures[i])
    ) {
      out.features = { from: before.features, to: after.features };
    }
    return out;
  }

  fastify.get("/plans/:id", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const rows = await db
      .select({
        plan: schema.plans,
        currentVersionNumber: schema.planVersions.versionNumber,
      })
      .from(schema.plans)
      .leftJoin(
        schema.planVersions,
        eq(schema.planVersions.id, schema.plans.currentVersionId),
      )
      .where(eq(schema.plans.id, parsed.data.id))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });

    // Subscriber breakdown for THIS plan only.
    const subRows = await db
      .select({
        planVersionId: schema.tenantSubscriptions.planVersionId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(schema.tenantSubscriptions)
      .where(eq(schema.tenantSubscriptions.planId, parsed.data.id))
      .groupBy(schema.tenantSubscriptions.planVersionId);
    let current = 0;
    let older = 0;
    for (const s of subRows) {
      if (s.planVersionId !== null && s.planVersionId === row.plan.currentVersionId) {
        current += s.count;
      } else {
        older += s.count;
      }
    }

    return reply.send({
      plan: planToWire(row.plan, {
        currentVersionNumber: row.currentVersionNumber ?? null,
        subscribersOnVersion: { current, older },
      }),
    });
  });

  // Version history for a plan. Lists every snapshot ever created so an
  // operator can see "v1 was 4900 cents, v2 raised to 5900" with
  // timestamps and the editor who made the change. Read-only — there's
  // no "edit a historical version" path, the model is append-only.
  fastify.get("/plans/:id/versions", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const planRows = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, parsed.data.id))
      .limit(1);
    const plan = planRows[0];
    if (!plan) return reply.status(404).send({ error: { code: "NOT_FOUND" } });

    const rows = await db
      .select()
      .from(schema.planVersions)
      .where(eq(schema.planVersions.planId, parsed.data.id))
      .orderBy(desc(schema.planVersions.versionNumber));

    // Per-version subscriber counts so the UI can render
    // "v3 (current) — 12 subscribers / v2 — 4 subscribers".
    const subRows = await db
      .select({
        planVersionId: schema.tenantSubscriptions.planVersionId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(schema.tenantSubscriptions)
      .where(eq(schema.tenantSubscriptions.planId, parsed.data.id))
      .groupBy(schema.tenantSubscriptions.planVersionId);
    const subsByVersion = new Map<string, number>();
    for (const s of subRows) {
      if (s.planVersionId) subsByVersion.set(s.planVersionId, s.count);
    }

    return reply.send({
      versions: rows.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        isCurrent: v.id === plan.currentVersionId,
        name: v.name,
        tagline: v.tagline,
        monthlyPriceCents: v.monthlyPriceCents,
        yearlyPriceCents: v.yearlyPriceCents,
        currency: v.currency,
        maxUsers: v.maxUsers,
        maxInvoicesMonthly: v.maxInvoicesMonthly,
        maxBranches: v.maxBranches,
        maxWarehouses: v.maxWarehouses,
        features: v.features,
        createdAt: v.createdAt,
        createdByPlatformUserId: v.createdByPlatformUserId,
        notes: v.notes,
        subscriberCount: subsByVersion.get(v.id) ?? 0,
      })),
    });
  });

  // Bulk-migrate every grandfathered subscription to the plan's current
  // version. Use case: super-admin shipped a price-cut and wants every
  // existing tenant to benefit immediately rather than waiting for
  // renewal (per pricing spec §12.2). For price increases the operator
  // typically does NOT migrate — that's the whole point of versioning.
  //
  // Idempotent — subs already on the current version are a no-op.
  // Returns { migrated: N } so the UI can show "Migrated 14 subscribers
  // to v3."
  fastify.post("/plans/:id/migrate-subscribers", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const planRows = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, parsed.data.id))
      .limit(1);
    const plan = planRows[0];
    if (!plan) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    if (!plan.currentVersionId) {
      return reply
        .status(409)
        .send({ error: { code: "PLAN_HAS_NO_CURRENT_VERSION" } });
    }

    // Find subs to migrate: same plan, plan_version_id != current.
    // Includes nulls (the back-compat back-fill case) by definition
    // since NULL != current_version_id.
    const targets = await db
      .select({ id: schema.tenantSubscriptions.id })
      .from(schema.tenantSubscriptions)
      .where(
        and(
          eq(schema.tenantSubscriptions.planId, parsed.data.id),
          or(
            isNull(schema.tenantSubscriptions.planVersionId),
            sql`${schema.tenantSubscriptions.planVersionId} <> ${plan.currentVersionId}::uuid`,
          ),
        ),
      );
    if (targets.length === 0) {
      return reply.send({ migrated: 0, currentVersionId: plan.currentVersionId });
    }

    await db
      .update(schema.tenantSubscriptions)
      .set({
        planVersionId: plan.currentVersionId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.tenantSubscriptions.planId, parsed.data.id),
          or(
            isNull(schema.tenantSubscriptions.planVersionId),
            sql`${schema.tenantSubscriptions.planVersionId} <> ${plan.currentVersionId}::uuid`,
          ),
        ),
      );

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.plan.subscribers_migrated",
      summary: `Migrated ${targets.length} subscriber(s) to current version of ${plan.code}`,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: {
        planId: plan.id,
        code: plan.code,
        targetVersionId: plan.currentVersionId,
        migratedCount: targets.length,
      },
    });

    return reply.send({
      migrated: targets.length,
      currentVersionId: plan.currentVersionId,
    });
  });

  // -------------------------------------------------------------------
  // Add-ons (#120 / pricing-spec §7).
  //
  //   * GET    /addons                — catalog, any role
  //   * GET    /addons/:id            — one, any role
  //   * POST   /addons                — create, super_admin
  //   * PATCH  /addons/:id            — update, super_admin
  //   * POST   /addons/:id/archive    — archive, super_admin
  //   * POST   /addons/:id/unarchive  — unarchive, super_admin
  //
  //   * GET    /tenants/:id/addons             — list active for tenant
  //   * POST   /tenants/:id/addons             — grant (super_admin)
  //   * POST   /tenants/:id/addons/:tenantAddonId/cancel — cancel
  //
  // No DELETE on the catalog — FK on tenant_addons is RESTRICT and the
  // supported wind-down is archive (mirrors plans semantics).
  // -------------------------------------------------------------------

  const AddonCodeSchema = z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z][a-z0-9_]*$/, "Code must be lowercase letters, digits, or underscores starting with a letter.");

  const CreateAddonSchema = z.object({
    code: AddonCodeSchema,
    name: z.string().trim().min(1).max(80),
    tagline: z.string().trim().max(200).default(""),
    monthlyPriceCents: z.number().int().nonnegative(),
    yearlyPriceCents: z.number().int().nonnegative(),
    currency: z.string().trim().length(3).toUpperCase().default("LKR"),
    grantsFeatures: z.array(z.string().trim().min(1).max(64)).max(32).default([]),
    eligiblePlanCodes: z.array(z.string().trim().min(1).max(32)).max(8).default([]),
    isPublic: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(32_767).default(0),
  });

  const UpdateAddonSchema = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      tagline: z.string().trim().max(200).optional(),
      monthlyPriceCents: z.number().int().nonnegative().optional(),
      yearlyPriceCents: z.number().int().nonnegative().optional(),
      currency: z.string().trim().length(3).toUpperCase().optional(),
      grantsFeatures: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
      eligiblePlanCodes: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
      isPublic: z.boolean().optional(),
      sortOrder: z.number().int().min(0).max(32_767).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "At least one field is required.",
    });

  function addonToWire(
    a: typeof schema.addons.$inferSelect,
    extras?: { activeSubscribers?: number },
  ) {
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      tagline: a.tagline,
      monthlyPriceCents: a.monthlyPriceCents,
      yearlyPriceCents: a.yearlyPriceCents,
      currency: a.currency,
      grantsFeatures: a.grantsFeatures,
      eligiblePlanCodes: a.eligiblePlanCodes,
      isPublic: a.isPublic,
      isArchived: a.isArchived,
      sortOrder: a.sortOrder,
      activeSubscribers: extras?.activeSubscribers ?? 0,
    };
  }

  fastify.get("/addons", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const rows = await db
      .select()
      .from(schema.addons)
      .orderBy(schema.addons.sortOrder, schema.addons.code);

    // Active-subscriber rollup per addon.
    const subRows = await db
      .select({
        addonId: schema.tenantAddons.addonId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(schema.tenantAddons)
      .where(inArray(schema.tenantAddons.status, ["active", "pending_removal"]))
      .groupBy(schema.tenantAddons.addonId);
    const byAddon = new Map<string, number>();
    for (const s of subRows) byAddon.set(s.addonId, s.count);

    return reply.send({
      addons: rows.map((a) =>
        addonToWire(a, { activeSubscribers: byAddon.get(a.id) ?? 0 }),
      ),
    });
  });

  fastify.get("/addons/:id", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const rows = await db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.id, parsed.data.id))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ addon: addonToWire(row) });
  });

  fastify.post("/addons", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const parsed = CreateAddonSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: parsed.error.issues[0]?.message ?? "Invalid addon payload.",
        },
      });
    }

    const existing = await db
      .select({ id: schema.addons.id })
      .from(schema.addons)
      .where(eq(schema.addons.code, parsed.data.code))
      .limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ error: { code: "ADDON_CODE_TAKEN" } });
    }

    const [created] = await db.insert(schema.addons).values(parsed.data).returning();
    if (!created) {
      return reply.status(500).send({ error: { code: "CREATE_FAILED" } });
    }

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.addon.created",
      summary: `Created addon ${created.code}`,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: {
        addonId: created.id,
        code: created.code,
        monthlyPriceCents: created.monthlyPriceCents,
        grantsFeatures: created.grantsFeatures,
      },
    });
    return reply.status(201).send({ addon: addonToWire(created) });
  });

  fastify.patch("/addons/:id", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const bodyParsed = UpdateAddonSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid addon payload.",
        },
      });
    }

    const before = await db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.id, paramsParsed.data.id))
      .limit(1);
    const beforeRow = before[0];
    if (!beforeRow) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }

    const [updated] = await db
      .update(schema.addons)
      .set({ ...bodyParsed.data, updatedAt: new Date() })
      .where(eq(schema.addons.id, paramsParsed.data.id))
      .returning();
    if (!updated) {
      return reply.status(500).send({ error: { code: "UPDATE_FAILED" } });
    }

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.addon.updated",
      summary: `Updated addon ${updated.code}`,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: { addonId: updated.id, code: updated.code, changes: bodyParsed.data },
    });
    return reply.send({ addon: addonToWire(updated) });
  });

  for (const flag of ["archive", "unarchive"] as const) {
    fastify.post(`/addons/:id/${flag}`, async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
        return;
      }

      const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }

      const [updated] = await db
        .update(schema.addons)
        .set({ isArchived: flag === "archive", updatedAt: new Date() })
        .where(eq(schema.addons.id, parsed.data.id))
        .returning();
      if (!updated) {
        return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      }

      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: `platform.addon.${flag}d`,
        summary: `${flag === "archive" ? "Archived" : "Unarchived"} addon ${updated.code}`,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: { addonId: updated.id, code: updated.code },
      });
      return reply.send({ addon: addonToWire(updated) });
    });
  }

  // -------------------------------------------------------------------
  // Per-tenant addon management (super_admin grant / cancel).
  // -------------------------------------------------------------------

  fastify.get("/tenants/:id/addons", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const rows = await db
      .select({ tenantAddon: schema.tenantAddons, addon: schema.addons })
      .from(schema.tenantAddons)
      .leftJoin(schema.addons, eq(schema.addons.id, schema.tenantAddons.addonId))
      .where(eq(schema.tenantAddons.tenantId, parsed.data.id))
      .orderBy(desc(schema.tenantAddons.activatedAt));
    return reply.send({
      tenantAddons: rows
        .filter((r) => r.addon !== null)
        .map((r) => ({
          id: r.tenantAddon.id,
          status: r.tenantAddon.status,
          billingCycle: r.tenantAddon.billingCycle,
          activatedAt: r.tenantAddon.activatedAt,
          cancelledAt: r.tenantAddon.cancelledAt,
          cancelReason: r.tenantAddon.cancelReason,
          autoRemovedAt: r.tenantAddon.autoRemovedAt,
          currentPeriodStart: r.tenantAddon.currentPeriodStart,
          currentPeriodEnd: r.tenantAddon.currentPeriodEnd,
          addon: addonToWire(r.addon!),
        })),
    });
  });

  const GrantAddonSchema = z.object({
    addonCode: z.string().trim().min(1).max(48),
    billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
    reason: z.string().trim().min(3).max(500),
  });

  fastify.post("/tenants/:id/addons", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const bodyParsed = GrantAddonSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid input.",
        },
      });
    }

    const addonRows = await db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.code, bodyParsed.data.addonCode))
      .limit(1);
    const addon = addonRows[0];
    if (!addon) {
      return reply.status(400).send({ error: { code: "UNKNOWN_ADDON" } });
    }
    if (addon.isArchived) {
      return reply.status(409).send({ error: { code: "ADDON_ARCHIVED" } });
    }

    // Prevent double-grant: if there's an active or pending_removal row
    // for this (tenant, addon), 409 instead of inserting a duplicate
    // (the partial unique index would catch it but a clean error is
    // better).
    const existing = await db
      .select({ id: schema.tenantAddons.id, status: schema.tenantAddons.status })
      .from(schema.tenantAddons)
      .where(
        and(
          eq(schema.tenantAddons.tenantId, paramsParsed.data.id),
          eq(schema.tenantAddons.addonId, addon.id),
          inArray(schema.tenantAddons.status, ["active", "pending_removal"]),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ error: { code: "ADDON_ALREADY_ACTIVE" } });
    }

    const periodMs =
      bodyParsed.data.billingCycle === "yearly"
        ? 365 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
    const [created] = await db
      .insert(schema.tenantAddons)
      .values({
        tenantId: paramsParsed.data.id,
        addonId: addon.id,
        status: "active",
        billingCycle: bodyParsed.data.billingCycle,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + periodMs),
        activatedAt: new Date(),
        activatedByPlatformUserId: session.platformUserId,
      })
      .returning();
    if (!created) {
      return reply.status(500).send({ error: { code: "GRANT_FAILED" } });
    }

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.tenant_addon.granted",
      summary: `Granted ${addon.name} to tenant`,
      reason: bodyParsed.data.reason,
      tenantId: paramsParsed.data.id,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: {
        tenantAddonId: created.id,
        addonId: addon.id,
        addonCode: addon.code,
        billingCycle: bodyParsed.data.billingCycle,
      },
    });
    return reply.status(201).send({
      tenantAddon: {
        id: created.id,
        status: created.status,
        billingCycle: created.billingCycle,
        activatedAt: created.activatedAt,
        currentPeriodStart: created.currentPeriodStart,
        currentPeriodEnd: created.currentPeriodEnd,
        addon: addonToWire(addon),
      },
    });
  });

  const CancelAddonSchema = z.object({
    reason: z.string().trim().min(3).max(500),
    immediate: z.boolean().default(false),
  });

  fastify.post(
    "/tenants/:id/addons/:tenantAddonId/cancel",
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
        return;
      }

      const paramsParsed = z
        .object({
          id: z.string().uuid(),
          tenantAddonId: z.string().uuid(),
        })
        .safeParse(req.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const bodyParsed = CancelAddonSchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: {
            code: "INVALID_INPUT",
            message: bodyParsed.error.issues[0]?.message ?? "Reason is required.",
          },
        });
      }

      const rows = await db
        .select({ tenantAddon: schema.tenantAddons, addon: schema.addons })
        .from(schema.tenantAddons)
        .leftJoin(
          schema.addons,
          eq(schema.addons.id, schema.tenantAddons.addonId),
        )
        .where(
          and(
            eq(schema.tenantAddons.id, paramsParsed.data.tenantAddonId),
            eq(schema.tenantAddons.tenantId, paramsParsed.data.id),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row || !row.addon) {
        return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      }
      if (row.tenantAddon.status === "cancelled") {
        return reply
          .status(409)
          .send({ error: { code: "ALREADY_CANCELLED" } });
      }

      // Two paths:
      //   immediate=true → status='cancelled' right now (operator
      //                     intervention; e.g. fraud/disabling)
      //   immediate=false → status='pending_removal' (spec §7.1: takes
      //                      effect at next renewal; cron sweep flips
      //                      to 'cancelled' after currentPeriodEnd).
      const nextStatus = bodyParsed.data.immediate
        ? "cancelled"
        : "pending_removal";

      await db
        .update(schema.tenantAddons)
        .set({
          status: nextStatus,
          cancelledAt: bodyParsed.data.immediate
            ? new Date()
            : row.tenantAddon.cancelledAt,
          cancelReason: bodyParsed.data.reason,
          updatedAt: new Date(),
        })
        .where(eq(schema.tenantAddons.id, paramsParsed.data.tenantAddonId));

      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.tenant_addon.cancelled",
        summary: `${
          bodyParsed.data.immediate ? "Cancelled" : "Scheduled removal of"
        } ${row.addon.name}`,
        reason: bodyParsed.data.reason,
        tenantId: paramsParsed.data.id,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: {
          tenantAddonId: row.tenantAddon.id,
          addonCode: row.addon.code,
          immediate: bodyParsed.data.immediate,
          status: nextStatus,
        },
      });

      return reply.send({ ok: true, status: nextStatus });
    },
  );

  // -------------------------------------------------------------------
  // Coupons (#121 / pricing-spec §8).
  //
  //   * GET    /coupons                — catalog, any role
  //   * GET    /coupons/:id            — one with redemption summary
  //   * POST   /coupons                — create, super_admin
  //   * PATCH  /coupons/:id            — update, super_admin
  //   * POST   /coupons/:id/archive    — super_admin
  //   * POST   /coupons/:id/unarchive  — super_admin
  //   * GET    /coupons/:id/redemptions — list, super_admin or billing
  //
  // No DELETE — FK on coupon_redemptions is RESTRICT and archive is
  // the supported wind-down (matches plans / addons semantics).
  // -------------------------------------------------------------------

  const CouponCodeSchema = z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Z0-9_-]+$/, "Code must be uppercase letters, digits, underscore, or hyphen.");

  const CreateCouponSchema = z.object({
    code: CouponCodeSchema,
    name: z.string().trim().min(3).max(160),
    discountType: z.enum(["percent_off", "amount_off_cents"]),
    discountValue: z.number().int().nonnegative(),
    appliesFor: z.enum(["once", "forever", "months"]).default("once"),
    appliesForMonths: z.number().int().min(1).max(120).optional(),
    eligiblePlanCodes: z.array(z.string().min(1).max(32)).max(8).default([]),
    newSignupsOnly: z.boolean().default(false),
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime().optional(),
    maxRedemptions: z.number().int().positive().optional(),
    onePerTenant: z.boolean().default(true),
    isActive: z.boolean().default(true),
    notes: z.string().max(2000).optional(),
  }).refine(
    (v) => v.discountType !== "percent_off" || v.discountValue <= 10_000,
    { message: "Percent-off can't exceed 100% (10000 bps)." },
  ).refine(
    (v) => v.appliesFor !== "months" || (v.appliesForMonths != null && v.appliesForMonths >= 1),
    { message: "appliesForMonths is required when appliesFor='months'." },
  );

  const UpdateCouponSchema = z
    .object({
      name: z.string().trim().min(3).max(160).optional(),
      discountType: z.enum(["percent_off", "amount_off_cents"]).optional(),
      discountValue: z.number().int().nonnegative().optional(),
      appliesFor: z.enum(["once", "forever", "months"]).optional(),
      appliesForMonths: z.number().int().min(1).max(120).nullable().optional(),
      eligiblePlanCodes: z.array(z.string().min(1).max(32)).max(8).optional(),
      newSignupsOnly: z.boolean().optional(),
      validFrom: z.string().datetime().nullable().optional(),
      validUntil: z.string().datetime().nullable().optional(),
      maxRedemptions: z.number().int().positive().nullable().optional(),
      onePerTenant: z.boolean().optional(),
      isActive: z.boolean().optional(),
      notes: z.string().max(2000).nullable().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "At least one field is required.",
    });

  function couponToWire(c: typeof schema.coupons.$inferSelect) {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      discountType: c.discountType,
      discountValue: c.discountValue,
      appliesFor: c.appliesFor,
      appliesForMonths: c.appliesForMonths,
      eligiblePlanCodes: c.eligiblePlanCodes,
      newSignupsOnly: c.newSignupsOnly,
      validFrom: c.validFrom,
      validUntil: c.validUntil,
      maxRedemptions: c.maxRedemptions,
      redemptionCount: c.redemptionCount,
      onePerTenant: c.onePerTenant,
      isActive: c.isActive,
      isArchived: c.isArchived,
      notes: c.notes,
      createdAt: c.createdAt,
    };
  }

  fastify.get("/coupons", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const rows = await db
      .select()
      .from(schema.coupons)
      .orderBy(desc(schema.coupons.createdAt));
    return reply.send({ coupons: rows.map(couponToWire) });
  });

  fastify.get("/coupons/:id", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const rows = await db
      .select()
      .from(schema.coupons)
      .where(eq(schema.coupons.id, parsed.data.id))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ coupon: couponToWire(row) });
  });

  fastify.post("/coupons", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const parsed = CreateCouponSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: parsed.error.issues[0]?.message ?? "Invalid coupon payload.",
        },
      });
    }

    // Code uniqueness — friendly 409 ahead of the unique-index 500.
    const existing = await db
      .select({ id: schema.coupons.id })
      .from(schema.coupons)
      .where(sql`LOWER(${schema.coupons.code}) = LOWER(${parsed.data.code})`)
      .limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ error: { code: "COUPON_CODE_TAKEN" } });
    }

    const [created] = await db
      .insert(schema.coupons)
      .values({
        code: parsed.data.code,
        name: parsed.data.name,
        discountType: parsed.data.discountType,
        discountValue: parsed.data.discountValue,
        appliesFor: parsed.data.appliesFor,
        appliesForMonths: parsed.data.appliesForMonths ?? null,
        eligiblePlanCodes: parsed.data.eligiblePlanCodes,
        newSignupsOnly: parsed.data.newSignupsOnly,
        validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
        validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
        maxRedemptions: parsed.data.maxRedemptions ?? null,
        onePerTenant: parsed.data.onePerTenant,
        isActive: parsed.data.isActive,
        notes: parsed.data.notes ?? null,
        createdByPlatformUserId: session.platformUserId,
      })
      .returning();
    if (!created) {
      return reply.status(500).send({ error: { code: "CREATE_FAILED" } });
    }

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.coupon.created",
      summary: `Created coupon ${created.code}`,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: {
        couponId: created.id,
        code: created.code,
        discountType: created.discountType,
        discountValue: created.discountValue,
      },
    });
    return reply.status(201).send({ coupon: couponToWire(created) });
  });

  fastify.patch("/coupons/:id", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const bodyParsed = UpdateCouponSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid coupon payload.",
        },
      });
    }

    // Coerce datetime strings to Date for the DB write.
    const patch: Record<string, unknown> = { ...bodyParsed.data, updatedAt: new Date() };
    if ("validFrom" in patch && patch.validFrom != null) {
      patch.validFrom = new Date(patch.validFrom as string);
    }
    if ("validUntil" in patch && patch.validUntil != null) {
      patch.validUntil = new Date(patch.validUntil as string);
    }

    const [updated] = await db
      .update(schema.coupons)
      .set(patch as Partial<typeof schema.coupons.$inferInsert>)
      .where(eq(schema.coupons.id, paramsParsed.data.id))
      .returning();
    if (!updated) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.coupon.updated",
      summary: `Updated coupon ${updated.code}`,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: { couponId: updated.id, code: updated.code, changes: bodyParsed.data },
    });
    return reply.send({ coupon: couponToWire(updated) });
  });

  for (const flag of ["archive", "unarchive"] as const) {
    fastify.post(`/coupons/:id/${flag}`, async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
        return;
      }

      const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }

      const [updated] = await db
        .update(schema.coupons)
        .set({ isArchived: flag === "archive", updatedAt: new Date() })
        .where(eq(schema.coupons.id, parsed.data.id))
        .returning();
      if (!updated) {
        return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      }

      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: `platform.coupon.${flag}d`,
        summary: `${flag === "archive" ? "Archived" : "Unarchived"} coupon ${updated.code}`,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: { couponId: updated.id, code: updated.code },
      });
      return reply.send({ coupon: couponToWire(updated) });
    });
  }

  // Redemption history per coupon. Includes tenant identity (super-
  // admin can already see tenant directories elsewhere; coupon-side
  // is the same realm). For ops "did the campaign land any signups?"
  fastify.get("/coupons/:id/redemptions", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    // Billing role can see redemptions (revenue analytics) but
    // can't mutate; super_admin and support also pass.
    if (
      !(await requirePlatformRole(req, reply, session, [
        "super_admin",
        "support",
        "billing",
      ]))
    ) {
      return;
    }

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const rows = await db
      .select({
        redemption: schema.couponRedemptions,
        tenant: schema.tenants,
      })
      .from(schema.couponRedemptions)
      .leftJoin(
        schema.tenants,
        eq(schema.tenants.id, schema.couponRedemptions.tenantId),
      )
      .where(eq(schema.couponRedemptions.couponId, parsed.data.id))
      .orderBy(desc(schema.couponRedemptions.redeemedAt));

    return reply.send({
      redemptions: rows.map((r) => ({
        id: r.redemption.id,
        tenantId: r.redemption.tenantId,
        tenantName: r.tenant?.businessName ?? null,
        tenantSlug: r.tenant?.slug ?? null,
        discountType: r.redemption.discountType,
        discountValue: r.redemption.discountValue,
        appliesFor: r.redemption.appliesFor,
        appliesForMonths: r.redemption.appliesForMonths,
        status: r.redemption.status,
        monthsApplied: r.redemption.monthsApplied,
        redeemedAt: r.redemption.redeemedAt,
        consumedAt: r.redemption.consumedAt,
        cancelledAt: r.redemption.cancelledAt,
        cancelReason: r.redemption.cancelReason,
      })),
    });
  });

  fastify.post("/plans", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const parsed = CreatePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: parsed.error.issues[0]?.message ?? "Invalid plan payload.",
        },
      });
    }

    // Code uniqueness — the partial unique index would catch this at
    // insert time too, but a clean 409 is friendlier than a generic 500
    // dressed up from a Postgres unique-violation surfacing through
    // Drizzle.
    const existing = await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.code, parsed.data.code))
      .limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ error: { code: "PLAN_CODE_TAKEN" } });
    }

    // Plan + v1 version are created together so plans.current_version_id
    // is never null in steady state. Wrap in a transaction so a partial
    // failure can't leave a plan without a version (the gate would then
    // fall back to plans.* via COALESCE — works, but defeats the point).
    const created = await db.transaction(async (tx) => {
      const [planRow] = await tx
        .insert(schema.plans)
        .values({
          code: parsed.data.code,
          name: parsed.data.name,
          tagline: parsed.data.tagline,
          monthlyPriceCents: parsed.data.monthlyPriceCents,
          yearlyPriceCents: parsed.data.yearlyPriceCents,
          currency: parsed.data.currency,
          maxUsers: parsed.data.maxUsers,
          maxInvoicesMonthly: parsed.data.maxInvoicesMonthly,
          maxBranches: parsed.data.maxBranches,
          maxWarehouses: parsed.data.maxWarehouses,
          features: parsed.data.features,
          isPublic: parsed.data.isPublic,
          sortOrder: parsed.data.sortOrder,
        })
        .returning();
      if (!planRow) return null;

      const [version] = await tx
        .insert(schema.planVersions)
        .values({
          planId: planRow.id,
          versionNumber: 1,
          name: planRow.name,
          tagline: planRow.tagline,
          monthlyPriceCents: planRow.monthlyPriceCents,
          yearlyPriceCents: planRow.yearlyPriceCents,
          currency: planRow.currency,
          maxUsers: planRow.maxUsers,
          maxInvoicesMonthly: planRow.maxInvoicesMonthly,
          maxBranches: planRow.maxBranches,
          maxWarehouses: planRow.maxWarehouses,
          features: planRow.features,
          createdByPlatformUserId: session.platformUserId,
          notes: "Initial version",
        })
        .returning();
      if (!version) return null;

      const [final] = await tx
        .update(schema.plans)
        .set({ currentVersionId: version.id })
        .where(eq(schema.plans.id, planRow.id))
        .returning();
      return final ?? null;
    });

    if (!created) {
      return reply.status(500).send({ error: { code: "CREATE_FAILED" } });
    }

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.plan.created",
      summary: `Created plan ${created.code}`,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: {
        planId: created.id,
        code: created.code,
        monthlyPriceCents: created.monthlyPriceCents,
        yearlyPriceCents: created.yearlyPriceCents,
        features: created.features,
        versionNumber: 1,
      },
    });

    return reply.status(201).send({ plan: planToWire(created) });
  });

  // Fields whose change makes a NEW plan version. Catalog-level fields
  // (sortOrder, isPublic) don't affect billing or capability gating, so
  // changing them just mutates plans without spawning a version.
  const VERSIONED_FIELDS = [
    "name",
    "tagline",
    "monthlyPriceCents",
    "yearlyPriceCents",
    "currency",
    "maxUsers",
    "maxInvoicesMonthly",
    "maxBranches",
    "maxWarehouses",
    "features",
  ] as const;

  function valueBearingChanged(
    before: typeof schema.plans.$inferSelect,
    patch: z.infer<typeof UpdatePlanSchema>,
  ): boolean {
    for (const k of VERSIONED_FIELDS) {
      if (patch[k] === undefined) continue;
      if (k === "features") {
        const a = [...(before.features ?? [])].sort();
        const b = [...(patch.features ?? [])].sort();
        if (a.length !== b.length || a.some((v, i) => v !== b[i])) return true;
      } else if (before[k] !== patch[k]) {
        return true;
      }
    }
    return false;
  }

  fastify.patch("/plans/:id", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const paramsParsed = z
      .object({ id: z.string().uuid() })
      .safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const bodyParsed = UpdatePlanSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid plan payload.",
        },
      });
    }

    const before = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, paramsParsed.data.id))
      .limit(1);
    const beforeRow = before[0];
    if (!beforeRow) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }

    const needsNewVersion = valueBearingChanged(beforeRow, bodyParsed.data);

    // Single transaction: mutate the catalog row + (if needed) snapshot
    // a new version + advance current_version_id. Existing
    // tenant_subscriptions stay on their bound plan_version_id and so
    // are grandfathered onto the previous version's price/caps.
    const result = await db.transaction(async (tx) => {
      const [planRow] = await tx
        .update(schema.plans)
        .set({
          ...bodyParsed.data,
          updatedAt: new Date(),
        })
        .where(eq(schema.plans.id, paramsParsed.data.id))
        .returning();
      if (!planRow) return null;

      let newVersionNumber: number | null = null;
      if (needsNewVersion) {
        const maxRow = await tx
          .select({
            maxN: sql<number>`COALESCE(MAX(${schema.planVersions.versionNumber}), 0)::int`,
          })
          .from(schema.planVersions)
          .where(eq(schema.planVersions.planId, planRow.id));
        newVersionNumber = (maxRow[0]?.maxN ?? 0) + 1;

        const [version] = await tx
          .insert(schema.planVersions)
          .values({
            planId: planRow.id,
            versionNumber: newVersionNumber,
            name: planRow.name,
            tagline: planRow.tagline,
            monthlyPriceCents: planRow.monthlyPriceCents,
            yearlyPriceCents: planRow.yearlyPriceCents,
            currency: planRow.currency,
            maxUsers: planRow.maxUsers,
            maxInvoicesMonthly: planRow.maxInvoicesMonthly,
            maxBranches: planRow.maxBranches,
            maxWarehouses: planRow.maxWarehouses,
            features: planRow.features,
            createdByPlatformUserId: session.platformUserId,
          })
          .returning();
        if (!version) return null;

        const [final] = await tx
          .update(schema.plans)
          .set({ currentVersionId: version.id })
          .where(eq(schema.plans.id, planRow.id))
          .returning();
        return { plan: final ?? planRow, newVersionNumber };
      }
      return { plan: planRow, newVersionNumber: null };
    });

    if (!result) {
      return reply.status(500).send({ error: { code: "UPDATE_FAILED" } });
    }

    const diff = diffPlan(beforeRow, result.plan);
    if (Object.keys(diff).length > 0) {
      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.plan.updated",
        summary: result.newVersionNumber
          ? `Updated plan ${result.plan.code} (v${result.newVersionNumber})`
          : `Updated plan ${result.plan.code}`,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: {
          planId: result.plan.id,
          code: result.plan.code,
          changes: diff,
          newVersionNumber: result.newVersionNumber,
        },
      });
    }

    return reply.send({ plan: planToWire(result.plan) });
  });

  // Archive is just a flag flip, but we route it as its own endpoint
  // (rather than PATCH { isArchived: true }) so the audit row reads
  // "Archived plan starter" instead of "Updated plan starter (changes:
  // isArchived)". The semantic distinction matters when an operator
  // is reading the audit log a year later trying to figure out why a
  // plan disappeared from the picker.
  fastify.post("/plans/:id/archive", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const [updated] = await db
      .update(schema.plans)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(schema.plans.id, parsed.data.id))
      .returning();
    if (!updated) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.plan.archived",
      summary: `Archived plan ${updated.code}`,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: { planId: updated.id, code: updated.code },
    });

    return reply.send({ plan: planToWire(updated) });
  });

  fastify.post("/plans/:id/unarchive", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const [updated] = await db
      .update(schema.plans)
      .set({ isArchived: false, updatedAt: new Date() })
      .where(eq(schema.plans.id, parsed.data.id))
      .returning();
    if (!updated) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.plan.unarchived",
      summary: `Unarchived plan ${updated.code}`,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: { planId: updated.id, code: updated.code },
    });

    return reply.send({ plan: planToWire(updated) });
  });

  fastify.get("/tenants/:id/subscription", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    // LEFT JOIN on plans because we want the plan's marketing fields
    // in one trip. Join is safe even under unusual data — plan_id is
    // NOT NULL + FK, so a tenant with a subscription always has a plan.
    const rows = await db
      .select({
        subscription: schema.tenantSubscriptions,
        plan: schema.plans,
      })
      .from(schema.tenantSubscriptions)
      .leftJoin(
        schema.plans,
        eq(schema.plans.id, schema.tenantSubscriptions.planId),
      )
      .where(eq(schema.tenantSubscriptions.tenantId, parsed.data.id))
      .limit(1);

    const row = rows[0];
    if (!row || !row.plan) {
      // No subscription = tenant exists but the backfill missed it, or
      // tenant is unknown. 404 either way; the caller can disambiguate
      // by hitting /tenants/:id separately.
      return reply.status(404).send({ error: { code: "NO_SUBSCRIPTION" } });
    }

    return reply.send({
      subscription: {
        id: row.subscription.id,
        tenantId: row.subscription.tenantId,
        status: row.subscription.status,
        billingCycle: row.subscription.billingCycle,
        trialEndsAt: row.subscription.trialEndsAt,
        currentPeriodStart: row.subscription.currentPeriodStart,
        currentPeriodEnd: row.subscription.currentPeriodEnd,
        cancelledAt: row.subscription.cancelledAt,
        cancelReason: row.subscription.cancelReason,
        createdAt: row.subscription.createdAt,
        updatedAt: row.subscription.updatedAt,
        // Per-tenant overrides (#71). NULL = using the plan default.
        // UI branches on nullness to render "Custom: 5,000" vs the
        // plan cap in grey.
        customLimits: {
          maxUsers: row.subscription.customMaxUsers,
          maxInvoicesMonthly: row.subscription.customMaxInvoicesMonthly,
          maxBranches: row.subscription.customMaxBranches,
          maxWarehouses: row.subscription.customMaxWarehouses,
          note: row.subscription.customLimitsNote,
        },
        plan: {
          id: row.plan.id,
          code: row.plan.code,
          name: row.plan.name,
          tagline: row.plan.tagline,
          monthlyPriceCents: row.plan.monthlyPriceCents,
          yearlyPriceCents: row.plan.yearlyPriceCents,
          currency: row.plan.currency,
          maxUsers: row.plan.maxUsers,
          maxInvoicesMonthly: row.plan.maxInvoicesMonthly,
          maxBranches: row.plan.maxBranches,
          maxWarehouses: row.plan.maxWarehouses,
          features: row.plan.features,
        },
      },
    });
  });

  // Plan-change payload. `planCode` (not `planId`) so the UI can hit
  // this endpoint armed with nothing more than the seed catalogue —
  // one fewer round-trip to resolve a uuid. `billingCycle` is optional
  // so an operator swapping plans keeps the existing cycle by default.
  const ChangePlanSchema = z.object({
    planCode: z.string().min(1).max(32),
    billingCycle: z.enum(["monthly", "yearly"]).optional(),
    // Keep/reset trial: when moving a mid-trial tenant to a different
    // plan, by default we keep their existing trialEndsAt. Set
    // `endTrial: true` to flip them to `active` immediately (useful
    // when they've paid and want the plan upgraded mid-trial).
    endTrial: z.boolean().optional().default(false),
    reason: z.string().trim().min(3).max(500),
  });

  fastify.post(
    "/tenants/:id/subscription/change-plan",
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;

      if (
        !(await requirePlatformRole(req, reply, session, ["super_admin"]))
      ) {
        return;
      }

      const paramsParsed = z
        .object({ id: z.string().uuid() })
        .safeParse(req.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const tenantId = paramsParsed.data.id;

      const bodyParsed = ChangePlanSchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: {
            code: "INVALID_INPUT",
            message:
              bodyParsed.error.issues[0]?.message ??
              "Plan code, billing cycle, and reason are required.",
          },
        });
      }

      // Resolve the target plan first — if the code is bogus we want
      // a clean 400 before we touch anything.
      const planRows = await db
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.code, bodyParsed.data.planCode))
        .limit(1);
      const targetPlan = planRows[0];
      if (!targetPlan) {
        return reply
          .status(400)
          .send({ error: { code: "UNKNOWN_PLAN" } });
      }

      // Fetch the current subscription row so we can (a) detect noop,
      // (b) include a diff in the audit line.
      const existingRows = await db
        .select({
          subscription: schema.tenantSubscriptions,
          plan: schema.plans,
        })
        .from(schema.tenantSubscriptions)
        .leftJoin(
          schema.plans,
          eq(schema.plans.id, schema.tenantSubscriptions.planId),
        )
        .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) {
        return reply
          .status(404)
          .send({ error: { code: "NO_SUBSCRIPTION" } });
      }

      const wasSamePlan =
        existing.subscription.planId === targetPlan.id &&
        (bodyParsed.data.billingCycle == null ||
          existing.subscription.billingCycle ===
            bodyParsed.data.billingCycle) &&
        !bodyParsed.data.endTrial;
      if (wasSamePlan) {
        // Idempotent noop. Still return 200 so the UI doesn't need a
        // separate "nothing changed" branch, but skip the audit line
        // (nothing happened) to keep the log honest.
        return reply.send({
          ok: true,
          changed: false,
          subscription: {
            ...existing.subscription,
            plan: existing.plan,
          },
        });
      }

      // Status transition: if endTrial is set, move trial → active;
      // otherwise preserve whatever status the subscription was in.
      // 'cancelled' rows can't be re-upgraded via this endpoint — the
      // operator should reactivate (separate endpoint in #62).
      if (existing.subscription.status === "cancelled") {
        return reply
          .status(409)
          .send({ error: { code: "SUBSCRIPTION_CANCELLED" } });
      }

      const nextStatus =
        bodyParsed.data.endTrial && existing.subscription.status === "trial"
          ? "active"
          : existing.subscription.status;
      const nextCycle =
        bodyParsed.data.billingCycle ?? existing.subscription.billingCycle;

      // Bind to the target plan's CURRENT version. Switching plans is
      // an explicit choice — the tenant is buying the latest published
      // tier, not the version some other tenant happens to be
      // grandfathered onto.
      const [updated] = await db
        .update(schema.tenantSubscriptions)
        .set({
          planId: targetPlan.id,
          planVersionId: targetPlan.currentVersionId,
          status: nextStatus,
          billingCycle: nextCycle,
          // Clear trialEndsAt when we explicitly end the trial; otherwise
          // leave it alone — a mid-trial plan change keeps the clock.
          trialEndsAt: bodyParsed.data.endTrial
            ? null
            : existing.subscription.trialEndsAt,
        })
        .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
        .returning();

      // Auto-remove addons whose features are now part of the new plan
      // (spec §7.1). The targetPlan row carries the features as the
      // denormalised current snapshot, so no extra join needed.
      const autoRemoved = await autoRemoveRedundantAddons(
        tenantId,
        Array.isArray(targetPlan.features)
          ? (targetPlan.features as string[])
          : [],
      );
      if (autoRemoved.length > 0) {
        await recordPlatformAuditEvent({
          platformUserId: session.platformUserId,
          platformUserEmail: session.email,
          kind: "platform.tenant_addon.auto_removed",
          summary: `Auto-removed ${autoRemoved.length} addon(s) included in ${targetPlan.code}`,
          tenantId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
          metadata: {
            triggerPlanCode: targetPlan.code,
            removed: autoRemoved,
          },
        });
      }

      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.subscription_changed",
        summary: `Changed plan: ${existing.plan?.code ?? "?"} → ${targetPlan.code}`,
        tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: {
          fromPlanCode: existing.plan?.code ?? null,
          toPlanCode: targetPlan.code,
          fromBillingCycle: existing.subscription.billingCycle,
          toBillingCycle: nextCycle,
          fromStatus: existing.subscription.status,
          toStatus: nextStatus,
          endedTrial: Boolean(bodyParsed.data.endTrial),
          reason: bodyParsed.data.reason,
        },
      });

      return reply.send({
        ok: true,
        changed: true,
        subscription: { ...updated, plan: targetPlan },
      });
    },
  );

  // #71 — Per-tenant quota overrides. Escape hatch for custom
  // contracts: "Starter pricing, 5,000 invoices/month" goes here,
  // not into a bespoke plan row. All four caps are nullable in the
  // DB; null means "inherit from the plan". The API accepts
  // `undefined` to leave a field untouched and explicit `null` to
  // clear an existing override.
  //
  // Negative values rejected at the schema layer. 0 is legal — it
  // means "freeze this resource" (useful for pausing a specific
  // capability without flipping the plan). The note is free-form
  // and exists so whoever sees the override six months from now can
  // -------------------------------------------------------------------
  // Platform-admin pause / resume on a tenant's subscription (#125).
  //
  //   * POST /tenants/:id/subscription/pause   — super_admin, audited
  //   * POST /tenants/:id/subscription/resume  — super_admin, audited
  //
  // Same semantics as the tenant-side routes but operator-driven —
  // ops can pause a tenant's subscription on their behalf (e.g.
  // requested via support ticket, dispute resolution, etc.).
  // -------------------------------------------------------------------
  const PlatformPauseSchema = z.object({
    reason: z.string().trim().min(3).max(500),
    resumeAt: z.string().datetime().optional(),
  });

  fastify.post("/tenants/:id/subscription/pause", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }
    const paramsParsed = z
      .object({ id: z.string().uuid() })
      .safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const bodyParsed = PlatformPauseSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message:
            bodyParsed.error.issues[0]?.message ?? "Reason is required.",
        },
      });
    }

    const subRows = await db
      .select()
      .from(schema.tenantSubscriptions)
      .where(
        eq(schema.tenantSubscriptions.tenantId, paramsParsed.data.id),
      )
      .limit(1);
    const sub = subRows[0];
    if (!sub) {
      return reply.status(404).send({ error: { code: "NO_SUBSCRIPTION" } });
    }
    if (sub.status === "paused") {
      return reply
        .status(409)
        .send({ error: { code: "ALREADY_PAUSED" } });
    }
    if (sub.status === "cancelled") {
      return reply
        .status(409)
        .send({ error: { code: "SUBSCRIPTION_CANCELLED" } });
    }

    let resumeAt: Date | null = null;
    if (bodyParsed.data.resumeAt) {
      const requested = new Date(bodyParsed.data.resumeAt);
      const now = new Date();
      const maxResume = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      // Platform admin gets a longer leash than tenants — up to a
      // year. Audit captures the choice; ops can override the 90-day
      // tenant-side limit when negotiating bespoke deals.
      if (requested.getTime() < now.getTime()) {
        return reply
          .status(400)
          .send({ error: { code: "RESUME_TOO_SOON" } });
      }
      if (requested.getTime() > maxResume.getTime()) {
        return reply
          .status(400)
          .send({ error: { code: "PAUSE_WINDOW_TOO_LONG" } });
      }
      resumeAt = requested;
    }

    await db
      .update(schema.tenantSubscriptions)
      .set({
        status: "paused",
        pausedAt: new Date(),
        pauseReason: bodyParsed.data.reason,
        resumeAt,
        pausedByUserId: null,
        pausedByPlatformUserId: session.platformUserId,
        updatedAt: new Date(),
      })
      .where(
        eq(schema.tenantSubscriptions.tenantId, paramsParsed.data.id),
      );

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.subscription.paused",
      summary: `Paused tenant subscription`,
      reason: bodyParsed.data.reason,
      tenantId: paramsParsed.data.id,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: {
        previousStatus: sub.status,
        resumeAt: resumeAt?.toISOString() ?? null,
      },
    });

    return reply.send({ ok: true, status: "paused", resumeAt });
  });

  fastify.post("/tenants/:id/subscription/resume", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }
    const paramsParsed = z
      .object({ id: z.string().uuid() })
      .safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const subRows = await db
      .select()
      .from(schema.tenantSubscriptions)
      .where(
        eq(schema.tenantSubscriptions.tenantId, paramsParsed.data.id),
      )
      .limit(1);
    const sub = subRows[0];
    if (!sub) {
      return reply.status(404).send({ error: { code: "NO_SUBSCRIPTION" } });
    }
    if (sub.status !== "paused") {
      return reply.status(409).send({ error: { code: "NOT_PAUSED" } });
    }

    const periodMs =
      sub.billingCycle === "yearly"
        ? 365 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
    const now = new Date();
    await db
      .update(schema.tenantSubscriptions)
      .set({
        status: "active",
        resumeAt: null,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + periodMs),
        updatedAt: now,
      })
      .where(
        eq(schema.tenantSubscriptions.tenantId, paramsParsed.data.id),
      );

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.subscription.resumed",
      summary: `Resumed tenant subscription`,
      tenantId: paramsParsed.data.id,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: {
        pausedAt: sub.pausedAt?.toISOString() ?? null,
      },
    });

    return reply.send({ ok: true, status: "active" });
  });

  // figure out why it's there.
  const QuotaOverrideSchema = z.object({
    maxUsers: z.number().int().min(0).max(1_000_000).nullable().optional(),
    maxInvoicesMonthly: z
      .number()
      .int()
      .min(0)
      .max(10_000_000)
      .nullable()
      .optional(),
    maxBranches: z.number().int().min(0).max(10_000).nullable().optional(),
    maxWarehouses: z.number().int().min(0).max(10_000).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    reason: z.string().trim().min(3).max(500),
  });

  fastify.patch(
    "/tenants/:id/subscription/overrides",
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;

      // Gated to super_admin, same as change-plan. Bespoke quota deals
      // are a billing-sensitive action — billing-role staff can read
      // them but shouldn't be able to silently 10x a tenant's cap.
      if (
        !(await requirePlatformRole(req, reply, session, ["super_admin"]))
      ) {
        return;
      }

      const paramsParsed = z
        .object({ id: z.string().uuid() })
        .safeParse(req.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const tenantId = paramsParsed.data.id;

      const bodyParsed = QuotaOverrideSchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: {
            code: "INVALID_INPUT",
            message:
              bodyParsed.error.issues[0]?.message ??
              "One or more override values are invalid.",
          },
        });
      }

      // Load the current subscription so we can diff for the audit
      // line. 404 here mirrors the change-plan behaviour — no
      // subscription row means nothing to override.
      const existingRows = await db
        .select()
        .from(schema.tenantSubscriptions)
        .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) {
        return reply
          .status(404)
          .send({ error: { code: "NO_SUBSCRIPTION" } });
      }

      // Build the update set by picking only the fields the caller
      // actually sent. `undefined` means "leave alone"; explicit
      // `null` means "clear the override". Without the `in` check
      // Drizzle would overwrite unspecified fields with undefined,
      // which serialises to NULL — exactly the bug we want to avoid.
      const body = bodyParsed.data;
      const updateSet: Record<string, number | string | null> = {};
      if ("maxUsers" in body) updateSet.customMaxUsers = body.maxUsers ?? null;
      if ("maxInvoicesMonthly" in body)
        updateSet.customMaxInvoicesMonthly = body.maxInvoicesMonthly ?? null;
      if ("maxBranches" in body)
        updateSet.customMaxBranches = body.maxBranches ?? null;
      if ("maxWarehouses" in body)
        updateSet.customMaxWarehouses = body.maxWarehouses ?? null;
      if ("note" in body) updateSet.customLimitsNote = body.note ?? null;

      if (Object.keys(updateSet).length === 0) {
        return reply.status(400).send({
          error: {
            code: "INVALID_INPUT",
            message: "At least one override field is required.",
          },
        });
      }

      const [updated] = await db
        .update(schema.tenantSubscriptions)
        .set(updateSet)
        .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
        .returning();

      // Audit every override mutation with before/after values for
      // each field. Matters for bespoke-contract disputes six months
      // later — "who set this to 5000 and why?" gets a real answer.
      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.subscription_overrides_changed",
        summary: `Updated quota overrides for tenant`,
        tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: {
          from: {
            maxUsers: existing.customMaxUsers,
            maxInvoicesMonthly: existing.customMaxInvoicesMonthly,
            maxBranches: existing.customMaxBranches,
            maxWarehouses: existing.customMaxWarehouses,
            note: existing.customLimitsNote,
          },
          to: {
            maxUsers: updated?.customMaxUsers ?? null,
            maxInvoicesMonthly: updated?.customMaxInvoicesMonthly ?? null,
            maxBranches: updated?.customMaxBranches ?? null,
            maxWarehouses: updated?.customMaxWarehouses ?? null,
            note: updated?.customLimitsNote ?? null,
          },
          reason: body.reason,
        },
      });

      return reply.send({
        ok: true,
        customLimits: {
          maxUsers: updated?.customMaxUsers ?? null,
          maxInvoicesMonthly: updated?.customMaxInvoicesMonthly ?? null,
          maxBranches: updated?.customMaxBranches ?? null,
          maxWarehouses: updated?.customMaxWarehouses ?? null,
          note: updated?.customLimitsNote ?? null,
        },
      });
    },
  );
};
