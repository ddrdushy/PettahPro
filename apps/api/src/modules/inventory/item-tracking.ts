import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, gt, isNull, sql, lte } from "drizzle-orm";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

/**
 * Batch / serial / expiry read-side endpoints for roadmap #34.
 *
 * All mutation of batches / serials flows through bill post (inbound)
 * and invoice post (outbound); these routes are purely for reporting
 * and traceability. Mounted under `/items` so the URLs read naturally:
 *
 *   GET /items/:id/batches                 — FIFO ledger for one item
 *   GET /items/:id/serials                 — serial ledger for one item
 *   GET /items/batches/:batchId/recall     — which docs shipped this lot
 *   GET /items/serials/:serialId           — full trace for one unit
 *   GET /items/tracking/expiring?days=30   — expiring-soon report
 */
export const itemTrackingRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /items/:id/batches — all batches (in stock or depleted) for the
  // item, newest first. `?active=true` filters to remaining_qty > 0.
  fastify.get<{
    Params: { id: string };
    Querystring: { active?: string };
  }>("/:id/batches", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const onlyActive = req.query.active === "true";

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const whereClauses = [
        eq(schema.itemBatches.tenantId, ctx.tenantId),
        eq(schema.itemBatches.itemId, req.params.id),
        isNull(schema.itemBatches.deletedAt),
      ];
      if (onlyActive) {
        whereClauses.push(gt(schema.itemBatches.remainingQty, "0"));
      }
      return tx
        .select()
        .from(schema.itemBatches)
        .where(and(...whereClauses))
        .orderBy(
          // FIFO-friendly: oldest expiry first, then earliest received.
          // Nulls last on expiry so batches without an expiry date slot
          // after dated batches of the same age.
          sql`${schema.itemBatches.expiryDate} ASC NULLS LAST`,
          asc(schema.itemBatches.receivedAt),
        )
        .limit(500);
    });

    return reply.send({ batches: rows });
  });

  // GET /items/:id/serials — every serial ever acquired for the item.
  // Client filters by status (in_stock / sold / scrapped) on the UI.
  fastify.get<{ Params: { id: string } }>("/:id/serials", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.itemSerials)
        .where(
          and(
            eq(schema.itemSerials.tenantId, ctx.tenantId),
            eq(schema.itemSerials.itemId, req.params.id),
            isNull(schema.itemSerials.deletedAt),
          ),
        )
        .orderBy(desc(schema.itemSerials.acquiredAt))
        .limit(500),
    );

    return reply.send({ serials: rows });
  });

  // GET /items/batches/:batchId/recall — every outbound allocation that
  // touched this batch, joined to invoice + customer so the recall
  // email list is one query away.
  fastify.get<{ Params: { batchId: string } }>(
    "/batches/:batchId/recall",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const data = await withTenant(ctx.tenantId, async (tx) => {
        const [batch] = await tx
          .select()
          .from(schema.itemBatches)
          .where(
            and(
              eq(schema.itemBatches.tenantId, ctx.tenantId),
              eq(schema.itemBatches.id, req.params.batchId),
              isNull(schema.itemBatches.deletedAt),
            ),
          )
          .limit(1);
        if (!batch) return null;

        // Outbound allocations → stock_ledger → invoice + customer.
        // Restricted to negative quantities (issues) because recalls
        // don't care about internal transfers.
        const allocations = await tx
          .select({
            allocationQty: schema.stockMovementBatchAllocations.quantity,
            allocationUnitCostCents:
              schema.stockMovementBatchAllocations.unitCostCents,
            ledgerId: schema.stockLedger.id,
            ledgerQty: schema.stockLedger.quantity,
            sourceDocumentType: schema.stockLedger.sourceDocumentType,
            sourceDocumentId: schema.stockLedger.sourceDocumentId,
            occurredAt: schema.stockLedger.occurredAt,
          })
          .from(schema.stockMovementBatchAllocations)
          .innerJoin(
            schema.stockLedger,
            eq(schema.stockLedger.id, schema.stockMovementBatchAllocations.stockLedgerId),
          )
          .where(
            and(
              eq(
                schema.stockMovementBatchAllocations.tenantId,
                ctx.tenantId,
              ),
              eq(schema.stockMovementBatchAllocations.batchId, batch.id),
            ),
          )
          .orderBy(desc(schema.stockLedger.occurredAt));

        return { batch, allocations };
      });

      if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      return reply.send(data);
    },
  );

  // GET /items/serials/:serialId — full trace: when acquired, from whom,
  // when sold, to whom, warranty-through.
  fastify.get<{ Params: { serialId: string } }>(
    "/serials/:serialId",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const data = await withTenant(ctx.tenantId, async (tx) => {
        const [serial] = await tx
          .select()
          .from(schema.itemSerials)
          .where(
            and(
              eq(schema.itemSerials.tenantId, ctx.tenantId),
              eq(schema.itemSerials.id, req.params.serialId),
              isNull(schema.itemSerials.deletedAt),
            ),
          )
          .limit(1);
        if (!serial) return null;

        // Hydrate item name + batch number for the detail UI.
        const [item] = await tx
          .select({ id: schema.items.id, name: schema.items.name, sku: schema.items.sku })
          .from(schema.items)
          .where(eq(schema.items.id, serial.itemId))
          .limit(1);

        const batch = serial.batchId
          ? (
              await tx
                .select({
                  id: schema.itemBatches.id,
                  batchNumber: schema.itemBatches.batchNumber,
                  expiryDate: schema.itemBatches.expiryDate,
                })
                .from(schema.itemBatches)
                .where(eq(schema.itemBatches.id, serial.batchId))
                .limit(1)
            )[0]
          : null;

        return { serial, item: item ?? null, batch: batch ?? null };
      });

      if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      return reply.send(data);
    },
  );

  // GET /items/tracking/expiring?days=30 — batches with remaining stock
  // whose expiry is within N days (default 30). Used by dashboards /
  // daily expiry reports. Includes already-expired stock so the ops
  // team can scrap/return it.
  fastify.get<{ Querystring: { days?: string } }>(
    "/tracking/expiring",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const days = Math.max(1, Math.min(365, Number(req.query.days ?? 30) || 30));
      const cutoff = new Date(Date.now() + days * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const rows = await withTenant(ctx.tenantId, async (tx) =>
        tx
          .select({
            batchId: schema.itemBatches.id,
            batchNumber: schema.itemBatches.batchNumber,
            expiryDate: schema.itemBatches.expiryDate,
            mfgDate: schema.itemBatches.mfgDate,
            remainingQty: schema.itemBatches.remainingQty,
            unitCostCents: schema.itemBatches.unitCostCents,
            itemId: schema.items.id,
            itemName: schema.items.name,
            itemSku: schema.items.sku,
            warehouseId: schema.itemBatches.warehouseId,
          })
          .from(schema.itemBatches)
          .innerJoin(
            schema.items,
            eq(schema.items.id, schema.itemBatches.itemId),
          )
          .where(
            and(
              eq(schema.itemBatches.tenantId, ctx.tenantId),
              isNull(schema.itemBatches.deletedAt),
              gt(schema.itemBatches.remainingQty, "0"),
              // Only batches with an expiry date can expire — ones
              // without never surface here.
              sql`${schema.itemBatches.expiryDate} IS NOT NULL`,
              lte(schema.itemBatches.expiryDate, cutoff),
            ),
          )
          .orderBy(asc(schema.itemBatches.expiryDate))
          .limit(500),
      );

      return reply.send({ batches: rows, days, cutoff });
    },
  );
};
