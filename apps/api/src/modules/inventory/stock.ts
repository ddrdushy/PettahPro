import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

export const stockRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /stock — current on-hand + WAVG value per tracked item
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const balances = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          itemId: schema.items.id,
          itemName: schema.items.name,
          sku: schema.items.sku,
          unit: schema.items.unit,
          trackInventory: schema.items.trackInventory,
          reorderPoint: schema.items.reorderPoint,
          warehouseId: schema.warehouses.id,
          warehouseCode: schema.warehouses.code,
          warehouseName: schema.warehouses.name,
          quantityOnHand: schema.itemBalances.quantityOnHand,
          averageCostCents: schema.itemBalances.averageCostCents,
          totalValueCents: schema.itemBalances.totalValueCents,
          lastMovementAt: schema.itemBalances.lastMovementAt,
        })
        .from(schema.itemBalances)
        .innerJoin(schema.items, eq(schema.items.id, schema.itemBalances.itemId))
        .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.itemBalances.warehouseId))
        .where(
          and(
            eq(schema.itemBalances.tenantId, ctx.tenantId),
            isNull(schema.items.deletedAt),
          ),
        )
        .orderBy(asc(schema.items.name)),
    );

    const totalValueCents = balances.reduce((s, b) => s + b.totalValueCents, 0);

    return reply.send({ balances, totalValueCents });
  });

  // GET /stock/ledger?itemId=… — movement history for an item
  fastify.get<{ Querystring: { itemId?: string } }>("/ledger", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const itemId = req.query.itemId;
    if (!itemId) {
      return reply.status(400).send({ error: { code: "ITEM_ID_REQUIRED" } });
    }

    const movements = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.stockLedger.id,
          movementType: schema.stockLedger.movementType,
          quantity: schema.stockLedger.quantity,
          unitCostCents: schema.stockLedger.unitCostCents,
          totalCostCents: schema.stockLedger.totalCostCents,
          runningQuantity: schema.stockLedger.runningQuantity,
          runningValueCents: schema.stockLedger.runningValueCents,
          runningAvgCostCents: schema.stockLedger.runningAvgCostCents,
          sourceDocumentType: schema.stockLedger.sourceDocumentType,
          sourceDocumentId: schema.stockLedger.sourceDocumentId,
          occurredAt: schema.stockLedger.occurredAt,
          warehouseCode: schema.warehouses.code,
          warehouseName: schema.warehouses.name,
        })
        .from(schema.stockLedger)
        .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.stockLedger.warehouseId))
        .where(
          and(
            eq(schema.stockLedger.tenantId, ctx.tenantId),
            eq(schema.stockLedger.itemId, itemId),
          ),
        )
        .orderBy(desc(schema.stockLedger.occurredAt))
        .limit(200),
    );

    return reply.send({ movements });
  });

  // GET /stock/warehouses — simple list for transfer / transfer-receive forms.
  fastify.get("/warehouses", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const warehouses = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.warehouses.id,
          code: schema.warehouses.code,
          name: schema.warehouses.name,
          isDefault: schema.warehouses.isDefault,
          isActive: schema.warehouses.isActive,
        })
        .from(schema.warehouses)
        .where(
          and(
            eq(schema.warehouses.tenantId, ctx.tenantId),
            isNull(schema.warehouses.deletedAt),
          ),
        )
        .orderBy(asc(schema.warehouses.code)),
    );
    return reply.send({ warehouses });
  });

  // GET /stock/low-stock — items with reorder_point set whose total on-hand
  // (summed across warehouses) is at or below the reorder_point. Items that
  // have no balance row yet (never received) still show up with on_hand=0
  // so we can flag brand-new items that were set up but not yet stocked.
  fastify.get("/low-stock", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx.execute(sql`
        SELECT i.id            AS item_id,
               i.sku,
               i.name,
               i.unit,
               i.reorder_point,
               COALESCE(SUM(b.quantity_on_hand)::numeric, 0)::numeric AS on_hand,
               COALESCE(MAX(b.last_movement_at), NULL) AS last_movement_at
          FROM items i
          LEFT JOIN item_balances b
            ON b.item_id = i.id
           AND b.tenant_id = i.tenant_id
         WHERE i.tenant_id = current_tenant_id()
           AND i.deleted_at IS NULL
           AND i.track_inventory = true
           AND i.is_active = true
           AND i.reorder_point IS NOT NULL
           AND i.reorder_point > 0
         GROUP BY i.id, i.sku, i.name, i.unit, i.reorder_point
        HAVING COALESCE(SUM(b.quantity_on_hand), 0) <= i.reorder_point
         ORDER BY (COALESCE(SUM(b.quantity_on_hand), 0)::numeric - i.reorder_point) ASC
      `),
    ) as unknown as Array<{
      item_id: string;
      sku: string | null;
      name: string;
      unit: string;
      reorder_point: number;
      on_hand: string | number;
      last_movement_at: string | null;
    }>;

    const items = rows.map((r) => ({
      itemId: r.item_id,
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      reorderPoint: r.reorder_point,
      onHand: Number(r.on_hand),
      shortBy: r.reorder_point - Number(r.on_hand),
      lastMovementAt: r.last_movement_at,
    }));
    return reply.send({ items, count: items.length });
  });
};
