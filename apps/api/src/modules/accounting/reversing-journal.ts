import { and, eq, asc, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { schema } from "@pettahpro/db";
import { postJournal } from "./journal-posting.js";

/**
 * Posts a mirror of `sourceEntryId` with every dr/cr flipped, then links
 * the original to it via is_reversed + reversed_by_entry_id. The new
 * entry is its own auditable JV-YYYY-NNNN number.
 *
 * Caller must have SET LOCAL app.tenant_id and must wrap this in a
 * transaction alongside whatever other updates they're making
 * (invoice status → void, bill status → void, etc.).
 */
export async function postReversingJournal(
  tx: PostgresJsDatabase<typeof schema>,
  input: {
    tenantId: string;
    sourceEntryId: string;
    reversalDate: string;
    memo: string;
    sourceType?: string;
    sourceId?: string;
    postedByUserId?: string;
  },
): Promise<{ entryId: string; entryNumber: string }> {
  // Fetch source entry
  const srcRows = await tx
    .select()
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, input.tenantId),
        eq(schema.journalEntries.id, input.sourceEntryId),
      ),
    )
    .limit(1);
  const src = srcRows[0];
  if (!src) throw new Error("SOURCE_NOT_FOUND");
  if (src.isReversed) throw new Error("ALREADY_REVERSED");

  const srcLines = await tx
    .select()
    .from(schema.journalLines)
    .where(eq(schema.journalLines.journalEntryId, src.id))
    .orderBy(asc(schema.journalLines.lineNo));

  if (srcLines.length === 0) throw new Error("SOURCE_EMPTY");

  const reversedLines = srcLines.map((l) => ({
    accountId: l.accountId,
    drCents: l.crCents,
    crCents: l.drCents,
    description: `Reversal · ${l.description ?? ""}`.trim(),
    customerId: l.customerId ?? undefined,
    supplierId: l.supplierId ?? undefined,
    itemId: l.itemId ?? undefined,
  }));

  const { entryId, entryNumber } = await postJournal(tx, {
    tenantId: input.tenantId,
    entryDate: input.reversalDate,
    memo: input.memo,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    postedByUserId: input.postedByUserId,
    lines: reversedLines,
  });

  await tx
    .update(schema.journalEntries)
    .set({ isReversed: true, reversedByEntryId: entryId })
    .where(eq(schema.journalEntries.id, src.id));

  return { entryId, entryNumber };
}

/**
 * Rewinds every stock_ledger movement that came from a given source
 * document (typically an invoice or bill). Called as part of the void
 * flow so on-hand qty returns to pre-posting levels. Each rewind is
 * itself an immutable ledger row with a direction-flipped quantity.
 *
 * WAVG rule on rewind:
 *   - Rewinding an issue (invoice): stock comes back at the SAME cost
 *     that was relieved, so we restore the value lost from the balance.
 *   - Rewinding a receipt (bill): stock leaves at its ORIGINAL unit
 *     cost, reducing balance value by exactly what came in. WAVG is
 *     preserved for any units received on other bills.
 */
export async function rewindStockForSource(
  tx: PostgresJsDatabase<typeof schema>,
  input: {
    tenantId: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    journalEntryId?: string;
    postedByUserId?: string;
    memo: string;
  },
): Promise<void> {
  const movements = await tx
    .select()
    .from(schema.stockLedger)
    .where(
      and(
        eq(schema.stockLedger.tenantId, input.tenantId),
        eq(schema.stockLedger.sourceDocumentType, input.sourceDocumentType),
        eq(schema.stockLedger.sourceDocumentId, input.sourceDocumentId),
      ),
    )
    .orderBy(asc(schema.stockLedger.occurredAt));

  for (const m of movements) {
    const originalQty = Number(m.quantity);      // signed: + for in, − for out
    const rewindQty = -originalQty;              // opposite sign
    const originalValue = m.totalCostCents;      // signed too
    const rewindValue = -originalValue;

    // Load & lock the balance row
    const balRows = await tx
      .select()
      .from(schema.itemBalances)
      .where(
        and(
          eq(schema.itemBalances.tenantId, input.tenantId),
          eq(schema.itemBalances.itemId, m.itemId),
          eq(schema.itemBalances.warehouseId, m.warehouseId),
        ),
      )
      .for("update")
      .limit(1);
    const bal = balRows[0];
    if (!bal) continue;

    const currentQty = Number(bal.quantityOnHand);
    const currentValue = bal.totalValueCents;

    // Apply rewind
    const newQty = currentQty + rewindQty;
    const newValue = Math.max(0, currentValue + rewindValue);
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
      .where(eq(schema.itemBalances.id, bal.id));

    // Map original movement type → reversal type for audit
    const reversalType =
      m.movementType === "sales_invoice"
        ? "sales_return"
        : m.movementType === "purchase_bill"
          ? "purchase_return"
          : m.movementType.startsWith("adjustment_")
            ? m.movementType === "adjustment_positive"
              ? "adjustment_negative"
              : "adjustment_positive"
            : m.movementType;

    await tx.insert(schema.stockLedger).values({
      tenantId: input.tenantId,
      itemId: m.itemId,
      warehouseId: m.warehouseId,
      movementType: reversalType,
      quantity: rewindQty.toString(),
      unitCostCents: m.unitCostCents,
      totalCostCents: rewindValue,
      runningQuantity: newQty.toString(),
      runningValueCents: newValue,
      runningAvgCostCents: newAvg,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      sourceLineId: m.sourceLineId,
      journalEntryId: input.journalEntryId ?? null,
      memo: input.memo,
      postedByUserId: input.postedByUserId ?? null,
    });
  }
}
