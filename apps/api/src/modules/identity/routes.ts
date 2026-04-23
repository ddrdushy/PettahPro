import type { FastifyPluginAsync } from "fastify";
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
  destroySession,
  readSession,
} from "./sessions.js";
import {
  SESSION_COOKIE,
  clearCsrfCookie,
  clearSessionCookie,
  setCsrfCookie,
  setSessionCookie,
} from "./cookies.js";
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

    await db.execute(sql`SELECT auth_touch_last_login(${user.id}::uuid)`);

    const session = await createSession({
      userId: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      ttlSeconds: SESSION_TTL,
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
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, user.tenant_id))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

    // Permission map the caller holds, so the web layout can hide
    // buttons it knows will 403. `enforcementActive=false` means the
    // tenant hasn't assigned any roles yet — UI should treat every
    // permission as granted (matches the dormant-mode server check).
    const perms = await getCallerPermissions(user.tenant_id, user.id);

    return reply.send({
      user: { id: user.id, email: user.email, fullName: user.full_name, isOwner: user.is_owner },
      tenant,
      permissions: {
        isOwner: perms.isOwner,
        enforcementActive: perms.enforcementActive,
        granted: perms.permissions,
      },
    });
  });
};
