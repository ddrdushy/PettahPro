import { and, eq, isNull, sql, asc, inArray } from "drizzle-orm";
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

// ---------------------------------------------------------------------------
// Batch / serial / expiry tracking (roadmap #34)
// ---------------------------------------------------------------------------
// Shared tracking input threaded through inbound / outbound primitives.
// Callers (bill post, invoice post, DN post) translate their per-line
// payload into this shape. All fields are optional — the primitives
// enforce "required when the item toggle is on" themselves so every
// caller gets the same error.

export interface InboundTrackingInput {
  // Batch / expiry items. Exactly one batch per inbound line in v1.
  batchNumber?: string;
  mfgDate?: string;       // YYYY-MM-DD
  expiryDate?: string;    // YYYY-MM-DD
  batchNotes?: string;
  // Serial items. Length must equal line quantity.
  serialNumbers?: string[];
  // Informational — piped into item_batches.supplier_id and
  // item_serials.supplier_id so recall / warranty queries don't need
  // an extra join back through the source document.
  supplierId?: string;
}

export interface OutboundTrackingInput {
  // Serial items: the specific units being issued. Length must equal
  // quantity. Unknown or already-sold serials fail with
  // SERIAL_NOT_AVAILABLE / SERIAL_MISMATCH.
  serialNumbers?: string[];
  // Batch items: explicit picks are allowed but not required. When
  // empty, the primitive picks batches via FIFO (oldest expiry first,
  // then earliest received). Explicit picks are useful when a user
  // physically grabbed a specific lot (e.g. forward stock location).
  batchPicks?: Array<{ batchId: string; quantity: number }>;
}

