import type { FastifyPluginAsync } from "fastify";
import { eq, and, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@pettahpro/db";
import { hashPassword, verifyPassword } from "./password.js";
import { createSession, destroySession, readSession } from "./sessions.js";
import { SESSION_COOKIE, clearSessionCookie, setSessionCookie } from "./cookies.js";

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

    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
      .limit(1);
    if (existing.length > 0) {
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

    const rows = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
      .limit(1);
    const user = rows[0];

    if (!user || !user.passwordHash || !user.isActive) {
      return reply.status(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Wrong email or password." } });
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      return reply.status(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Wrong email or password." } });
    }

    await db
      .update(schema.users)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.users.id, user.id));

    const session = await createSession({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      ttlSeconds: SESSION_TTL,
    });
    setSessionCookie(reply, session.id, SESSION_TTL);

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isOwner: user.isOwner,
      },
    });
  });

  fastify.post("/logout", async (req, reply) => {
    const unsigned = req.unsignCookie(req.cookies[SESSION_COOKIE] ?? "");
    if (unsigned.valid && unsigned.value) {
      await destroySession(unsigned.value);
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

    const rows = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        fullName: schema.users.fullName,
        isOwner: schema.users.isOwner,
        tenantId: schema.users.tenantId,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, session.userId), isNull(schema.users.deletedAt)))
      .limit(1);
    const user = rows[0];
    if (!user) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

    const tenantRows = await db
      .select({
        id: schema.tenants.id,
        slug: schema.tenants.slug,
        businessName: schema.tenants.businessName,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, user.tenantId))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant) return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });

    return reply.send({
      user: { id: user.id, email: user.email, fullName: user.fullName, isOwner: user.isOwner },
      tenant,
    });
  });
};
