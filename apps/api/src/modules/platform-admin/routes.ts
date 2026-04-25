import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, isNull, sql, ilike, or, count } from "drizzle-orm";
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
    const { status, search, limit, offset } = parsed.data;

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

    // Correlated subqueries for user count + last login per tenant.
    // Tenants table has no RLS so a direct query works; users/mfa do
    // have RLS but the aggregate-over-all-tenants case is served by
    // the `no app.tenant_id set` short-circuit — at the DB layer we'll
    // paginate via COUNT(*) over users with tenant_id in the returned
    // list instead. Simpler: LATERAL subqueries. Since LATERAL on a
    // column from outer won't go through RLS cleanly, use a separate
    // aggregate pull after the main tenant list and stitch client-side.
    const whereClause = and(...clauses);
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
      })
      .from(schema.tenants)
      .where(whereClause)
      .orderBy(desc(schema.tenants.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ count: count() })
      .from(schema.tenants)
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
      const aggRows = (await db.execute(
        sql`
          SELECT t.id AS tenant_id,
                 platform_count_users(t.id) AS user_count,
                 platform_last_login(t.id)  AS last_login_at
            FROM tenants t
           WHERE t.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
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
    const tenantId = paramsParsed.data.id;
    const reason = bodyParsed.data.reason;

    const rows = await db
      .select()
      .from(schema.tenants)
      .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)))
      .limit(1);
    const tenant = rows[0];
    if (!tenant) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }

    // Idempotent — if already in the target state, audit the attempt
    // and return success. Avoids UI flicker on a double-click.
    if (tenant.status === nextStatus) {
      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: `${kind}.noop` as string,
        summary: `${summaryVerb} (no-op, already ${nextStatus}): ${tenant.businessName}`,
        reason,
        tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      return reply.send({ ok: true, status: tenant.status });
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
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    return reply.send({ ok: true, status: nextStatus });
  }

  fastify.post("/tenants/:id/suspend", async (req, reply) => {
    return applyStatus(req, reply, "suspended", "platform.tenant_suspended", "Suspended tenant");
  });

  fastify.post("/tenants/:id/reactivate", async (req, reply) => {
    return applyStatus(req, reply, "active", "platform.tenant_reactivated", "Reactivated tenant");
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
};
