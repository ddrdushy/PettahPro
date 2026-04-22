import type { FastifyPluginAsync } from "fastify";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@pettahpro/db";
import { hashPassword, verifyPassword } from "./password.js";
import { createSession, destroySession, readSession } from "./sessions.js";
import { SESSION_COOKIE, clearSessionCookie, setSessionCookie } from "./cookies.js";
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
  password: z.string().min(8).max(128),
});

const LoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
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

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/signup", async (req, reply) => {
    const parsed = SignupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { businessName, ownerName, email, password } = parsed.data;

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

    return reply.status(201).send({
      user: { id: user.id, email: user.email, fullName: user.fullName, isOwner: true },
      tenant: { id: tenant.id, slug: tenant.slug, businessName: tenant.businessName },
    });
  });

  fastify.post("/login", async (req, reply) => {
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
