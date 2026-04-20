import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, asc } from "drizzle-orm";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

export const coaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const accounts = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .orderBy(asc(schema.chartOfAccounts.code)),
    );
    return reply.send({ accounts });
  });
};

export const taxCodesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const taxCodes = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.taxCodes)
        .where(
          and(
            eq(schema.taxCodes.tenantId, ctx.tenantId),
            isNull(schema.taxCodes.deletedAt),
          ),
        )
        .orderBy(asc(schema.taxCodes.code)),
    );
    return reply.send({ taxCodes });
  });
};
