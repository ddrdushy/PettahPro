import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, isNull, sql, ilike, or, count } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@pettahpro/db";
import { hashPassword, verifyPassword } from "../identity/password.js";
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

    return reply.send({
      user: { id: user.id, email: user.email, fullName: user.fullName },
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
