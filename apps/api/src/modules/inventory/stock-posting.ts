import { and, eq, isNull, sql, asc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { schema } from "@pettahpro/db";
import { emitNotification } from "../notifications/emit.js";

/**
 * Call inside a DB transaction with app.tenant_id already SET.
 * Returns the default warehouse for the tenant (the one flagged is_default,
 * falling back to the first non-deleted warehouse by code).
 */
export async function resolveDefaultWarehouse(
  tx: PostgresJsDatabase<typeof schema>,
  tenantId: string,
): Promise<{ id: string } | null> {
  const defRows = await tx
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.tenantId, tenantId),
        eq(schema.warehouses.isDefault, true),
        isNull(schema.warehouses.deletedAt),
      ),
    )
    .limit(1);
  if (defRows[0]) return defRows[0];

  const anyRows = await tx
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.tenantId, tenantId),
        isNull(schema.warehouses.deletedAt),
      ),
    )
    .orderBy(asc(schema.warehouses.code))
    .limit(1);
  return anyRows[0] ?? null;
}

/**
 * Records a stock receipt (items coming in from a bill) and updates the
 * running balance under weighted-average valuation. Row-locks the balance
 * for the duration of the transaction to serialize concurrent postings.
 *
 * Returns the new running state for the balance.
 */
export async function applyStockReceipt(
  tx: PostgresJsDatabase<typeof schema>,
  input: {
    tenantId: string;
    itemId: string;
    warehouseId: string;
    quantity: number;         // positive
    unitCostCents: number;    // per-unit buy cost
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceLineId: string;
    journalEntryId?: string;
    postedByUserId?: string;
    memo?: string;
  },
): Promise<{
  quantityOnHand: number;
  averageCostCents: number;
  totalValueCents: number;
}> {
  if (input.quantity <= 0) throw new Error("Stock receipt quantity must be positive");

  // Get-or-create balance row, row-locked
  const existing = await tx
    .select()
    .from(schema.itemBalances)
    .where(
      and(
        eq(schema.itemBalances.tenantId, input.tenantId),
        eq(schema.itemBalances.itemId, input.itemId),
        eq(schema.itemBalances.warehouseId, input.warehouseId),
      ),
    )
    .for("update")
    .limit(1);

  let currentQty = 0;
  let currentValue = 0;

  if (existing.length === 0) {
    await tx.insert(schema.itemBalances).values({
      tenantId: input.tenantId,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
    });
  } else {
    currentQty = Number(existing[0]!.quantityOnHand);
    currentValue = existing[0]!.totalValueCents;
  }

  const incomingValue = Math.round(input.quantity * input.unitCostCents);
  const newQty = currentQty + input.quantity;
  const newValue = currentValue + incomingValue;
  const newAvg = newQty > 0 ? Math.round(newValue / newQty) : 0;

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
        eq(schema.itemBalances.tenantId, input.tenantId),
        eq(schema.itemBalances.itemId, input.itemId),
        eq(schema.itemBalances.warehouseId, input.warehouseId),
      ),
    );

  await tx.insert(schema.stockLedger).values({
    tenantId: input.tenantId,
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    movementType: "purchase_bill",
    quantity: input.quantity.toString(),
    unitCostCents: input.unitCostCents,
    totalCostCents: incomingValue,
    runningQuantity: newQty.toString(),
    runningValueCents: newValue,
    runningAvgCostCents: newAvg,
    sourceDocumentType: input.sourceDocumentType,
    sourceDocumentId: input.sourceDocumentId,
    sourceLineId: input.sourceLineId,
    journalEntryId: input.journalEntryId ?? null,
    memo: input.memo ?? null,
    postedByUserId: input.postedByUserId ?? null,
  });

  return { quantityOnHand: newQty, averageCostCents: newAvg, totalValueCents: newValue };
}

/**
 * Peeks the current weighted-average cost for an item/warehouse and locks
 * the balance row for the rest of the transaction. Use when the caller
 * needs to compute COGS up front (to build a journal entry) and then
 * commit the stock movement afterwards with the resulting journal id.
 */
export async function peekStockIssue(
  tx: PostgresJsDatabase<typeof schema>,
  input: {
    tenantId: string;
    itemId: string;
    warehouseId: string;
    quantity: number;
  },
): Promise<{ cogsCents: number; availableQty: number; averageCostCents: number }> {
  if (input.quantity <= 0) throw new Error("Stock issue quantity must be positive");

  const rows = await tx
    .select()
    .from(schema.itemBalances)
    .where(
      and(
        eq(schema.itemBalances.tenantId, input.tenantId),
        eq(schema.itemBalances.itemId, input.itemId),
        eq(schema.itemBalances.warehouseId, input.warehouseId),
      ),
    )
    .for("update")
    .limit(1);

  const availableQty = rows[0] ? Number(rows[0].quantityOnHand) : 0;
  const averageCostCents = rows[0]?.averageCostCents ?? 0;
  if (availableQty < input.quantity) {
    const e = new Error("NEGATIVE_STOCK") as Error & { code?: string };
    e.code = "NEGATIVE_STOCK";
    throw e;
  }
  return {
    cogsCents: Math.round(input.quantity * averageCostCents),
    availableQty,
    averageCostCents,
  };
}

