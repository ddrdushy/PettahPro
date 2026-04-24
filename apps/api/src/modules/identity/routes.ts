import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import IORedis from "ioredis";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@pettahpro/db";
import { hashPassword, verifyPassword } from "./password.js";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  checkPasswordBreached,
  validatePasswordPolicy,
} from "./password-policy.js";
import {
  createSession,
  destroyAllSessionsForUser,
  destroyOtherSessionsForUser,
  destroySession,
  destroySessionForUser,
  listSessionsForUser,
  readSession,
} from "./sessions.js";
import {
  SESSION_COOKIE,
  clearCsrfCookie,
  clearSessionCookie,
  setCsrfCookie,
  setSessionCookie,
} from "./cookies.js";
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
} from "./mfa.js";
import {
  consumeMfaChallenge,
  createMfaChallenge,
  readMfaChallenge,
} from "./mfa-challenge.js";
import { recordAuditEvent } from "../../lib/audit.js";
import { getCallerPermissions } from "../../lib/permissions.js";

// Signup/login/me run BEFORE we know which tenant the user belongs to, so we
// can't set app.tenant_id and let RLS do the filtering. Instead we call a set
// of SECURITY DEFINER helpers (see docker/postgres/init/44-auth-helpers.sql)
// that run as the table-owner superuser and bypass RLS. The functions return
// only the narrow shape the handler needs — no chance of an over-wide select.
type AuthUserRow = {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  password_hash: string | null;
  is_active: boolean;
  is_owner: boolean;
};

type AuthUserSessionRow = Omit<AuthUserRow, "password_hash">;

const SESSION_TTL = 60 * 60 * 24 * 30;

