// Commission routes — rule CRUD, salesperson link management, earnings
// queries, and a per-salesperson ledger summary.

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, eq, isNull, desc, gte, lte, sql } from "drizzle-orm";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const RuleCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional().default("active"),
  triggerEvent: z.enum(["invoice_posted", "payment_received"]),
  formula: z.enum(["flat_pct", "tiered_volume"]),
  // flat_pct → { bps: number }; tiered_volume → { tiers: [{ upToCents?, bps }] }
  config: z.record(z.string(), z.unknown()),
  salespersonUserIds: z.array(z.string().uuid()).optional().nullable(),
  itemIds: z.array(z.string().uuid()).optional().nullable(),
  customerIds: z.array(z.string().uuid()).optional().nullable(),
  effectiveFrom: DateString.optional(),
  effectiveTo: DateString.optional().nullable(),
  priority: z.number().int().min(0).max(1000).optional().default(100),
});
const RuleUpdateSchema = RuleCreateSchema.partial();

const SalespersonUpsertSchema = z.object({
  userId: z.string().uuid(),
  employeeId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional().default(true),
  defaultRateBps: z.number().int().min(0).max(10_000).optional().nullable(),
  notes: z.string().optional(),
});

const EarningsQuerySchema = z.object({
  salespersonUserId: z.string().uuid().optional(),
  status: z.enum(["accrued", "paid", "clawed_back", "voided"]).optional(),
  from: DateString.optional(),
  to: DateString.optional(),
});

// Validate rule config shape so we don't persist garbage that breaks the engine.
function validateRuleConfig(
  formula: "flat_pct" | "tiered_volume",
  config: Record<string, unknown>,
): string | null {
  if (formula === "flat_pct") {
    const bps = Number((config as { bps?: unknown }).bps);
    if (!Number.isFinite(bps) || bps < 0 || bps > 10_000) {
      return "flat_pct requires config.bps in [0, 10000] (e.g. 300 = 3%)";
    }
    return null;
  }
  if (formula === "tiered_volume") {
    const tiers = (config as { tiers?: unknown }).tiers;
    if (!Array.isArray(tiers) || tiers.length === 0) {
      return "tiered_volume requires config.tiers = [{ upToCents?, bps }, ...]";
    }
    for (const t of tiers as Array<Record<string, unknown>>) {
      const bps = Number(t.bps);
      if (!Number.isFinite(bps) || bps < 0 || bps > 10_000) {
        return "each tier.bps must be in [0, 10000]";
      }
      if (t.upToCents != null) {
        const up = Number(t.upToCents);
        if (!Number.isFinite(up) || up < 0) return "tier.upToCents must be a positive integer or null for 'and above'";
      }
    }
    return null;
  }
  return `Unknown formula: ${String(formula)}`;
}

