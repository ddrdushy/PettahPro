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
  destroyPlatformSession,
  readPlatformSession,
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

/**
 * Pull the platform session off the signed cookie. Returns null and
 * writes the 401 for the caller so routes read top-to-bottom.
 */
async function requirePlatformSession(
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
      await db
        .update(schema.platformUsers)
        .set({ lastLoginAt: new Date() })
        .where(eq(schema.platformUsers.id, challenge.platformUserId));

      const session = await createPlatformSession({
        platformUserId: challenge.platformUserId,
        email: challenge.email,
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

    return reply.send({
      user: { id: user.id, email: user.email, fullName: user.fullName },
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
      const aggRows = (await db.execute(
        sql`
          SELECT t.id AS tenant_id,
                 platform_count_users(t.id) AS user_count,
                 platform_last_login(t.id)  AS last_login_at
            FROM tenants t
           WHERE t.id = ANY(${ids}::uuid[])
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
};
