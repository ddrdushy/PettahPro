import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, asc, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "../accounting/journal-posting.js";
import { resolveStockGLAccounts } from "./stock-posting.js";

// -----------------------------------------------------------------------------
// Reason codes
// -----------------------------------------------------------------------------
// Hard-coded v1 set from inventory-module-spec §4.3. Tenants that want their
// own reason taxonomy can slot a table in later without changing the count
// schema — `reason_code` is just a varchar at the storage layer.
const REASON_CODES = [
  "damage",
  "theft",
  "expiry",
  "shrinkage",
  "miscount",
  "sample",
  "system_error",
  "other",
] as const;
type ReasonCode = (typeof REASON_CODES)[number];

const LineInputSchema = z.object({
  itemId: z.string().uuid(),
});

// POST /stock-counts — creates a draft count and snapshots system_qty +
// system_avg_cost per item in scope. Two scopes in v1:
//   - 'warehouse': every item that has a balance row (even zero) in the
//     warehouse, plus a choice to include "all items the tenant tracks"
//     via scope_type='warehouse' + include_zero=true.
//   - 'items': explicit item list (e.g. a focused cycle count on a category
//     or a shortlist picked by the user).
const CreateSchema = z
  .object({
    warehouseId: z.string().uuid(),
    countDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    scopeType: z.enum(["warehouse", "items"]).default("warehouse"),
    lines: z.array(LineInputSchema).max(2000).optional(),
    notes: z.string().max(2000).optional().or(z.literal("")),
    varianceThresholdBps: z.number().int().min(0).max(10_000).optional(),
  })
  .refine(
    (v) => v.scopeType !== "items" || (v.lines && v.lines.length > 0),
    { message: "scopeType='items' requires a non-empty lines array" },
  );

// PATCH /stock-counts/:id/lines — entering counted quantities. Blind-count:
// the user is just filling counted_qty per line; reason_code + notes come
// later at review. Partial patches allowed (save-often workflow).
const CountLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        countedQty: z.number().min(0).max(1_000_000_000),
      }),
    )
    .min(1)
    .max(2000),
});

// POST /stock-counts/:id/review — computes variance + reason assignments.
// Client sends the full reason map for all non-zero-variance lines.
const ReviewSchema = z.object({
  reasons: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        reasonCode: z.enum(REASON_CODES),
        notes: z.string().max(500).optional(),
      }),
    )
    .max(2000)
    .optional(),
});