/**
 * Records a stock issue (items going out via an invoice) using the current
 * weighted-average cost. Refuses to take the balance below zero — the
 * caller surfaces this as a NEGATIVE_STOCK error per the spec.
 */
export async function applyStockIssue(
  tx: PostgresJsDatabase<typeof schema>,
  input: {
    tenantId: string;
    itemId: string;
    warehouseId: string;
    quantity: number;         // positive number of units to issue
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceLineId: string;
    journalEntryId?: string;
    postedByUserId?: string;
    memo?: string;
  },
): Promise<{
  cogsCents: number;                  // value of stock relieved (for GL posting)
  runningQuantity: number;
  averageCostCents: number;
  totalValueCents: number;
}> {
  if (input.quantity <= 0) throw new Error("Stock issue quantity must be positive");

  const rows = await tx
    .select()
    .from(schema.itemBalances)
    .where(
      and(
        eq(schema.itemBalances.tenantId, input.tenantId),
        eq(schema.itemBalances.itemId, input.itemId),
        eq(schema.itemBalances.warehouseId, input.warehouseId),
      ),
    )
    .for("update")
    .limit(1);

  const currentQty = rows[0] ? Number(rows[0].quantityOnHand) : 0;
  if (currentQty < input.quantity) {
    const e = new Error("NEGATIVE_STOCK") as Error & { code?: string };
    e.code = "NEGATIVE_STOCK";
    throw e;
  }

  const currentAvg = rows[0]?.averageCostCents ?? 0;
  const currentValue = rows[0]?.totalValueCents ?? 0;

  const cogsCents = Math.round(input.quantity * currentAvg);
  const newQty = currentQty - input.quantity;
  const newValue = Math.max(0, currentValue - cogsCents);
  // WAVG unchanged on issue (pure average-cost model)
  const newAvg = newQty > 0 ? Math.round(newValue / newQty) : 0;

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
        eq(schema.itemBalances.tenantId, input.tenantId),
        eq(schema.itemBalances.itemId, input.itemId),
        eq(schema.itemBalances.warehouseId, input.warehouseId),
      ),
    );

  await tx.insert(schema.stockLedger).values({
    tenantId: input.tenantId,
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    movementType: "sales_invoice",
    quantity: (-input.quantity).toString(),
    unitCostCents: currentAvg,
    totalCostCents: -cogsCents,
    runningQuantity: newQty.toString(),
    runningValueCents: newValue,
    runningAvgCostCents: newAvg,
    sourceDocumentType: input.sourceDocumentType,
    sourceDocumentId: input.sourceDocumentId,
    sourceLineId: input.sourceLineId,
    journalEntryId: input.journalEntryId ?? null,
    memo: input.memo ?? null,
    postedByUserId: input.postedByUserId ?? null,
  });

  // Reorder-point alert: fire a notification only when this issue *crossed*
  // below the item's reorder_point. Natural dedupe — once below, subsequent
  // issues don't alert until stock climbs back above and dips again.
  const [itemRow] = await tx
    .select({ name: schema.items.name, reorderPoint: schema.items.reorderPoint })
    .from(schema.items)
    .where(eq(schema.items.id, input.itemId))
    .limit(1);
  if (itemRow && itemRow.reorderPoint != null && itemRow.reorderPoint > 0) {
    const rp = itemRow.reorderPoint;
    if (currentQty > rp && newQty <= rp) {
      await emitNotification(tx, {
        tenantId: input.tenantId,
        kind: "low_stock",
        title: `Low stock: ${itemRow.name}`,
        body: `On hand ${newQty} ≤ reorder point ${rp}. Time to reorder.`,
        refType: "item",
        refId: input.itemId,
      });
    }
  }

  return {
    cogsCents,
    runningQuantity: newQty,
    averageCostCents: newAvg,
    totalValueCents: newValue,
  };
}

/**
 * Resolves the standard COGS + Inventory GL accounts for a tenant.
 * Picks the accounts by subtype (cogs / inventory) seeded on signup.
 */
export async function resolveStockGLAccounts(
  tx: PostgresJsDatabase<typeof schema>,
  tenantId: string,
): Promise<{ inventoryAccountId: string | null; cogsAccountId: string | null }> {
  const rows = await tx
    .select()
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        isNull(schema.chartOfAccounts.deletedAt),
      ),
    );
  const byKey = new Map(rows.map((r) => [`${r.accountType}:${r.accountSubtype}`, r.id]));
  return {
    inventoryAccountId: byKey.get("asset:inventory") ?? null,
    cogsAccountId: byKey.get("expense:cogs") ?? null,
  };
}
