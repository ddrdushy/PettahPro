import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// FX rates — manual tenant-scoped rate history. Used for display lookup
// on invoices/bills/payments in non-LKR currencies, and as the input for
// future revaluation reports (v2).
//
// v1 is deliberately minimal: list + create + delete. No bulk import, no
// external API sync, no automatic today-rate suggestion. The UI lets the
// user paste a single row; duplicate (tenant, from, to, date) is blocked
// at the DB level via UNIQUE constraint.

const CreateSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate: z.number().positive(),
  source: z.string().max(32).optional(),
  note: z.string().max(500).optional(),
});

export const fxRatesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /fx-rates — list, newest first. Optional ?from=&to= filter lets
  // the invoice/bill form look up "today's USD→LKR rate" efficiently.
  fastify.get<{ Querystring: { from?: string; to?: string; limit?: string } }>(
    "/",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const { from, to } = req.query;
      const limit = Math.min(Number(req.query.limit ?? 200) || 200, 500);

      const rows = await withTenant(ctx.tenantId, async (tx) => {
        const conds = [eq(schema.fxRates.tenantId, ctx.tenantId)];
        if (from) conds.push(eq(schema.fxRates.fromCurrency, from.toUpperCase()));
        if (to) conds.push(eq(schema.fxRates.toCurrency, to.toUpperCase()));
        return tx
          .select()
          .from(schema.fxRates)
          .where(and(...conds))
          .orderBy(desc(schema.fxRates.rateDate), desc(schema.fxRates.createdAt))
          .limit(limit);
      });

      return reply.send({ rates: rows });
    },
  );

  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;
    const from = input.fromCurrency.toUpperCase();
    const to = input.toCurrency.toUpperCase();
    if (from === to) {
      return reply.status(400).send({
        error: { code: "SAME_CURRENCY", message: "from and to currency must differ." },
      });
    }

    try {
      const rate = await withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .insert(schema.fxRates)
          .values({
            tenantId: ctx.tenantId,
            fromCurrency: from,
            toCurrency: to,
            rateDate: input.rateDate,
            rate: input.rate.toString(),
            source: input.source ?? "manual",
            note: input.note ?? null,
            createdByUserId: ctx.userId,
          })
          .returning();
        return row;
      });
      return reply.status(201).send({ rate });
    } catch (err: unknown) {
      // UNIQUE (tenant, from, to, date) collision — tell the user
      // instead of surfacing a generic 500.
      if (err instanceof Error && /fx_rates_tenant_pair_date_unique/.test(err.message)) {
        return reply.status(409).send({
          error: {
            code: "DUPLICATE_RATE",
            message: "A rate for this currency pair already exists on this date.",
          },
        });
      }
      throw err;
    }
  });

  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const deleted = await withTenant(ctx.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        DELETE FROM fx_rates
        WHERE id = ${req.params.id}::uuid
          AND tenant_id = current_tenant_id()
        RETURNING id
      `);
      return (result as unknown as { rowCount?: number }).rowCount ?? 0;
    });

    if (!deleted) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    return reply.status(204).send();
  });
};
