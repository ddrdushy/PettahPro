import type { FastifyPluginAsync } from "fastify";
import { eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@pettahpro/db";
import { requirePermission } from "../../lib/permissions.js";

/**
 * Demo-data routes (#136 / gaps I1).
 *
 *   GET    /demo-data           — count of demo records still tracked.
 *   POST   /demo-data/load      — runs seed_demo_data() for the tenant.
 *   POST   /demo-data/clear     — runs clear_demo_data() for the tenant.
 *
 * Seed and clear are SQL functions (see 99-demo-data.sql) so they
 * run inside one transaction with the same RLS context. The route
 * layer just gates on `settings.manage` permission and returns the
 * before/after counts so the UI can flip the button state.
 */

export const demoDataRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.demoDataSeeds)
        .where(eq(schema.demoDataSeeds.tenantId, ctx.tenantId)),
    );
    return reply.send({ seededRecordCount: rows[0]?.count ?? 0 });
  });

  fastify.post("/load", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const inserted = await withTenant(ctx.tenantId, async (tx) => {
      const result = await tx.execute(
        sql`SELECT seed_demo_data(${ctx.tenantId}::uuid) AS inserted`,
      );
      // drizzle returns rows as either `.rows` or directly iterable
      // depending on driver — the postgres-js driver used here returns
      // an array-like result with `[0].inserted`.
      const row = (result as unknown as Array<{ inserted: number }>)[0];
      return Number(row?.inserted ?? 0);
    });

    return reply.send({ inserted });
  });

  fastify.post("/clear", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const deleted = await withTenant(ctx.tenantId, async (tx) => {
      const result = await tx.execute(
        sql`SELECT clear_demo_data(${ctx.tenantId}::uuid) AS deleted`,
      );
      const row = (result as unknown as Array<{ deleted: number }>)[0];
      return Number(row?.deleted ?? 0);
    });

    return reply.send({ deleted });
  });
};