/**
 * Records a stock receipt (items coming in from a bill) and updates the
 * running balance under weighted-average valuation. Row-locks the balance
 * for the duration of the transaction to serialize concurrent postings.
 *
 * When the item has batch / serial / expiry tracking on, the caller
 * supplies a `tracking` payload and the primitive creates the
 * corresponding item_batches / item_serials rows plus cross-links them
 * from the stock_ledger row.
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
    tracking?: InboundTrackingInput;
  },
): Promise<{
  quantityOnHand: number;
  averageCostCents: number;
  totalValueCents: number;
  batchId?: string;
  serialIds?: string[];
}> {
  if (input.quantity <= 0) throw new Error("Stock receipt quantity must be positive");

  const [item] = await tx
    .select({
      id: schema.items.id,
      trackBatches: schema.items.trackBatches,
      trackSerials: schema.items.trackSerials,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.items)
    .where(eq(schema.items.id, input.itemId))
    .limit(1);
  if (!item) throw new Error("ITEM_NOT_FOUND");

  // Validate tracking input up front so we don't half-write.
  const needsBatchInput = item.trackBatches || item.trackExpiry;
  const tracking = input.tracking;
  if (needsBatchInput) {
    if (!tracking?.batchNumber || !tracking.batchNumber.trim()) {
      const e = new Error("BATCH_INPUT_REQUIRED") as Error & { code?: string };
      e.code = "BATCH_INPUT_REQUIRED";
      throw e;
    }
    if (item.trackExpiry && !tracking.expiryDate) {
      const e = new Error("EXPIRY_INPUT_REQUIRED") as Error & { code?: string };
      e.code = "EXPIRY_INPUT_REQUIRED";
      throw e;
    }
  }
  if (item.trackSerials) {
    const serials = tracking?.serialNumbers ?? [];
    if (serials.length !== input.quantity) {
      const e = new Error("SERIAL_COUNT_MISMATCH") as Error & {
        code?: string;
        expected?: number;
        actual?: number;
      };
      e.code = "SERIAL_COUNT_MISMATCH";
      e.expected = input.quantity;
      e.actual = serials.length;
      throw e;
    }
    const trimmed = serials.map((s) => s.trim()).filter(Boolean);
    if (trimmed.length !== serials.length) {
      const e = new Error("SERIAL_BLANK") as Error & { code?: string };
      e.code = "SERIAL_BLANK";
      throw e;
    }
    const uniq = new Set(trimmed);
    if (uniq.size !== trimmed.length) {
      const e = new Error("SERIAL_DUPLICATE_IN_PAYLOAD") as Error & {
        code?: string;
      };
      e.code = "SERIAL_DUPLICATE_IN_PAYLOAD";
      throw e;
    }
  }

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

  // Create batch + serial rows before writing the ledger row so the
  // ledger can point at them (single-batch / single-serial quick
  // pointers live on stock_ledger for convenience).
  let batchId: string | undefined;
  if (needsBatchInput && tracking?.batchNumber) {
    const [batch] = await tx
      .insert(schema.itemBatches)
      .values({
        tenantId: input.tenantId,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        batchNumber: tracking.batchNumber.trim(),
        mfgDate: tracking.mfgDate ?? null,
        expiryDate: tracking.expiryDate ?? null,
        originalQty: input.quantity.toString(),
        remainingQty: input.quantity.toString(),
        unitCostCents: input.unitCostCents,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceLineId: input.sourceLineId,
        supplierId: tracking.supplierId ?? null,
        notes: tracking.batchNotes?.trim() || null,
      })
      .returning({ id: schema.itemBatches.id });
    batchId = batch?.id;
  }

  let serialIds: string[] | undefined;
  if (item.trackSerials && tracking?.serialNumbers) {
    try {
      const inserted = await tx
        .insert(schema.itemSerials)
        .values(
          tracking.serialNumbers.map((sn) => ({
            tenantId: input.tenantId,
            itemId: input.itemId,
            warehouseId: input.warehouseId,
            serialNumber: sn.trim(),
            status: "in_stock" as const,
            batchId: batchId ?? null,
            unitCostCents: input.unitCostCents,
            acquiredDocumentType: input.sourceDocumentType,
            acquiredDocumentId: input.sourceDocumentId,
            acquiredLineId: input.sourceLineId,
            supplierId: tracking.supplierId ?? null,
          })),
        )
        .returning({ id: schema.itemSerials.id });
      serialIds = inserted.map((r) => r.id);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("item_serials_unique_number")) {
        const e = new Error("SERIAL_ALREADY_EXISTS") as Error & {
          code?: string;
        };
        e.code = "SERIAL_ALREADY_EXISTS";
        throw e;
      }
      throw err;
    }
  }

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
    batchId: batchId ?? null,
    // Inbound serials get one ledger row each in practice only when
    // needed for trace — v1 rolls inbound into a single ledger row
    // even for serial-tracked items (the serial rows are the audit
    // trail). Keep serialId null.
    serialId: null,
    memo: input.memo ?? null,
    postedByUserId: input.postedByUserId ?? null,
  });

  return {
    quantityOnHand: newQty,
    averageCostCents: newAvg,
    totalValueCents: newValue,
    batchId,
    serialIds,
  };
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
 *
 * Batch / serial aware: when the item has `track_batches` or
 * `track_expiry` on, FIFO consumption draws from item_batches and
 * writes stock_movement_batch_allocations rows. When the item has
 * `track_serials` on, the caller must pass
 * `tracking.serialNumbers` of length = quantity; each serial flips
 * in_stock → sold.
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
    customerId?: string;
    tracking?: OutboundTrackingInput;
  },
): Promise<{
  cogsCents: number;                  // value of stock relieved (for GL posting)
  runningQuantity: number;
  averageCostCents: number;
  totalValueCents: number;
  batchAllocations?: Array<{ batchId: string; quantity: number; unitCostCents: number }>;
  serialIds?: string[];
}> {
  if (input.quantity <= 0) throw new Error("Stock issue quantity must be positive");

  const [item] = await tx
    .select({
      id: schema.items.id,
      warrantyMonths: schema.items.warrantyMonths,
      trackBatches: schema.items.trackBatches,
      trackSerials: schema.items.trackSerials,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.items)
    .where(eq(schema.items.id, input.itemId))
    .limit(1);
  if (!item) throw new Error("ITEM_NOT_FOUND");

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

  // Validate / resolve batch allocations + serial selection BEFORE
  // writing anything so we never leave partial state.
  const tracking = input.tracking;
  const batchTracked = item.trackBatches || item.trackExpiry;
  let batchAllocations: Array<{
    batchId: string;
    quantity: number;
    unitCostCents: number;
  }> = [];

  if (batchTracked) {
    const picks = tracking?.batchPicks;
    if (picks && picks.length > 0) {
      // Explicit picks — validate sum + that each batch has the qty.
      const sum = picks.reduce((s, p) => s + p.quantity, 0);
      if (Math.abs(sum - input.quantity) > 1e-9) {
        const e = new Error("BATCH_PICKS_SUM_MISMATCH") as Error & {
          code?: string;
          expected?: number;
          actual?: number;
        };
        e.code = "BATCH_PICKS_SUM_MISMATCH";
        e.expected = input.quantity;
        e.actual = sum;
        throw e;
      }
      const batchIds = picks.map((p) => p.batchId);
      const batchRows = await tx
        .select()
        .from(schema.itemBatches)
        .where(
          and(
            eq(schema.itemBatches.tenantId, input.tenantId),
            eq(schema.itemBatches.itemId, input.itemId),
            eq(schema.itemBatches.warehouseId, input.warehouseId),
            inArray(schema.itemBatches.id, batchIds),
            isNull(schema.itemBatches.deletedAt),
          ),
        )
        .for("update");
      const batchById = new Map(batchRows.map((b) => [b.id, b]));
      for (const p of picks) {
        const b = batchById.get(p.batchId);
        if (!b) {
          const e = new Error("BATCH_NOT_FOUND") as Error & {
            code?: string;
            batchId?: string;
          };
          e.code = "BATCH_NOT_FOUND";
          e.batchId = p.batchId;
          throw e;
        }
        if (Number(b.remainingQty) < p.quantity) {
          const e = new Error("BATCH_INSUFFICIENT") as Error & {
            code?: string;
            batchId?: string;
          };
          e.code = "BATCH_INSUFFICIENT";
          e.batchId = p.batchId;
          throw e;
        }
        batchAllocations.push({
          batchId: p.batchId,
          quantity: p.quantity,
          unitCostCents: b.unitCostCents,
        });
      }
    } else {
      // FIFO auto-pick: oldest expiry first (null expiry last), then
      // earliest received_at. Row-lock for the duration of the tx so
      // concurrent issues serialize.
      const fifoRows = await tx
        .select()
        .from(schema.itemBatches)
        .where(
          and(
            eq(schema.itemBatches.tenantId, input.tenantId),
            eq(schema.itemBatches.itemId, input.itemId),
            eq(schema.itemBatches.warehouseId, input.warehouseId),
            isNull(schema.itemBatches.deletedAt),
            sql`${schema.itemBatches.remainingQty} > 0`,
          ),
        )
        .orderBy(
          sql`${schema.itemBatches.expiryDate} ASC NULLS LAST`,
          asc(schema.itemBatches.receivedAt),
        )
        .for("update");

      let remaining = input.quantity;
      for (const b of fifoRows) {
        if (remaining <= 0) break;
        const avail = Number(b.remainingQty);
        const take = Math.min(avail, remaining);
        if (take <= 0) continue;
        batchAllocations.push({
          batchId: b.id,
          quantity: take,
          unitCostCents: b.unitCostCents,
        });
        remaining -= take;
      }
      if (remaining > 1e-9) {
        // Balance said we had enough, but batches don't sum — means
        // untracked stock crept in somehow (legacy data). Surface as
        // NEGATIVE_STOCK so the caller can replenish via a bill that
        // creates a batch row.
        const e = new Error("NEGATIVE_STOCK") as Error & { code?: string };
        e.code = "NEGATIVE_STOCK";
        throw e;
      }
    }
  }

  // Serial selection validation.
  let resolvedSerials: Array<{
    id: string;
    unitCostCents: number;
    warrantyExpiresAt: string | null;
  }> = [];
  if (item.trackSerials) {
    const serialNumbers = tracking?.serialNumbers ?? [];
    if (serialNumbers.length !== input.quantity) {
      const e = new Error("SERIAL_COUNT_MISMATCH") as Error & {
        code?: string;
        expected?: number;
        actual?: number;
      };
      e.code = "SERIAL_COUNT_MISMATCH";
      e.expected = input.quantity;
      e.actual = serialNumbers.length;
      throw e;
    }
    const uniq = new Set(serialNumbers.map((s) => s.trim()));
    if (uniq.size !== serialNumbers.length) {
      const e = new Error("SERIAL_DUPLICATE_IN_PAYLOAD") as Error & {
        code?: string;
      };
      e.code = "SERIAL_DUPLICATE_IN_PAYLOAD";
      throw e;
    }
    const rows = await tx
      .select()
      .from(schema.itemSerials)
      .where(
        and(
          eq(schema.itemSerials.tenantId, input.tenantId),
          eq(schema.itemSerials.itemId, input.itemId),
          eq(schema.itemSerials.warehouseId, input.warehouseId),
          inArray(schema.itemSerials.serialNumber, Array.from(uniq)),
          isNull(schema.itemSerials.deletedAt),
        ),
      )
      .for("update");
    const bySerial = new Map(rows.map((r) => [r.serialNumber, r]));
    const warrantyMonths = item.warrantyMonths;
    const nowMs = Date.now();
    for (const sn of serialNumbers) {
      const trimmed = sn.trim();
      const r = bySerial.get(trimmed);
      if (!r) {
        const e = new Error("SERIAL_NOT_FOUND") as Error & {
          code?: string;
          serial?: string;
        };
        e.code = "SERIAL_NOT_FOUND";
        e.serial = trimmed;
        throw e;
      }
      if (r.status !== "in_stock") {
        const e = new Error("SERIAL_NOT_AVAILABLE") as Error & {
          code?: string;
          serial?: string;
          status?: string;
        };
        e.code = "SERIAL_NOT_AVAILABLE";
        e.serial = trimmed;
        e.status = r.status;
        throw e;
      }
      const warrantyExpiresAt = warrantyMonths
        ? new Date(nowMs + warrantyMonths * 30 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10)
        : null;
      resolvedSerials.push({
        id: r.id,
        unitCostCents: r.unitCostCents,
        warrantyExpiresAt,
      });
    }
  }

  // Compute COGS. For batch-tracked items, use the batch-weighted cost;
  // for WAVG-only items, use the running average.
  const cogsCents = batchTracked
    ? batchAllocations.reduce(
        (s, a) => s + Math.round(a.quantity * a.unitCostCents),
        0,
      )
    : Math.round(input.quantity * currentAvg);
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

  // Decrement each batch's remaining_qty.
  for (const a of batchAllocations) {
    await tx
      .update(schema.itemBatches)
      .set({
        remainingQty: sql`${schema.itemBatches.remainingQty} - ${a.quantity.toString()}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.itemBatches.id, a.batchId));
  }

  // Single-batch / single-serial quick pointer on the ledger row.
  const singleBatchId =
    batchAllocations.length === 1 ? batchAllocations[0]!.batchId : null;
  const singleSerialId =
    resolvedSerials.length === 1 ? resolvedSerials[0]!.id : null;

  const [ledgerRow] = await tx
    .insert(schema.stockLedger)
    .values({
      tenantId: input.tenantId,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      movementType: "sales_invoice",
      quantity: (-input.quantity).toString(),
      unitCostCents: batchTracked
        ? Math.round(cogsCents / input.quantity)
        : currentAvg,
      totalCostCents: -cogsCents,
      runningQuantity: newQty.toString(),
      runningValueCents: newValue,
      runningAvgCostCents: newAvg,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      sourceLineId: input.sourceLineId,
      journalEntryId: input.journalEntryId ?? null,
      batchId: singleBatchId,
      serialId: singleSerialId,
      memo: input.memo ?? null,
      postedByUserId: input.postedByUserId ?? null,
    })
    .returning({ id: schema.stockLedger.id });

  if (batchAllocations.length > 0 && ledgerRow) {
    await tx.insert(schema.stockMovementBatchAllocations).values(
      batchAllocations.map((a) => ({
        tenantId: input.tenantId,
        stockLedgerId: ledgerRow.id,
        batchId: a.batchId,
        quantity: a.quantity.toString(),
        unitCostCents: a.unitCostCents,
      })),
    );
  }

  // Flip serial state + stamp sale provenance.
  if (resolvedSerials.length > 0) {
    const now = new Date();
    for (const s of resolvedSerials) {
      await tx
        .update(schema.itemSerials)
        .set({
          status: "sold",
          soldDocumentType: input.sourceDocumentType,
          soldDocumentId: input.sourceDocumentId,
          soldLineId: input.sourceLineId,
          soldCustomerId: input.customerId ?? null,
          soldAt: now,
          warrantyExpiresAt: s.warrantyExpiresAt,
          updatedAt: now,
        })
        .where(eq(schema.itemSerials.id, s.id));
    }
  }

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
    batchAllocations: batchAllocations.length > 0 ? batchAllocations : undefined,
    serialIds: resolvedSerials.length > 0
      ? resolvedSerials.map((s) => s.id)
      : undefined,
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