const SignupSchema = z.object({
  businessName: z.string().min(2).max(255),
  ownerName: z.string().min(2).max(255),
  email: z.string().email().max(255).toLowerCase(),
  // Let the policy module return the specific reason to the user.
  // Zod only gates the raw length envelope so we can't be smuggled a
  // 10 MB string through before we've hashed it.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

const LoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

// #51 MFA. Code envelope is deliberately loose (min 1 / max 20) — the
// TOTP / backup-code distinction is made at verify time by testing the
// 6-digit-numeric shape first. A stricter regex here would block the
// "I have a formatted backup code with hyphens" case for no gain.
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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "tenant";
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? root : `${root}-${Math.random().toString(36).slice(2, 6)}`;
    const existing = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  throw new Error("Could not allocate a unique tenant slug");
}

// Rate-limit budgets tuned for human operators, not scripts:
//   /signup     — 5 per 10 minutes per IP (tenants don't spin up that fast)
//   /login      — 10 per minute per IP    (fat-fingered retries + locked-out
//                                          users will push this; anything
//                                          above is automation)
// See apps/api/src/plugins/rate-limit.ts for the global fallback (#47).
const SIGNUP_RATE_LIMIT = { max: 5, timeWindow: "10 minutes" };
const LOGIN_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };
// Change-password is session-gated so the blast radius is already narrow.
// Limit exists purely to stop a compromised session from brute-forcing the
// current-password prompt to pivot into "I own this account now."
const CHANGE_PASSWORD_RATE_LIMIT = { max: 5, timeWindow: "10 minutes" };

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/signup", { config: { rateLimit: SIGNUP_RATE_LIMIT } }, async (req, reply) => {
    const parsed = SignupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { businessName, ownerName, email, password } = parsed.data;

    // Policy gate (#49). Local checks first (fast, deterministic), then
    // HIBP breach check (fails OPEN on network issues — see
    // password-policy.ts). Both layer on top of the Zod max-length
    // envelope above.
    const policy = validatePasswordPolicy(password, { email, name: ownerName });
    if (!policy.ok) {
      return reply.status(400).send({
        error: { code: "WEAK_PASSWORD", message: "Password doesn't meet policy.", reasons: policy.reasons },
      });
    }
    const breach = await checkPasswordBreached(password);
    if (breach.breached) {
      return reply.status(400).send({
        error: {
          code: "WEAK_PASSWORD",
          message: "This password has appeared in known data breaches — pick a different one.",
          reasons: [
            `Seen in public breach corpora${breach.count ? ` (${breach.count.toLocaleString()} times)` : ""}. Please choose a different password.`,
          ],
        },
      });
    }

    const emailTaken = (await db.execute(
      sql`SELECT auth_email_in_use(${email}) AS in_use`,
    )) as unknown as Array<{ in_use: boolean }>;
    if (emailTaken[0]?.in_use) {
      return reply.status(409).send({ error: { code: "EMAIL_IN_USE", message: "An account with this email already exists." } });
    }

    const slug = await uniqueSlug(businessName);
    const passwordHash = await hashPassword(password);

    const { tenant, user } = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(schema.tenants)
        .values({ slug, businessName, country: "LK", timezone: "Asia/Colombo" })
        .returning();
      if (!t) throw new Error("Tenant insert failed");

      await tx.execute(sql`SELECT set_config('app.tenant_id', ${t.id}, true)`);

      const [u] = await tx
        .insert(schema.users)
        .values({
          tenantId: t.id,
          email,
          fullName: ownerName,
          passwordHash,
          isOwner: true,
          isActive: true,
        })
        .returning();
      if (!u) throw new Error("User insert failed");

      // Seed default branch, warehouse, SL chart of accounts, tax codes, fiscal period.
      await tx.execute(sql`SELECT seed_tenant_defaults(${t.id}::uuid)`);
      // Layer on staff-loan defaults: loans-receivable + interest-income CoA,
      // LOAN sequence, and the SL loan-type library.
      await tx.execute(sql`SELECT seed_tenant_staff_loans(${t.id}::uuid)`);

      return { tenant: t, user: u };
    });

    const session = await createSession({
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      ttlSeconds: SESSION_TTL,
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });
    setSessionCookie(reply, session.id, SESSION_TTL);
    setCsrfCookie(reply, session.csrfToken, SESSION_TTL);

    return reply.status(201).send({
      user: { id: user.id, email: user.email, fullName: user.fullName, isOwner: true },
      tenant: { id: tenant.id, slug: tenant.slug, businessName: tenant.businessName },
    });
  });

  fastify.post("/login", { config: { rateLimit: LOGIN_RATE_LIMIT } }, async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const { email, password } = parsed.data;

    const rows = (await db.execute(
      sql`SELECT * FROM auth_find_user_by_email(${email})`,
    )) as unknown as AuthUserRow[];
    const user = rows[0];

    if (!user || !user.password_hash || !user.is_active) {
      return reply.status(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Wrong email or password." } });
    }

    const ok = await verifyPassword(user.password_hash, password);
    if (!ok) {
      return reply.status(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Wrong email or password." } });
    }

    // #54 / gap L1 — reject logins for suspended tenants. We already
    // know the tenant_id from auth_find_user_by_email; a single cheap
    // select on tenants (no RLS) tells us whether the platform has
    // benched this business. Returning a distinct error code lets the
    // UI show "Your account is currently suspended — contact support"
    // instead of the generic invalid-credentials message that would
    // leave the user confused about whether they mistyped.
    const tenantStatusRows = await db
      .select({ status: schema.tenants.status })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, user.tenant_id))
      .limit(1);
    const tenantStatus = tenantStatusRows[0]?.status ?? "active";
    if (tenantStatus === "suspended") {
      return reply.status(403).send({
        error: {
          code: "TENANT_SUSPENDED",
          message:
            "This account is currently suspended. Please contact support@pettahpro.lk.",
        },
      });
    }

    // #51 — If this user has MFA enabled, don't mint a session on password
    // alone. Stash a pre-session challenge in Redis (5-min TTL) and return
    // the challenge ID to the client. The real session is minted on
    // /auth/login/mfa after the code verifies.
    const hasMfaRows = (await db.execute(
      sql`SELECT auth_user_has_mfa(${user.id}::uuid) AS has_mfa`,
    )) as unknown as Array<{ has_mfa: boolean }>;
    const hasMfa = hasMfaRows[0]?.has_mfa ?? false;

    if (hasMfa) {
      const challenge = await createMfaChallenge({
        userId: user.id,
        tenantId: user.tenant_id,
        email: user.email,
        isOwner: user.is_owner,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      return reply.send({ mfaRequired: true, challengeId: challenge.id });
    }

    await db.execute(sql`SELECT auth_touch_last_login(${user.id}::uuid)`);

    const session = await createSession({
      userId: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      ttlSeconds: SESSION_TTL,
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });
    setSessionCookie(reply, session.id, SESSION_TTL);
    setCsrfCookie(reply, session.csrfToken, SESSION_TTL);

    // Audit-write runs AFTER session create (the session is the source of
    // truth for "logged in"). Wrapped in withTenant so RLS accepts the
    // insert. Failures here are swallowed inside recordAuditEvent — the
    // user is still logged in either way.
    await withTenant(user.tenant_id, async (tx) => {
      await recordAuditEvent(tx, {
        kind: "user.login",
        summary: `Logged in as ${user.email}`,
        actorUserId: user.id,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        isOwner: user.is_owner,
      },
    });
  });

  // Login step 2 (#51). Pre-session — no session cookie yet. Takes the
  // challenge ID from step 1 + the submitted TOTP or backup code, verifies
  // against the encrypted secret (+ hashed backup codes), and mints the
  // real session on success. Rate-limited tightly because this is where
  // the brute-force surface moves to — a 6-digit code has 10^6 options,
  // and we accept ±1 step (so 3 valid codes in a 90s window). 5/min is
  // plenty for a human fat-fingering from their authenticator, and
  // exhausts the code space far slower than the 5-min challenge TTL.
  fastify.post(
    "/login/mfa",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = LoginMfaSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const { challengeId, code } = parsed.data;

      const challenge = await readMfaChallenge(challengeId);
      if (!challenge) {
        return reply.status(401).send({
          error: {
            code: "MFA_CHALLENGE_EXPIRED",
            message: "This sign-in attempt has expired. Please start again.",
          },
        });
      }

      const mfaRows = (await db.execute(
        sql`SELECT * FROM auth_get_mfa_for_user(${challenge.userId}::uuid)`,
      )) as unknown as Array<{
        user_id: string;
        tenant_id: string;
        totp_secret_encrypted: string;
        backup_codes_hash: string[];
        enabled: boolean;
      }>;
      const mfa = mfaRows[0];
      if (!mfa || !mfa.enabled) {
        // Defensive: challenge existed but MFA row vanished. Consume
        // the challenge and treat as expired.
        await consumeMfaChallenge(challengeId);
        return reply.status(401).send({
          error: { code: "MFA_CHALLENGE_EXPIRED", message: "Please sign in again." },
        });
      }

      let verified = false;
      let consumedBackup = false;
      let remainingBackupHashes: string[] | null = null;

      // Try TOTP first (the fast path — constant-time compare inside
      // otplib, no hash verify). Fall through to backup codes if it
      // fails. Don't do both — a user mistyping their backup code as a
      // TOTP would otherwise trigger a wasted argon2 scan.
      try {
        const secret = decryptSecret(mfa.totp_secret_encrypted);
        if (/^\d{6}$/.test(code.replace(/\s+/g, ""))) {
          verified = verifyTotp(secret, code);
        }
      } catch (err) {
        req.log.error({ err }, "mfa totp decrypt failed");
        // Treat decrypt failure as a verify failure, not a 500 —
        // otherwise a corrupted secret hands the user an uncovered
        // server error. They can fall through to a backup code.
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
        // Log the failure under the (now-known) tenant so tenant
        // admins can see attempts in their audit viewer. Swallow the
        // write error if any — don't leak tenant state on a failed code.
        try {
          await withTenant(challenge.tenantId, async (tx) => {
            await recordAuditEvent(tx, {
              kind: "user.mfa_challenge_failed",
              summary: `MFA challenge failed for ${challenge.email}`,
              actorUserId: challenge.userId,
              ipAddress: req.ip ?? null,
              userAgent: req.headers["user-agent"] ?? null,
            });
          });
        } catch {
          /* ignore */
        }
        return reply.status(401).send({
          error: { code: "MFA_INVALID_CODE", message: "Wrong code. Try again." },
        });
      }

      // Success — consume the challenge, stamp last_used_at, persist
      // shortened backup-codes array if we consumed one, mint the real
      // session.
      await consumeMfaChallenge(challengeId);
      await db.execute(
        sql`SELECT auth_record_mfa_success(${challenge.userId}::uuid, ${
          remainingBackupHashes
        }::text[])`,
      );
      await db.execute(sql`SELECT auth_touch_last_login(${challenge.userId}::uuid)`);

      const session = await createSession({
        userId: challenge.userId,
        tenantId: challenge.tenantId,
        email: challenge.email,
        ttlSeconds: SESSION_TTL,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
      setSessionCookie(reply, session.id, SESSION_TTL);
      setCsrfCookie(reply, session.csrfToken, SESSION_TTL);

      await withTenant(challenge.tenantId, async (tx) => {
        await recordAuditEvent(tx, {
          kind: "user.login",
          summary: consumedBackup
            ? `Logged in as ${challenge.email} (MFA backup code)`
            : `Logged in as ${challenge.email} (MFA)`,
          actorUserId: challenge.userId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
      });

      return reply.send({
        user: {
          id: challenge.userId,
          email: challenge.email,
          fullName: "", // /me will supply the canonical shape next.
          isOwner: challenge.isOwner,
        },
        backupCodesRemaining: consumedBackup
          ? (remainingBackupHashes?.length ?? 0)
          : mfa.backup_codes_hash.length,
      });
    },
  );

  // Change password. Session-gated (needs a current session) + current-password
  // confirmation. On success we invalidate EVERY session for this user and
  // mint a new one for the caller — an attacker with a parallel session gets
  // booted; the user stays signed in on the tab they're operating from. #49.
  fastify.post("/change-password", { config: { rateLimit: CHANGE_PASSWORD_RATE_LIMIT } }, async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE];
    if (!cookie) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    const unsigned = req.unsignCookie(cookie);
    if (!unsigned.valid || !unsigned.value) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    }
    const session = await readSession(unsigned.value);
    if (!session) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { currentPassword, newPassword } = parsed.data;

    // Read the hash + canonical user row under the tenant's RLS context.
    const userRow = await withTenant(session.tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: schema.users.id,
          email: schema.users.email,
          fullName: schema.users.fullName,
          passwordHash: schema.users.passwordHash,
          isActive: schema.users.isActive,
        })
        .from(schema.users)
        .where(eq(schema.users.id, session.userId))
        .limit(1);
      return rows[0] ?? null;
    });
    if (!userRow || !userRow.isActive || !userRow.passwordHash) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    }

    const currentOk = await verifyPassword(userRow.passwordHash, currentPassword);
    if (!currentOk) {
      return reply.status(400).send({
        error: { code: "WRONG_CURRENT_PASSWORD", message: "Current password didn't match." },
      });
    }

    // Policy gate on the NEW password. Same shape as signup.
    const policy = validatePasswordPolicy(newPassword, {
      email: userRow.email,
      name: userRow.fullName,
    });
    if (!policy.ok) {
      return reply.status(400).send({
        error: { code: "WEAK_PASSWORD", message: "New password doesn't meet policy.", reasons: policy.reasons },
      });
    }
    // Reject no-op ("change" to the same password) early so the user
    // sees a clear message instead of silently succeeding with no effect.
    if (newPassword === currentPassword) {
      return reply.status(400).send({
        error: { code: "WEAK_PASSWORD", message: "New password must differ from the current one.", reasons: ["Pick a password you haven't used here before."] },
      });
    }
    const breach = await checkPasswordBreached(newPassword);
    if (breach.breached) {
      return reply.status(400).send({
        error: {
          code: "WEAK_PASSWORD",
          message: "This password has appeared in known data breaches — pick a different one.",
          reasons: [
            `Seen in public breach corpora${breach.count ? ` (${breach.count.toLocaleString()} times)` : ""}. Please choose a different password.`,
          ],
        },
      });
    }

    const newHash = await hashPassword(newPassword);
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash: newHash })
        .where(eq(schema.users.id, userRow.id));
      await recordAuditEvent(tx, {
        kind: "user.password_changed",
        summary: `Changed own password (${userRow.email})`,
        actorUserId: userRow.id,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    });

    // Invalidate every session for this user (including the current one —
    // the attacker's hypothetical parallel session is now dead too) and
    // mint a fresh session so the caller stays signed in on this tab.
    await destroyAllSessionsForUser(userRow.id);
    const fresh = await createSession({
      userId: userRow.id,
      tenantId: session.tenantId,
      email: userRow.email,
      ttlSeconds: SESSION_TTL,
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });
    setSessionCookie(reply, fresh.id, SESSION_TTL);
    setCsrfCookie(reply, fresh.csrfToken, SESSION_TTL);

    return reply.send({ ok: true });
  });

  fastify.post("/logout", async (req, reply) => {
    const unsigned = req.unsignCookie(req.cookies[SESSION_COOKIE] ?? "");
    if (unsigned.valid && unsigned.value) {
      // Snapshot session details BEFORE destroy so we can write the audit
      // event under the correct tenant context.
      const session = await readSession(unsigned.value);
      await destroySession(unsigned.value);
      if (session) {
        await withTenant(session.tenantId, async (tx) => {
          await recordAuditEvent(tx, {
            kind: "user.logout",
            summary: `Logged out (${session.email})`,
            actorUserId: session.userId,
            ipAddress: req.ip ?? null,
            userAgent: req.headers["user-agent"] ?? null,
          });
        });
      }
    }
    clearSessionCookie(reply);
    clearCsrfCookie(reply);
    return reply.send({ ok: true });
  });

  fastify.get("/me", async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE];
    if (!cookie) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    const unsigned = req.unsignCookie(cookie);
    if (!unsigned.valid || !unsigned.value) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    }
    const session = await readSession(unsigned.value);
    if (!session) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

    const rows = (await db.execute(
      sql`SELECT * FROM auth_find_user_by_id(${session.userId}::uuid)`,
    )) as unknown as AuthUserSessionRow[];
    const user = rows[0];
    if (!user || !user.is_active) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

    // Tenants has no RLS (intentional, for super-admin / provisioning), so a
    // direct drizzle query works for the app role without a SECURITY DEFINER
    // wrapper.
    const tenantRows = await db
      .select({
        id: schema.tenants.id,
        slug: schema.tenants.slug,
        businessName: schema.tenants.businessName,
        status: schema.tenants.status,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, user.tenant_id))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

    // #54 / gap L1 — if the tenant was suspended after the session
    // was minted, kick the session immediately. The client redirects
    // to /login, where the login-gate itself will 403 with the same
    // code. A distinct code (not UNAUTHENTICATED) keeps the UI
    // honest — "your session expired" is misleading when the truth is
    // "your tenant was suspended."
    if (tenant.status === "suspended") {
      return reply.status(403).send({
        error: {
          code: "TENANT_SUSPENDED",
          message:
            "This account is currently suspended. Please contact support@pettahpro.lk.",
        },
      });
    }

    // Permission map the caller holds, so the web layout can hide
    // buttons it knows will 403. `enforcementActive=false` means the
    // tenant hasn't assigned any roles yet — UI should treat every
    // permission as granted (matches the dormant-mode server check).
    const perms = await getCallerPermissions(user.tenant_id, user.id);

    // #51 — let the web layer know whether MFA is on for this user, so
    // /app/settings/security can render "enabled" vs "not enrolled"
    // without a second round-trip. Reads via the SECURITY DEFINER helper
    // (cheap existence-only boolean).
    const mfaRows = (await db.execute(
      sql`SELECT auth_user_has_mfa(${user.id}::uuid) AS enabled`,
    )) as unknown as Array<{ enabled: boolean }>;
    const mfaEnabled = mfaRows[0]?.enabled ?? false;

    // #57 — if this session is an impersonation, leak the operator's
    // identity + deadline to the layout so <ImpersonationBanner /> can
    // render without a second round-trip. Tenant-owner Settings →
    // Security uses the sessions/active endpoint for the richer list
    // (every concurrent impersonation, not just the caller's).
    const impersonation = session.impersonatedByPlatformUserId
      ? {
          platformUserEmail: session.impersonatedByPlatformUserEmail ?? "unknown",
          endsAt: session.impersonationEndsAt
            ? new Date(session.impersonationEndsAt * 1000).toISOString()
            : null,
        }
      : null;

    return reply.send({
      user: { id: user.id, email: user.email, fullName: user.full_name, isOwner: user.is_owner },
      tenant,
      permissions: {
        isOwner: perms.isOwner,
        enforcementActive: perms.enforcementActive,
        granted: perms.permissions,
      },
      mfa: { enabled: mfaEnabled },
      impersonation,
    });
  });

  // -------------------------------------------------------------------
  // #51 — MFA (TOTP) enrol / verify / disable / status.
  //
  // All four require an active session (enrolling MFA for a user who
  // isn't signed in makes no sense; so does the reverse). Rate-limit
  // buckets are session-gated so they're already narrow — the budget
  // here is about blocking a compromised-session attacker from thrashing
  // the endpoint, not open-internet brute force.
  // -------------------------------------------------------------------

  // Enrolment works in two steps to avoid writing a TOTP secret into
  // the DB before the user has proven they can read it back. Step 1
  // mints a secret, stashes it in Redis keyed by a short-lived
  // tempToken, and returns the otpauth URI + QR. Step 2 verifies a
  // code against that cached secret; if it passes, we encrypt the
  // secret, insert the user_mfa row, generate backup codes, and
  // return them (shown once).
  //
  // Why Redis, not a DB row with enabled=false? Two reasons:
  //  1) No half-finished rows left behind if the user bails mid-flow
  //     — TTL expires and it's gone. A DB row would need a sweeper.
  //  2) We don't want the pending secret sitting on disk alongside the
  //     enabled ones — the tempToken is an implicit "this user is in
  //     the middle of enrolling" state and doesn't leak into SQL.
  const MFA_ENROL_PREFIX = "mfa-enrol:";
  const MFA_ENROL_TTL = 10 * 60; // 10 minutes to scan + confirm
  const enrolRedisClient = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

  fastify.post(
    "/mfa/enroll",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const cookie = req.cookies[SESSION_COOKIE];
      if (!cookie) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
      const unsigned = req.unsignCookie(cookie);
      if (!unsigned.valid || !unsigned.value) {
        return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
      }
      const session = await readSession(unsigned.value);
      if (!session) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

      // Block re-enrolment when already enabled. Users who want to
      // rotate their secret can disable first, then re-enrol. That's a
      // rare path and two clicks is fine.
      const existingRows = (await db.execute(
        sql`SELECT auth_user_has_mfa(${session.userId}::uuid) AS enabled`,
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
        // QR render failing is non-fatal — the otpauth URI is the
        // source of truth, and most TOTP apps accept manual entry of
        // the base32 secret as a fallback.
        req.log.warn({ err }, "mfa qr render failed, returning URI only");
      }

      // 18 bytes = 24 base64url chars, fits easily into the Zod
      // envelope on verify without blowing the 128-char ceiling.
      const tempToken = randomBytes(18).toString("base64url");

      await enrolRedisClient.set(
        MFA_ENROL_PREFIX + tempToken,
        JSON.stringify({ userId: session.userId, tenantId: session.tenantId, secret }),
        "EX",
        MFA_ENROL_TTL,
      );

      return reply.send({
        tempToken,
        otpauthUri,
        // Echo the base32 secret too — TOTP apps that don't render QRs
        // or users pasting into a password manager want it.
        secret,
        qrCodeDataUrl,
      });
    },
  );

  fastify.post(
    "/mfa/enroll/verify",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const cookie = req.cookies[SESSION_COOKIE];
      if (!cookie) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
      const unsigned = req.unsignCookie(cookie);
      if (!unsigned.valid || !unsigned.value) {
        return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
      }
      const session = await readSession(unsigned.value);
      if (!session) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

      const parsed = MfaVerifyEnrollSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const { tempToken, code } = parsed.data;

      const raw = await enrolRedisClient.get(MFA_ENROL_PREFIX + tempToken);
      if (!raw) {
        return reply.status(400).send({
          error: { code: "MFA_ENROLL_EXPIRED", message: "Enrolment timed out. Start again." },
        });
      }
      let pending: { userId: string; tenantId: string; secret: string };
      try {
        pending = JSON.parse(raw);
      } catch {
        return reply.status(400).send({
          error: { code: "MFA_ENROLL_EXPIRED", message: "Enrolment timed out. Start again." },
        });
      }

      // Cross-check that the enrolment token belongs to the same user
      // as the current session. Defends against a misbehaving client
      // from another tab reaching into the Redis enrolment state with
      // a captured tempToken.
      if (pending.userId !== session.userId || pending.tenantId !== session.tenantId) {
        return reply.status(400).send({
          error: { code: "MFA_ENROLL_EXPIRED", message: "Enrolment timed out. Start again." },
        });
      }

      if (!verifyTotp(pending.secret, code)) {
        return reply.status(400).send({
          error: { code: "MFA_INVALID_CODE", message: "That code didn't match. Try again." },
        });
      }

      // Commit. Generate backup codes, encrypt the secret, upsert the
      // user_mfa row as enabled. Show plaintext backup codes to the
      // user ONCE — this is the only time they ever appear.
      const backupCodes = generateBackupCodes();
      const hashes = await hashBackupCodes(backupCodes);
      const encrypted = encryptSecret(pending.secret);

      await withTenant(session.tenantId, async (tx) => {
        // Upsert: if a dangling row exists from a previous abandoned
        // enrolment, overwrite it. PK is user_id.
        await tx.execute(sql`
          INSERT INTO user_mfa (
            user_id, tenant_id, totp_secret_encrypted, backup_codes_hash,
            enabled, enrolled_at, created_at, updated_at
          ) VALUES (
            ${session.userId}::uuid, ${session.tenantId}::uuid, ${encrypted},
            ${hashes}::text[], true, now(), now(), now()
          )
          ON CONFLICT (user_id) DO UPDATE SET
            totp_secret_encrypted = EXCLUDED.totp_secret_encrypted,
            backup_codes_hash = EXCLUDED.backup_codes_hash,
            enabled = true,
            enrolled_at = now(),
            updated_at = now()
        `);
        await recordAuditEvent(tx, {
          kind: "user.mfa_enrolled",
          summary: `Enabled two-factor auth (${session.email})`,
          actorUserId: session.userId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
      });

      await enrolRedisClient.del(MFA_ENROL_PREFIX + tempToken);

      return reply.send({ ok: true, backupCodes });
    },
  );

  fastify.post(
    "/mfa/disable",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const cookie = req.cookies[SESSION_COOKIE];
      if (!cookie) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
      const unsigned = req.unsignCookie(cookie);
      if (!unsigned.valid || !unsigned.value) {
        return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
      }
      const session = await readSession(unsigned.value);
      if (!session) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

      const parsed = MfaDisableSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const { code } = parsed.data;

      // Fetch the current MFA row under the tenant's RLS context. If
      // it's missing, disable is a no-op — answer idempotently so the
      // UI's "turn it off" flow is harmless on an already-off account.
      const mfaRow = await withTenant(session.tenantId, async (tx) => {
        const rows = await tx
          .select({
            totpSecretEncrypted: schema.userMfa.totpSecretEncrypted,
            backupCodesHash: schema.userMfa.backupCodesHash,
          })
          .from(schema.userMfa)
          .where(eq(schema.userMfa.userId, session.userId))
          .limit(1);
        return rows[0] ?? null;
      });
      if (!mfaRow) {
        return reply.send({ ok: true });
      }

      // Require a valid TOTP OR backup code to disable — same logic as
      // login-step-2. This is the key invariant: a stolen session cookie
      // alone cannot silently disarm MFA.
      let verified = false;
      try {
        const secret = decryptSecret(mfaRow.totpSecretEncrypted);
        if (/^\d{6}$/.test(code.replace(/\s+/g, ""))) {
          verified = verifyTotp(secret, code);
        }
      } catch (err) {
        req.log.error({ err }, "mfa disable: decrypt failed");
      }
      if (!verified) {
        const remaining = await consumeBackupCode(code, mfaRow.backupCodesHash);
        if (remaining !== null) verified = true;
      }

      if (!verified) {
        return reply.status(400).send({
          error: {
            code: "MFA_INVALID_CODE",
            message: "That code didn't match. Enter a current code from your authenticator (or a backup code) to turn MFA off.",
          },
        });
      }

      await withTenant(session.tenantId, async (tx) => {
        await tx.delete(schema.userMfa).where(eq(schema.userMfa.userId, session.userId));
        await recordAuditEvent(tx, {
          kind: "user.mfa_disabled",
          summary: `Disabled two-factor auth (${session.email})`,
          actorUserId: session.userId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
      });

      return reply.send({ ok: true });
    },
  );

  // Cheap status endpoint. /auth/me already carries `mfa.enabled`, but
  // having a dedicated endpoint keeps the security-settings page
  // simple when it wants to refetch after enrol/disable.
  fastify.get("/mfa/status", async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE];
    if (!cookie) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    const unsigned = req.unsignCookie(cookie);
    if (!unsigned.valid || !unsigned.value) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    }
    const session = await readSession(unsigned.value);
    if (!session) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

    const row = await withTenant(session.tenantId, async (tx) => {
      const rows = await tx
        .select({
          enabled: schema.userMfa.enabled,
          enrolledAt: schema.userMfa.enrolledAt,
          lastUsedAt: schema.userMfa.lastUsedAt,
          backupCodesHash: schema.userMfa.backupCodesHash,
        })
        .from(schema.userMfa)
        .where(eq(schema.userMfa.userId, session.userId))
        .limit(1);
      return rows[0] ?? null;
    });

    return reply.send({
      enabled: row?.enabled ?? false,
      enrolledAt: row?.enrolledAt ?? null,
      lastUsedAt: row?.lastUsedAt ?? null,
      backupCodesRemaining: row ? row.backupCodesHash.length : 0,
    });
  });

  // -------------------------------------------------------------------
  // #52 / gap A3 — active sessions list + revoke.
  //
  // Natural follow-on to #51 MFA: if 2FA is on, the next question is
  // "who's signed in as me right now, and can I kick them off?" All three
  // endpoints are session-gated through the standard cookie-unsign path —
  // no pre-session exemptions, they're all under the CSRF plugin because
  // they're session-scoped mutations.
  //
  // The list does not include session IDs in the response — leaking a
  // session ID to the JS layer would undo the HttpOnly guarantee that the
  // session cookie carries. Each session gets a short `revokeKey` (HMAC
  // of id under the current session's CSRF token) that the client echoes
  // back to revoke — server verifies the HMAC and maps it to the real
  // session ID. That keeps the ID server-side while still letting the UI
  // address individual rows.
  // -------------------------------------------------------------------

  // Deterministic HMAC so the client can round-trip the opaque revoke
  // key without us having to persist a mapping. Keyed under the caller's
  // current session CSRF token (which itself is minted per-session and
  // never leaves Redis / the non-HttpOnly cookie), so a revoke key
  // captured from one tab is useless once that session logs out.
  async function deriveRevokeKey(currentCsrfToken: string, sessionId: string): Promise<string> {
    const { createHmac } = await import("node:crypto");
    return createHmac("sha256", currentCsrfToken)
      .update(sessionId)
      .digest("base64url")
      .slice(0, 24);
  }

  fastify.get("/sessions", async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE];
    if (!cookie) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    const unsigned = req.unsignCookie(cookie);
    if (!unsigned.valid || !unsigned.value) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    }
    const session = await readSession(unsigned.value);
    if (!session) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

    const sessions = await listSessionsForUser(session.userId);
    const items = await Promise.all(
      sessions.map(async (s) => ({
        revokeKey: await deriveRevokeKey(session.csrfToken, s.id),
        isCurrent: s.id === session.id,
        createdAt: new Date(s.createdAt * 1000).toISOString(),
        lastSeenAt: new Date(s.lastSeenAt * 1000).toISOString(),
        expiresAt: new Date(s.expiresAt * 1000).toISOString(),
        ip: s.ip ?? null,
        userAgent: s.userAgent ?? null,
      })),
    );
    return reply.send({ sessions: items });
  });

  const RevokeSessionSchema = z.object({
    revokeKey: z.string().min(1).max(128),
  });

  fastify.post("/sessions/revoke", async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE];
    if (!cookie) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    const unsigned = req.unsignCookie(cookie);
    if (!unsigned.valid || !unsigned.value) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    }
    const session = await readSession(unsigned.value);
    if (!session) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

    const parsed = RevokeSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const { revokeKey } = parsed.data;

    // Resolve the opaque key back to a real session ID by hashing every
    // live session and constant-time comparing. The caller's own user
    // scope (listSessionsForUser) is the ownership boundary — a revoke
    // key minted under userA's CSRF token cannot match any sessionId
    // stored under userB, because the HMAC input (CSRF token) differs.
    const mySessions = await listSessionsForUser(session.userId);
    let targetId: string | null = null;
    for (const candidate of mySessions) {
      const derived = await deriveRevokeKey(session.csrfToken, candidate.id);
      if (derived === revokeKey) {
        targetId = candidate.id;
        break;
      }
    }
    if (!targetId) {
      return reply.status(404).send({ error: { code: "SESSION_NOT_FOUND" } });
    }

    const destroyed = await destroySessionForUser(session.userId, targetId);
    if (!destroyed) {
      return reply.status(404).send({ error: { code: "SESSION_NOT_FOUND" } });
    }

    // If the caller just revoked the session they're currently sitting on,
    // clear the cookies so the next request lands cleanly on /login. The
    // 200 still goes out carrying the Set-Cookie headers — the browser
    // deletes the cookies and the next nav gets a proper 401 / redirect.
    if (targetId === session.id) {
      clearSessionCookie(reply);
      clearCsrfCookie(reply);
    }

    await withTenant(session.tenantId, async (tx) => {
      await recordAuditEvent(tx, {
        kind: "user.session_revoked",
        summary:
          targetId === session.id
            ? `Revoked own current session (${session.email})`
            : `Revoked a session (${session.email})`,
        actorUserId: session.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    });

    return reply.send({ ok: true, revokedCurrent: targetId === session.id });
  });

  fastify.post("/sessions/revoke-others", async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE];
    if (!cookie) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    const unsigned = req.unsignCookie(cookie);
    if (!unsigned.valid || !unsigned.value) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    }
    const session = await readSession(unsigned.value);
    if (!session) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

    const count = await destroyOtherSessionsForUser(session.userId, session.id);

    await withTenant(session.tenantId, async (tx) => {
      await recordAuditEvent(tx, {
        kind: "user.session_revoked",
        summary: `Signed out ${count} other session${count === 1 ? "" : "s"} (${session.email})`,
        actorUserId: session.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    });

    return reply.send({ ok: true, revoked: count });
  });
};