export const commissionsRoutes: FastifyPluginAsync = async (fastify) => {
  // ---------- Rules ---------------------------------------------------------

  fastify.get("/rules", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.commissionRules)
        .where(
          and(
            eq(schema.commissionRules.tenantId, ctx.tenantId),
            isNull(schema.commissionRules.deletedAt),
          ),
        )
        .orderBy(desc(schema.commissionRules.status), schema.commissionRules.priority),
    );
    return reply.send({ rules: rows });
  });

  fastify.post("/rules", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;
    const parsed = RuleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;
    const configError = validateRuleConfig(input.formula, input.config);
    if (configError) {
      return reply.status(400).send({ error: { code: "INVALID_CONFIG", message: configError } });
    }

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [r] = await tx
        .insert(schema.commissionRules)
        .values({
          tenantId: ctx.tenantId,
          name: input.name,
          description: input.description ?? null,
          status: input.status ?? "active",
          triggerEvent: input.triggerEvent,
          formula: input.formula,
          config: input.config,
          salespersonUserIds: input.salespersonUserIds ?? null,
          itemIds: input.itemIds ?? null,
          customerIds: input.customerIds ?? null,
          effectiveFrom: input.effectiveFrom ?? new Date().toISOString().slice(0, 10),
          effectiveTo: input.effectiveTo ?? null,
          priority: input.priority ?? 100,
          createdByUserId: ctx.userId,
        })
        .returning();
      return r;
    });

    return reply.status(201).send({ rule: row });
  });

  fastify.patch<{ Params: { id: string } }>("/rules/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;
    const parsed = RuleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;
    if (input.formula && input.config) {
      const err = validateRuleConfig(input.formula, input.config);
      if (err) return reply.status(400).send({ error: { code: "INVALID_CONFIG", message: err } });
    }

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [r] = await tx
        .update(schema.commissionRules)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.triggerEvent !== undefined ? { triggerEvent: input.triggerEvent } : {}),
          ...(input.formula !== undefined ? { formula: input.formula } : {}),
          ...(input.config !== undefined ? { config: input.config } : {}),
          ...(input.salespersonUserIds !== undefined ? { salespersonUserIds: input.salespersonUserIds } : {}),
          ...(input.itemIds !== undefined ? { itemIds: input.itemIds } : {}),
          ...(input.customerIds !== undefined ? { customerIds: input.customerIds } : {}),
          ...(input.effectiveFrom !== undefined ? { effectiveFrom: input.effectiveFrom } : {}),
          ...(input.effectiveTo !== undefined ? { effectiveTo: input.effectiveTo } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.commissionRules.tenantId, ctx.tenantId),
            eq(schema.commissionRules.id, req.params.id),
            isNull(schema.commissionRules.deletedAt),
          ),
        )
        .returning();
      return r;
    });

    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ rule: row });
  });

  fastify.delete<{ Params: { id: string } }>("/rules/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;
    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [r] = await tx
        .update(schema.commissionRules)
        .set({ deletedAt: new Date(), status: "inactive", updatedAt: new Date() })
        .where(
          and(
            eq(schema.commissionRules.tenantId, ctx.tenantId),
            eq(schema.commissionRules.id, req.params.id),
            isNull(schema.commissionRules.deletedAt),
          ),
        )
        .returning();
      return r;
    });
    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ ok: true });
  });

  // ---------- Salespeople ---------------------------------------------------

  fastify.get("/salespeople", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const rows = await withTenant(ctx.tenantId, async (tx) => {
      // Join to users + employees so the UI can render friendly names.
      const result = await tx.execute(sql`
        SELECT
          cs.id, cs.user_id AS "userId", cs.employee_id AS "employeeId",
          cs.is_active AS "isActive", cs.default_rate_bps AS "defaultRateBps",
          cs.notes, cs.created_at AS "createdAt",
          u.full_name AS "userFullName", u.email AS "userEmail",
          e.full_name AS "employeeFullName", e.employee_code AS "employeeCode"
        FROM commission_salespeople cs
        INNER JOIN users u ON u.id = cs.user_id AND u.tenant_id = cs.tenant_id
        LEFT  JOIN employees e ON e.id = cs.employee_id AND e.tenant_id = cs.tenant_id AND e.deleted_at IS NULL
        WHERE cs.tenant_id = current_tenant_id()
        ORDER BY u.full_name
      `);
      return result;
    });
    return reply.send({ salespeople: rows });
  });

  fastify.put("/salespeople", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;
    const parsed = SalespersonUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx
        .select()
        .from(schema.commissionSalespeople)
        .where(
          and(
            eq(schema.commissionSalespeople.tenantId, ctx.tenantId),
            eq(schema.commissionSalespeople.userId, input.userId),
          ),
        )
        .limit(1);

      if (existing[0]) {
        const [updated] = await tx
          .update(schema.commissionSalespeople)
          .set({
            employeeId: input.employeeId ?? null,
            isActive: input.isActive ?? true,
            defaultRateBps: input.defaultRateBps ?? null,
            notes: input.notes ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.commissionSalespeople.id, existing[0].id))
          .returning();
        return updated;
      }
      const [inserted] = await tx
        .insert(schema.commissionSalespeople)
        .values({
          tenantId: ctx.tenantId,
          userId: input.userId,
          employeeId: input.employeeId ?? null,
          isActive: input.isActive ?? true,
          defaultRateBps: input.defaultRateBps ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      return inserted;
    });

    return reply.send({ salesperson: row });
  });

  fastify.delete<{ Params: { userId: string } }>("/salespeople/:userId", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;
    await withTenant(ctx.tenantId, async (tx) =>
      tx
        .delete(schema.commissionSalespeople)
        .where(
          and(
            eq(schema.commissionSalespeople.tenantId, ctx.tenantId),
            eq(schema.commissionSalespeople.userId, req.params.userId),
          ),
        ),
    );
    return reply.send({ ok: true });
  });

  // ---------- Earnings ------------------------------------------------------

  fastify.get("/earnings", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const parsed = EarningsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const q = parsed.data;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const conds = [
        eq(schema.commissionEarnings.tenantId, ctx.tenantId),
      ];
      if (q.salespersonUserId) conds.push(eq(schema.commissionEarnings.salespersonUserId, q.salespersonUserId));
      if (q.status) conds.push(eq(schema.commissionEarnings.status, q.status));
      if (q.from) conds.push(gte(schema.commissionEarnings.earnedAt, q.from));
      if (q.to) conds.push(lte(schema.commissionEarnings.earnedAt, q.to));

      return tx
        .select({
          id: schema.commissionEarnings.id,
          ruleId: schema.commissionEarnings.ruleId,
          ruleName: schema.commissionRules.name,
          salespersonUserId: schema.commissionEarnings.salespersonUserId,
          sourceType: schema.commissionEarnings.sourceType,
          sourceId: schema.commissionEarnings.sourceId,
          sourceNumber: schema.commissionEarnings.sourceNumber,
          customerId: schema.commissionEarnings.customerId,
          customerName: schema.customers.name,
          baseCents: schema.commissionEarnings.baseCents,
          rateBps: schema.commissionEarnings.rateBps,
          amountCents: schema.commissionEarnings.amountCents,
          status: schema.commissionEarnings.status,
          earnedAt: schema.commissionEarnings.earnedAt,
          paidInRunId: schema.commissionEarnings.paidInRunId,
          memo: schema.commissionEarnings.memo,
        })
        .from(schema.commissionEarnings)
        .leftJoin(
          schema.commissionRules,
          eq(schema.commissionRules.id, schema.commissionEarnings.ruleId),
        )
        .leftJoin(
          schema.customers,
          eq(schema.customers.id, schema.commissionEarnings.customerId),
        )
        .where(and(...conds))
        .orderBy(desc(schema.commissionEarnings.earnedAt))
        .limit(500);
    });
    return reply.send({ earnings: rows });
  });

  // Ledger = one row per salesperson with accrued / paid / clawed-back totals.
  fastify.get("/ledger", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx.execute(sql`
        SELECT
          ce.salesperson_user_id AS "salespersonUserId",
          u.full_name            AS "fullName",
          u.email                AS "email",
          COALESCE(SUM(CASE WHEN ce.status = 'accrued'     THEN ce.amount_cents ELSE 0 END), 0)::bigint AS "accruedCents",
          COALESCE(SUM(CASE WHEN ce.status = 'paid'        THEN ce.amount_cents ELSE 0 END), 0)::bigint AS "paidCents",
          COALESCE(SUM(CASE WHEN ce.status = 'clawed_back' THEN ce.amount_cents ELSE 0 END), 0)::bigint AS "clawedBackCents",
          COALESCE(SUM(ce.amount_cents), 0)::bigint                                                    AS "totalCents",
          COUNT(*)::int AS "rowCount"
        FROM commission_earnings ce
        INNER JOIN users u ON u.id = ce.salesperson_user_id AND u.tenant_id = ce.tenant_id
        WHERE ce.tenant_id = current_tenant_id()
        GROUP BY ce.salesperson_user_id, u.full_name, u.email
        ORDER BY "accruedCents" DESC, u.full_name
      `),
    );
    return reply.send({ ledger: rows });
  });
};