export const stockCountsRoutes: FastifyPluginAsync = async (fastify) => {
  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = (await withTenant(ctx.tenantId, async (tx) =>
      tx.execute(sql`
        SELECT sc.id,
               sc.count_number,
               sc.status,
               sc.count_date::text AS count_date,
               sc.scope_type,
               sc.requires_approval,
               sc.max_variance_bps,
               sc.total_variance_value_cents,
               sc.posted_at,
               sc.created_at,
               w.code AS warehouse_code,
               w.name AS warehouse_name,
               (SELECT COUNT(*)::int FROM stock_count_lines scl
                 WHERE scl.stock_count_id = sc.id) AS line_count,
               (SELECT COUNT(*)::int FROM stock_count_lines scl
                 WHERE scl.stock_count_id = sc.id
                   AND scl.counted_qty IS NOT NULL) AS counted_count
          FROM stock_counts sc
          INNER JOIN warehouses w ON w.id = sc.warehouse_id
         WHERE sc.tenant_id = current_tenant_id()
           AND sc.deleted_at IS NULL
         ORDER BY sc.created_at DESC
         LIMIT 200
      `),
    )) as unknown as Array<{
      id: string;
      count_number: string | null;
      status: string;
      count_date: string;
      scope_type: string;
      requires_approval: boolean;
      max_variance_bps: number | null;
      total_variance_value_cents: number | null;
      posted_at: string | null;
      created_at: string;
      warehouse_code: string;
      warehouse_name: string;
      line_count: number;
      counted_count: number;
    }>;

    return reply.send({
      counts: rows.map((r) => ({
        id: r.id,
        countNumber: r.count_number,
        status: r.status,
        countDate: r.count_date,
        scopeType: r.scope_type,
        requiresApproval: r.requires_approval,
        maxVarianceBps: r.max_variance_bps,
        totalVarianceValueCents: r.total_variance_value_cents,
        postedAt: r.posted_at,
        createdAt: r.created_at,
        warehouseCode: r.warehouse_code,
        warehouseName: r.warehouse_name,
        lineCount: r.line_count,
        countedCount: r.counted_count,
      })),
    });
  });

  // ---------------------------------------------------------------------------
  // Detail (header + lines, joined with item name/sku for display).
  //
  // Blind-count UX note: the list returns system_qty for every line regardless
  // of status. We intentionally do *not* hide it at the API layer — a counter
  // using the mobile UI shouldn't be hitting this endpoint for data entry; the
  // web UI hides the column on the entry page. Mixing the blind-count rule
  // into the API would make the review/post pages awkward.
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [header] = await tx
        .select()
        .from(schema.stockCounts)
        .where(
          and(
            eq(schema.stockCounts.tenantId, ctx.tenantId),
            eq(schema.stockCounts.id, req.params.id),
            isNull(schema.stockCounts.deletedAt),
          ),
        )
        .limit(1);
      if (!header) return null;

      const lines = (await tx.execute(sql`
        SELECT scl.id,
               scl.line_no,
               scl.item_id,
               i.sku       AS item_sku,
               i.name      AS item_name,
               i.uom       AS item_uom,
               scl.system_qty,
               scl.system_avg_cost_cents,
               scl.counted_qty,
               scl.variance_qty,
               scl.variance_value_cents,
               scl.reason_code,
               scl.notes
          FROM stock_count_lines scl
          INNER JOIN items i ON i.id = scl.item_id
         WHERE scl.stock_count_id = ${header.id}::uuid
         ORDER BY scl.line_no ASC
      `)) as unknown as Array<{
        id: string;
        line_no: number;
        item_id: string;
        item_sku: string;
        item_name: string;
        item_uom: string | null;
        system_qty: string;
        system_avg_cost_cents: number;
        counted_qty: string | null;
        variance_qty: string | null;
        variance_value_cents: number | null;
        reason_code: string | null;
        notes: string | null;
      }>;

      const [wh] = await tx
        .select({
          id: schema.warehouses.id,
          code: schema.warehouses.code,
          name: schema.warehouses.name,
        })
        .from(schema.warehouses)
        .where(eq(schema.warehouses.id, header.warehouseId))
        .limit(1);

      return { header, lines, wh };
    });

    if (!result) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({
      count: {
        ...result.header,
        warehouse: result.wh,
        lines: result.lines.map((l) => ({
          id: l.id,
          lineNo: l.line_no,
          itemId: l.item_id,
          itemSku: l.item_sku,
          itemName: l.item_name,
          itemUom: l.item_uom,
          systemQty: Number(l.system_qty),
          systemAvgCostCents: l.system_avg_cost_cents,
          countedQty: l.counted_qty === null ? null : Number(l.counted_qty),
          varianceQty: l.variance_qty === null ? null : Number(l.variance_qty),
          varianceValueCents: l.variance_value_cents,
          reasonCode: l.reason_code,
          notes: l.notes,
        })),
        reasonCodes: REASON_CODES,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Create — snapshots item balances into lines at draft time.
  // ---------------------------------------------------------------------------
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;
    const countDate = input.countDate ?? new Date().toISOString().slice(0, 10);

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Validate warehouse.
      const [wh] = await tx
        .select({ id: schema.warehouses.id })
        .from(schema.warehouses)
        .where(
          and(
            eq(schema.warehouses.tenantId, ctx.tenantId),
            eq(schema.warehouses.id, input.warehouseId),
            isNull(schema.warehouses.deletedAt),
          ),
        )
        .limit(1);
      if (!wh) return { error: "WAREHOUSE_NOT_FOUND" as const };

      // Snapshot scope.
      //
      // scope='warehouse' → every item that has a balance row in this
      // warehouse (incl. zero-qty items so that "I shelved a new SKU and
      // never sold it" shows up as a variance from 0 to counted qty).
      //
      // scope='items' → only the items the caller nominated. We still snap
      // the current balance (or 0 if none) so the variance math is honest
      // against books.
      type ScopeRow = { itemId: string; systemQty: number; systemAvgCostCents: number };
      let scopeRows: ScopeRow[] = [];

      if (input.scopeType === "warehouse") {
        const rows = (await tx.execute(sql`
          SELECT ib.item_id AS item_id,
                 ib.quantity_on_hand::text AS qty,
                 ib.average_cost_cents AS avg_cost
            FROM item_balances ib
            INNER JOIN items i ON i.id = ib.item_id
           WHERE ib.tenant_id = ${ctx.tenantId}::uuid
             AND ib.warehouse_id = ${input.warehouseId}::uuid
             AND i.deleted_at IS NULL
           ORDER BY i.sku ASC
        `)) as unknown as Array<{ item_id: string; qty: string; avg_cost: number }>;
        scopeRows = rows.map((r) => ({
          itemId: r.item_id,
          systemQty: Number(r.qty),
          systemAvgCostCents: r.avg_cost,
        }));
      } else {
        const ids = Array.from(new Set((input.lines ?? []).map((l) => l.itemId)));
        if (ids.length === 0) return { error: "EMPTY_SCOPE" as const };

        // Validate items exist in tenant.
        const found = await tx
          .select({ id: schema.items.id })
          .from(schema.items)
          .where(
            and(
              eq(schema.items.tenantId, ctx.tenantId),
              inArray(schema.items.id, ids),
              isNull(schema.items.deletedAt),
            ),
          );
        if (found.length !== ids.length) return { error: "ITEM_NOT_FOUND" as const };

        const bals = await tx
          .select({
            itemId: schema.itemBalances.itemId,
            qty: schema.itemBalances.quantityOnHand,
            avg: schema.itemBalances.averageCostCents,
          })
          .from(schema.itemBalances)
          .where(
            and(
              eq(schema.itemBalances.tenantId, ctx.tenantId),
              eq(schema.itemBalances.warehouseId, input.warehouseId),
              inArray(schema.itemBalances.itemId, ids),
            ),
          );
        const byItem = new Map(bals.map((b) => [b.itemId, { qty: Number(b.qty), avg: b.avg }]));
        scopeRows = ids.map((itemId) => {
          const b = byItem.get(itemId);
          return {
            itemId,
            systemQty: b?.qty ?? 0,
            systemAvgCostCents: b?.avg ?? 0,
          };
        });
      }

      if (scopeRows.length === 0) {
        return { error: "EMPTY_SCOPE" as const };
      }

      const [header] = await tx
        .insert(schema.stockCounts)
        .values({
          tenantId: ctx.tenantId,
          warehouseId: input.warehouseId,
          countDate,
          scopeType: input.scopeType,
          notes: input.notes && input.notes.trim() ? input.notes.trim() : null,
          varianceThresholdBps: input.varianceThresholdBps ?? 100,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!header) throw new Error("INSERT_FAILED");

      await tx.insert(schema.stockCountLines).values(
        scopeRows.map((r, idx) => ({
          tenantId: ctx.tenantId,
          stockCountId: header.id,
          lineNo: idx + 1,
          itemId: r.itemId,
          systemQty: r.systemQty.toString(),
          systemAvgCostCents: r.systemAvgCostCents,
        })),
      );

      return { ok: true as const, id: header.id };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        WAREHOUSE_NOT_FOUND: 400,
        ITEM_NOT_FOUND: 400,
        EMPTY_SCOPE: 400,
      };
      return reply.status(map[result.error] ?? 500).send({ error: { code: result.error } });
    }
    return reply.status(201).send({ id: result.id });
  });

  // ---------------------------------------------------------------------------
  // PATCH /:id/lines — set counted_qty on one or more lines. Allowed only
  // while the count is draft.
  // ---------------------------------------------------------------------------
  fastify.patch<{ Params: { id: string } }>("/:id/lines", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CountLinesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [header] = await tx
        .select()
        .from(schema.stockCounts)
        .where(
          and(
            eq(schema.stockCounts.tenantId, ctx.tenantId),
            eq(schema.stockCounts.id, req.params.id),
            isNull(schema.stockCounts.deletedAt),
          ),
        )
        .limit(1);
      if (!header) return { error: "NOT_FOUND" as const };
      if (header.status !== "draft") return { error: "NOT_DRAFT" as const };

      for (const l of parsed.data.lines) {
        await tx
          .update(schema.stockCountLines)
          .set({ countedQty: l.countedQty.toString() })
          .where(
            and(
              eq(schema.stockCountLines.id, l.lineId),
              eq(schema.stockCountLines.stockCountId, header.id),
              eq(schema.stockCountLines.tenantId, ctx.tenantId),
            ),
          );
      }

      await tx
        .update(schema.stockCounts)
        .set({ countedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.stockCounts.id, header.id));

      return { ok: true as const };
    });

    if ("error" in result) {
      const map: Record<string, number> = { NOT_FOUND: 404, NOT_DRAFT: 409 };
      return reply.status(map[result.error] ?? 500).send({ error: { code: result.error } });
    }
    return reply.send(result);
  });

  // ---------------------------------------------------------------------------
  // POST /:id/review — lock in counted qty, compute variance per line, stamp
  // reason codes, bump status to review (or pending_approval if over the
  // threshold). Reason codes are mandatory on every line with variance ≠ 0.
  // ---------------------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>("/:id/review", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ReviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const reasonsInput = parsed.data.reasons ?? [];

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [header] = await tx
        .select()
        .from(schema.stockCounts)
        .where(
          and(
            eq(schema.stockCounts.tenantId, ctx.tenantId),
            eq(schema.stockCounts.id, req.params.id),
            isNull(schema.stockCounts.deletedAt),
          ),
        )
        .limit(1);
      if (!header) return { error: "NOT_FOUND" as const };
      if (header.status !== "draft") return { error: "NOT_DRAFT" as const };

      const lines = await tx
        .select()
        .from(schema.stockCountLines)
        .where(eq(schema.stockCountLines.stockCountId, header.id))
        .orderBy(asc(schema.stockCountLines.lineNo));

      // Every line must have counted_qty set.
      const uncounted = lines.filter((l) => l.countedQty === null);
      if (uncounted.length > 0) {
        return { error: "UNCOUNTED_LINES" as const, count: uncounted.length };
      }

      // Compute variance per line; gather reasons by lineId.
      const reasonsById = new Map(
        reasonsInput.map((r) => [r.lineId, { reasonCode: r.reasonCode, notes: r.notes ?? null }]),
      );

      let totalValue = 0;
      let maxBps = 0;
      const missingReason: string[] = [];

      for (const line of lines) {
        const sysQty = Number(line.systemQty);
        const cntQty = Number(line.countedQty ?? 0);
        const varQty = cntQty - sysQty;
        const varValue = Math.round(varQty * line.systemAvgCostCents);
        totalValue += varValue;

        // variance % in basis points, against max(system_qty, 1) so a count
        // finding stock where the books have zero still contributes a big
        // variance and doesn't divide-by-zero.
        const denom = Math.max(Math.abs(sysQty), 1);
        const bps = Math.round((Math.abs(varQty) / denom) * 10_000);
        if (bps > maxBps) maxBps = bps;

        const r = reasonsById.get(line.id);
        if (varQty !== 0 && !r?.reasonCode) {
          missingReason.push(line.id);
        }

        await tx
          .update(schema.stockCountLines)
          .set({
            varianceQty: varQty.toString(),
            varianceValueCents: varValue,
            reasonCode: r?.reasonCode ?? null,
            notes: r?.notes ?? null,
          })
          .where(eq(schema.stockCountLines.id, line.id));
      }

      if (missingReason.length > 0) {
        return { error: "MISSING_REASON" as const, lineIds: missingReason };
      }

      const requiresApproval = maxBps > header.varianceThresholdBps;

      await tx
        .update(schema.stockCounts)
        .set({
          status: requiresApproval ? "pending_approval" : "review",
          reviewedAt: new Date(),
          maxVarianceBps: maxBps,
          totalVarianceValueCents: totalValue,
          requiresApproval,
          updatedAt: new Date(),
        })
        .where(eq(schema.stockCounts.id, header.id));

      return {
        ok: true as const,
        status: requiresApproval ? "pending_approval" : "review",
        maxVarianceBps: maxBps,
        totalVarianceValueCents: totalValue,
        requiresApproval,
      };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_DRAFT: 409,
        UNCOUNTED_LINES: 409,
        MISSING_REASON: 409,
      };
      return reply.status(map[result.error] ?? 500).send({
        error: {
          code: result.error,
          ...("count" in result ? { count: result.count } : {}),
          ...("lineIds" in result ? { lineIds: result.lineIds } : {}),
        },
      });
    }
    return reply.send(result);
  });

  // ---------------------------------------------------------------------------
  // POST /:id/approve — SOD-enforced (approver ≠ creator). Only needed when
  // the count is in pending_approval; the approval flips it to review ready
  // for post.
  // ---------------------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>("/:id/approve", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [header] = await tx
        .select()
        .from(schema.stockCounts)
        .where(
          and(
            eq(schema.stockCounts.tenantId, ctx.tenantId),
            eq(schema.stockCounts.id, req.params.id),
            isNull(schema.stockCounts.deletedAt),
          ),
        )
        .limit(1);
      if (!header) return { error: "NOT_FOUND" as const };
      if (header.status !== "pending_approval") return { error: "NOT_PENDING" as const };
      if (header.createdByUserId === ctx.userId) return { error: "SOD_VIOLATION" as const };

      await tx
        .update(schema.stockCounts)
        .set({
          status: "review",
          approvedAt: new Date(),
          approvedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.stockCounts.id, header.id));

      return { ok: true as const };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_PENDING: 409,
        SOD_VIOLATION: 403,
      };
      const msgs: Record<string, string> = {
        SOD_VIOLATION: "Approver must be different from the person who created the count.",
      };
      return reply.status(map[result.error] ?? 500).send({
        error: { code: result.error, message: msgs[result.error] ?? result.error },
      });
    }
    return reply.send(result);
  });

  // ---------------------------------------------------------------------------
  // POST /:id/post — book the adjustment journal + stock_ledger rows +
  // item_balances updates. Allowed only while the count is in 'review' (so
  // an over-threshold count has to be approved first).
  //
  // GL shape (one batch JE):
  //   net positive variance → Dr Inventory (sum gain)   Cr Stock gain (sum gain)
  //   net negative variance → Dr Stock loss (sum loss)  Cr Inventory (sum loss)
  //   mixed → both entries land in one JE so the doc shows the gross move.
  // Per-line stock_ledger rows carry the per-line value at system WAVG
  // (because that's the cost at which the write-off / write-on happens —
  // WAVG stays honest: positive adjustments blend at the current avg cost;
  // negative adjustments remove qty at the current avg cost).
  // ---------------------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>("/:id/post", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [header] = await tx
        .select()
        .from(schema.stockCounts)
        .where(
          and(
            eq(schema.stockCounts.tenantId, ctx.tenantId),
            eq(schema.stockCounts.id, req.params.id),
            isNull(schema.stockCounts.deletedAt),
          ),
        )
        .limit(1);
      if (!header) return { error: "NOT_FOUND" as const };
      if (header.status !== "review") return { error: "NOT_READY" as const };

      const lines = await tx
        .select()
        .from(schema.stockCountLines)
        .where(eq(schema.stockCountLines.stockCountId, header.id))
        .orderBy(asc(schema.stockCountLines.lineNo));

      // Resolve GL accounts.
      const { inventoryAccountId } = await resolveStockGLAccounts(tx, ctx.tenantId);
      if (!inventoryAccountId) {
        return { error: "GL_NOT_CONFIGURED" as const };
      }

      const gainRows = (await tx.execute(sql`
        SELECT id FROM chart_of_accounts
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND account_type = 'income'
           AND account_subtype = 'stock_adjustment'
           AND deleted_at IS NULL
         LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      const lossRows = (await tx.execute(sql`
        SELECT id FROM chart_of_accounts
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND account_type = 'expense'
           AND account_subtype = 'stock_adjustment'
           AND deleted_at IS NULL
         LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      const gainAccountId = gainRows[0]?.id;
      const lossAccountId = lossRows[0]?.id;
      if (!gainAccountId || !lossAccountId) {
        return { error: "GL_NOT_CONFIGURED" as const };
      }

      let gainTotal = 0;  // sum of positive variances (value)
      let lossTotal = 0;  // sum of abs(negative variances) (value)
      let anyVariance = false;

      // Apply per-line stock move + ledger row. Balance row is locked for
      // update inside the loop so concurrent bill / invoice posts queue.
      for (const line of lines) {
        const varQty = Number(line.varianceQty ?? 0);
        if (varQty === 0) continue;
        anyVariance = true;
        const unitCost = line.systemAvgCostCents;
        const varValue = line.varianceValueCents ?? 0;

        // Lock (or create) the balance row for this item/warehouse.
        const [bal] = await tx
          .select()
          .from(schema.itemBalances)
          .where(
            and(
              eq(schema.itemBalances.tenantId, ctx.tenantId),
              eq(schema.itemBalances.itemId, line.itemId),
              eq(schema.itemBalances.warehouseId, header.warehouseId),
            ),
          )
          .for("update")
          .limit(1);

        const currentQty = bal ? Number(bal.quantityOnHand) : 0;
        const currentValue = bal?.totalValueCents ?? 0;
        const currentAvg = bal?.averageCostCents ?? 0;

        if (varQty < 0 && currentQty + varQty < 0) {
          // Counted less than system qty *and* applying the loss would dip
          // below zero (someone else issued stock between snapshot and post).
          return {
            error: "NEGATIVE_STOCK" as const,
            lineId: line.id,
            itemId: line.itemId,
            have: currentQty,
            need: Math.abs(varQty),
          };
        }

        const newQty = currentQty + varQty;
        // Positive adjustment: blend new qty at snapshot avg cost (fair —
        // counted qty was "already on shelf, books didn't know"). Negative
        // adjustment: remove at current avg cost (standard WAVG behaviour).
        const deltaValue = varQty > 0
          ? Math.round(varQty * unitCost)
          : -Math.round(Math.abs(varQty) * currentAvg);
        const newValue = Math.max(0, currentValue + deltaValue);
        const newAvg = newQty > 0 ? Math.round(newValue / newQty) : 0;

        if (bal) {
          await tx
            .update(schema.itemBalances)
            .set({
              quantityOnHand: newQty.toString(),
              averageCostCents: newAvg,
              totalValueCents: newValue,
              lastMovementAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.itemBalances.tenantId, ctx.tenantId),
                eq(schema.itemBalances.itemId, line.itemId),
                eq(schema.itemBalances.warehouseId, header.warehouseId),
              ),
            );
        } else {
          // First movement for this item in this warehouse — insert.
          await tx.insert(schema.itemBalances).values({
            tenantId: ctx.tenantId,
            itemId: line.itemId,
            warehouseId: header.warehouseId,
            quantityOnHand: newQty.toString(),
            averageCostCents: newAvg,
            totalValueCents: newValue,
            lastMovementAt: new Date(),
          });
        }

        await tx.insert(schema.stockLedger).values({
          tenantId: ctx.tenantId,
          itemId: line.itemId,
          warehouseId: header.warehouseId,
          movementType: varQty > 0 ? "adjustment_positive" : "adjustment_negative",
          quantity: varQty.toString(),
          unitCostCents: varQty > 0 ? unitCost : currentAvg,
          totalCostCents: deltaValue,
          runningQuantity: newQty.toString(),
          runningValueCents: newValue,
          runningAvgCostCents: newAvg,
          sourceDocumentType: "stock_count",
          sourceDocumentId: header.id,
          sourceLineId: line.id,
          memo: line.reasonCode ? `Count adj · ${line.reasonCode}` : "Count adjustment",
          postedByUserId: ctx.userId,
        });

        if (varValue > 0) gainTotal += varValue;
        else lossTotal += Math.abs(varValue);
      }

      let journalEntryId: string | null = null;

      if (anyVariance && (gainTotal > 0 || lossTotal > 0)) {
        // Build batch journal.
        const jlLines: Array<{ accountId: string; drCents?: number; crCents?: number; description?: string }> = [];
        if (gainTotal > 0) {
          jlLines.push({ accountId: inventoryAccountId, drCents: gainTotal, description: "Stock count gain" });
          jlLines.push({ accountId: gainAccountId, crCents: gainTotal, description: "Stock count gain" });
        }
        if (lossTotal > 0) {
          jlLines.push({ accountId: lossAccountId, drCents: lossTotal, description: "Stock count loss" });
          jlLines.push({ accountId: inventoryAccountId, crCents: lossTotal, description: "Stock count loss" });
        }

        const je = await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: header.countDate,
          memo: `Stock count ${header.countNumber ?? header.id.slice(0, 8)}`,
          sourceType: "stock_count",
          sourceId: header.id,
          postedByUserId: ctx.userId,
          lines: jlLines,
        });
        journalEntryId = je.entryId;
      }

      // Allocate document number at post time (mirrors other modules where
      // the number is claimed at first post, not at draft creation).
      const seqRows = (await tx.execute(
        sql`SELECT next_document_number('stock_count') AS number`,
      )) as unknown as Array<{ number: string }>;
      const countNumber = seqRows[0]?.number ?? null;

      await tx
        .update(schema.stockCounts)
        .set({
          status: "posted",
          postedAt: new Date(),
          postedByUserId: ctx.userId,
          countNumber,
          journalEntryId,
          updatedAt: new Date(),
        })
        .where(eq(schema.stockCounts.id, header.id));

      return {
        ok: true as const,
        countNumber,
        journalEntryId,
        gainCents: gainTotal,
        lossCents: lossTotal,
        netCents: gainTotal - lossTotal,
      };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_READY: 409,
        GL_NOT_CONFIGURED: 409,
        NEGATIVE_STOCK: 409,
      };
      const msgs: Record<string, string> = {
        NOT_READY: "Count must be reviewed (and approved if required) before posting.",
        GL_NOT_CONFIGURED: "Chart of accounts is missing Inventory / Stock gain / Stock loss.",
        NEGATIVE_STOCK: "One or more lines would drive stock negative — re-count or cancel.",
      };
      return reply.status(map[result.error] ?? 500).send({
        error: { code: result.error, message: msgs[result.error] ?? result.error, ...result },
      });
    }
    return reply.send(result);
  });

  // ---------------------------------------------------------------------------
  // POST /:id/cancel — soft-cancel a draft / review / pending_approval count.
  // Posted counts are immutable.
  // ---------------------------------------------------------------------------
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/:id/cancel",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : null;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [header] = await tx
          .select()
          .from(schema.stockCounts)
          .where(
            and(
              eq(schema.stockCounts.tenantId, ctx.tenantId),
              eq(schema.stockCounts.id, req.params.id),
              isNull(schema.stockCounts.deletedAt),
            ),
          )
          .limit(1);
        if (!header) return { error: "NOT_FOUND" as const };
        if (["posted", "cancelled"].includes(header.status)) {
          return { error: "NOT_CANCELLABLE" as const };
        }

        await tx
          .update(schema.stockCounts)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(schema.stockCounts.id, header.id));

        return { ok: true as const };
      });

      if ("error" in result) {
        const map: Record<string, number> = { NOT_FOUND: 404, NOT_CANCELLABLE: 409 };
        return reply.status(map[result.error] ?? 500).send({ error: { code: result.error } });
      }
      return reply.send(result);
    },
  );
};
