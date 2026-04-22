import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, sql, asc } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, nextDocumentNumber } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "../accounting/journal-posting.js";
import { emitNotification } from "../notifications/emit.js";
import {
  postReversingJournal,
  rewindStockForSource,
} from "../accounting/reversing-journal.js";
import {
  applyStockReceipt,
  resolveDefaultWarehouse,
  resolveStockGLAccounts,
} from "../inventory/stock-posting.js";

const LineSchema = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unitPriceCents: z.number().int().min(0),
  discountPctBps: z.number().int().min(0).max(10000).default(0),
  taxCodeId: z.string().uuid().optional(),
  expenseAccountId: z.string().uuid().optional(),
});

const CHARGE_KINDS = [
  "freight",
  "insurance",
  "customs",
  "clearing",
  "loading",
  "other",
] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

const ChargeSchema = z.object({
  kind: z.enum(CHARGE_KINDS),
  description: z.string().max(500).optional().or(z.literal("")),
  amountCents: z.number().int().min(0),
});

const ALLOCATION_METHODS = ["value", "quantity"] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

const CreateSchema = z.object({
  supplierId: z.string().uuid(),
  supplierBillNumber: z.string().max(64).optional().or(z.literal("")),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Multi-currency — same semantics as invoices. amount_cents is LKR;
  // currency + fxRate are display-only in v1.
  currency: z.string().length(3).optional(),
  fxRate: z.number().positive().optional(),
  notes: z.string().optional().or(z.literal("")),
  lines: z.array(LineSchema).min(1),
  charges: z.array(ChargeSchema).optional().default([]),
  chargeAllocationMethod: z.enum(ALLOCATION_METHODS).optional().default("value"),
});

interface LineInput {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
  expenseAccountId?: string;
}

interface ChargeInput {
  kind: ChargeKind;
  description?: string;
  amountCents: number;
}

/**
 * Allocate charge totals across bill inventory lines. Returns a per-line
 * cents delta that should be added to the line's inventory cost before
 * stock receipts post, plus an "unallocated" remainder when the bill has
 * no inventory lines (it must be expensed to the freight account instead).
 *
 * Allocation methods:
 *   · 'value' (default): weight by each line's post-discount net (cost-weighted).
 *   · 'quantity': weight by each line's quantity (unit-weighted).
 *
 * Uses "largest remainder" to distribute rounding so the sum of per-line
 * allocations always equals the original charges total exactly — no lost
 * or orphan cents.
 */
export function allocateCharges<T extends { lineNetCents: number; quantity: number; isStocked: boolean }>(
  lines: T[],
  chargesTotalCents: number,
  method: AllocationMethod,
): { perLineCents: number[]; unallocatedCents: number } {
  const perLineCents = lines.map(() => 0);
  if (chargesTotalCents <= 0) return { perLineCents, unallocatedCents: 0 };

  const stockedIdxs = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.isStocked);
  if (stockedIdxs.length === 0) {
    return { perLineCents, unallocatedCents: chargesTotalCents };
  }

  const weights = stockedIdxs.map(({ l }) =>
    method === "quantity" ? Math.max(l.quantity, 0) : Math.max(l.lineNetCents, 0),
  );
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) {
    // Every stocked line has zero weight — fall back to even split.
    const even = Math.floor(chargesTotalCents / stockedIdxs.length);
    let remainder = chargesTotalCents - even * stockedIdxs.length;
    for (const { i } of stockedIdxs) {
      perLineCents[i] = even + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    }
    return { perLineCents, unallocatedCents: 0 };
  }

  // Largest-remainder allocation: floor + redistribute leftover cents to
  // the lines with the highest fractional remainders.
  const raw = weights.map((w) => (chargesTotalCents * w) / totalWeight);
  const floors = raw.map((r) => Math.floor(r));
  const remainders = raw.map((r, i) => r - floors[i]!);
  let distributed = floors.reduce((s, v) => s + v, 0);
  const orderedByRemainder = remainders
    .map((r, i) => ({ i, r }))
    .sort((a, b) => b.r - a.r);
  let leftover = chargesTotalCents - distributed;
  const extra = new Array(weights.length).fill(0);
  for (const { i } of orderedByRemainder) {
    if (leftover <= 0) break;
    extra[i] = 1;
    leftover -= 1;
  }
  for (let k = 0; k < stockedIdxs.length; k++) {
    const { i } = stockedIdxs[k]!;
    perLineCents[i] = (floors[k] ?? 0) + (extra[k] ?? 0);
  }
  return { perLineCents, unallocatedCents: 0 };
}

export async function computeBill(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  lineInputs: LineInput[],
  chargeInputs: ChargeInput[] = [],
  chargeAllocationMethod: AllocationMethod = "value",
) {
  const taxRows = await tx
    .select()
    .from(schema.taxCodes)
    .where(
      and(
        eq(schema.taxCodes.tenantId, tenantId),
        isNull(schema.taxCodes.deletedAt),
      ),
    );
  const taxById = new Map(taxRows.map((t) => [t.id, t]));

  const itemIds = Array.from(
    new Set(lineInputs.map((l) => l.itemId).filter((v): v is string => !!v)),
  );
  const itemRows = itemIds.length
    ? await tx
        .select()
        .from(schema.items)
        .where(and(eq(schema.items.tenantId, tenantId), isNull(schema.items.deletedAt)))
    : [];
  const itemById = new Map(itemRows.map((i) => [i.id, i]));

  // Default expense account (for supplier bills that don't specify):
  // subtype 'other' under expense, fallback to first expense account
  const expenseCandidates = await tx
    .select()
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        eq(schema.chartOfAccounts.accountType, "expense"),
        isNull(schema.chartOfAccounts.deletedAt),
      ),
    )
    .orderBy(asc(schema.chartOfAccounts.code));
  const defaultExpense =
    expenseCandidates.find((a) => a.accountSubtype === "other") ??
    expenseCandidates[0] ??
    null;

  // Inventory account — tracked items route here instead of an expense account
  const { inventoryAccountId } = await resolveStockGLAccounts(tx, tenantId);

  const lines = lineInputs.map((l, idx) => {
    const qty = l.quantity;
    const unit = l.unitPriceCents;
    const subtotal = Math.round(qty * unit);
    const discountPctBps = l.discountPctBps ?? 0;
    const discount = Math.round((subtotal * discountPctBps) / 10_000);
    const taxable = subtotal - discount;
    const tax = taxById.get(l.taxCodeId ?? "");
    const taxRateBps = tax?.rateBps ?? 0;
    const taxCents = Math.round((taxable * taxRateBps) / 10_000);
    const lineTotal = taxable + taxCents;
    const item = itemById.get(l.itemId ?? "");
    const isStocked = item?.trackInventory === true;
    // Tracked products: DR Inventory (capitalized to stock, relieved later as COGS)
    // Services / non-tracked: DR Expense
    const expenseAccountId = isStocked
      ? (item?.assetAccountId ?? inventoryAccountId)
      : (l.expenseAccountId ?? item?.expenseAccountId ?? defaultExpense?.id ?? null);

    // Net line cost (for stock receipts: unit cost post-discount)
    const lineNetCents = subtotal - discount;
    const effectiveUnitCostCents = qty > 0 ? Math.round(lineNetCents / qty) : 0;

    return {
      lineNo: idx + 1,
      itemId: l.itemId ?? null,
      description: l.description,
      quantity: qty,
      unitPriceCents: unit,
      lineSubtotalCents: subtotal,
      discountPctBps,
      discountCents: discount,
      taxCodeId: l.taxCodeId ?? null,
      taxRateBps,
      taxCents,
      lineTotalCents: lineTotal,
      expenseAccountId,
      taxReceivableAccountId: tax?.receivableAccountId ?? null,
      isStocked,
      effectiveUnitCostCents,
    };
  });

  const subtotalCents = lines.reduce((s, l) => s + l.lineSubtotalCents, 0);
  const discountCents = lines.reduce((s, l) => s + l.discountCents, 0);
  const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);

  // Charges (freight / insurance / customs / etc) — capitalized to inventory
  // lines via pro-rata allocation. The bill's total grows by chargesTotalCents
  // (AP credit); DR is split between Inventory (allocated portion) and the
  // 5130 Freight & handling expense account (unallocated remainder, only when
  // the bill has zero inventory lines).
  const charges = chargeInputs.map((c, idx) => ({
    lineNo: idx + 1,
    kind: c.kind,
    description: c.description ?? "",
    amountCents: c.amountCents,
  }));
  const chargesTotalCents = charges.reduce((s, c) => s + c.amountCents, 0);

  const { perLineCents: allocatedPerLineCents, unallocatedCents } = allocateCharges(
    lines.map((l) => ({
      lineNetCents: l.lineSubtotalCents - l.discountCents,
      quantity: l.quantity,
      isStocked: l.isStocked,
    })),
    chargesTotalCents,
    chargeAllocationMethod,
  );

  const linesWithLandedCost = lines.map((l, i) => {
    const landedCostCents = allocatedPerLineCents[i] ?? 0;
    const landedNetCents = (l.lineSubtotalCents - l.discountCents) + landedCostCents;
    const landedUnitCostCents = l.quantity > 0 ? Math.round(landedNetCents / l.quantity) : 0;
    return { ...l, landedCostCents, landedUnitCostCents };
  });

  const totalCents = subtotalCents - discountCents + taxCents + chargesTotalCents;

  return {
    lines: linesWithLandedCost,
    charges,
    subtotalCents,
    discountCents,
    taxCents,
    chargesTotalCents,
    chargeAllocationMethod,
    chargesUnallocatedCents: unallocatedCents,
    totalCents,
  };
}

export const billsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.bills.id,
          internalReference: schema.bills.internalReference,
          supplierBillNumber: schema.bills.supplierBillNumber,
          status: schema.bills.status,
          billDate: schema.bills.billDate,
          dueDate: schema.bills.dueDate,
          supplierId: schema.bills.supplierId,
          supplierName: schema.suppliers.name,
          currency: schema.bills.currency,
          subtotalCents: schema.bills.subtotalCents,
          taxCents: schema.bills.taxCents,
          totalCents: schema.bills.totalCents,
          balanceDueCents: schema.bills.balanceDueCents,
          createdAt: schema.bills.createdAt,
        })
        .from(schema.bills)
        .innerJoin(schema.suppliers, eq(schema.suppliers.id, schema.bills.supplierId))
        .where(
          and(
            eq(schema.bills.tenantId, ctx.tenantId),
            isNull(schema.bills.deletedAt),
          ),
        )
        .orderBy(desc(schema.bills.createdAt))
        .limit(200),
    );

    return reply.send({ bills: rows });
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const billRows = await tx
        .select()
        .from(schema.bills)
        .where(
          and(
            eq(schema.bills.tenantId, ctx.tenantId),
            eq(schema.bills.id, req.params.id),
            isNull(schema.bills.deletedAt),
          ),
        )
        .limit(1);
      const bill = billRows[0];
      if (!bill) return null;

      const lines = await tx
        .select()
        .from(schema.billLines)
        .where(eq(schema.billLines.billId, bill.id))
        .orderBy(asc(schema.billLines.lineNo));

      const charges = await tx
        .select()
        .from(schema.billCharges)
        .where(eq(schema.billCharges.billId, bill.id))
        .orderBy(asc(schema.billCharges.lineNo));

      const supplierRows = await tx
        .select()
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, bill.supplierId))
        .limit(1);

      return { bill, lines, charges, supplier: supplierRows[0] ?? null };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;
    const billDate = input.billDate ?? new Date().toISOString().slice(0, 10);

    const bill = await withTenant(ctx.tenantId, async (tx) => {
      const supRows = await tx
        .select()
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, input.supplierId),
            isNull(schema.suppliers.deletedAt),
          ),
        )
        .limit(1);
      const supplier = supRows[0];
      if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");

      const dueDate =
        input.dueDate ??
        new Date(new Date(billDate).getTime() + supplier.paymentTermsDays * 86_400_000)
          .toISOString()
          .slice(0, 10);

      const {
        lines,
        charges,
        subtotalCents,
        discountCents,
        taxCents,
        chargesTotalCents,
        totalCents,
      } = await computeBill(
        tx,
        ctx.tenantId,
        input.lines,
        input.charges ?? [],
        input.chargeAllocationMethod ?? "value",
      );

      const currency = (input.currency ?? supplier.currency ?? "LKR").toUpperCase();
      const fxRate = input.fxRate ?? 1.0;
      const foreignTotalCents = currency === "LKR"
        ? totalCents
        : Math.round(totalCents / fxRate);

      const [b] = await tx
        .insert(schema.bills)
        .values({
          tenantId: ctx.tenantId,
          supplierId: supplier.id,
          supplierBillNumber: input.supplierBillNumber || null,
          status: "draft",
          billDate,
          dueDate,
          currency,
          fxRate: fxRate.toString(),
          subtotalCents,
          discountCents,
          taxCents,
          chargesTotalCents,
          chargeAllocationMethod: input.chargeAllocationMethod ?? "value",
          totalCents,
          foreignTotalCents,
          balanceDueCents: totalCents,
          notes: input.notes || null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!b) throw new Error("Bill insert failed");

      await tx.insert(schema.billLines).values(
        lines.map((l) => ({
          tenantId: ctx.tenantId,
          billId: b.id,
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity.toString(),
          unitPriceCents: l.unitPriceCents,
          lineSubtotalCents: l.lineSubtotalCents,
          discountPctBps: l.discountPctBps,
          discountCents: l.discountCents,
          taxCodeId: l.taxCodeId,
          taxRateBps: l.taxRateBps,
          taxCents: l.taxCents,
          lineTotalCents: l.lineTotalCents,
          expenseAccountId: l.expenseAccountId,
        })),
      );

      if (charges.length > 0) {
        await tx.insert(schema.billCharges).values(
          charges.map((c) => ({
            tenantId: ctx.tenantId,
            billId: b.id,
            lineNo: c.lineNo,
            kind: c.kind,
            description: c.description || null,
            amountCents: c.amountCents,
          })),
        );
      }

      return b;
    }).catch((err: Error) => {
      if (err.message === "SUPPLIER_NOT_FOUND") {
        reply.status(400).send({ error: { code: "SUPPLIER_NOT_FOUND" } });
        return null;
      }
      throw err;
    });

    if (!bill) return;
    return reply.status(201).send({ bill });
  });

  fastify.post<{ Params: { id: string } }>("/:id/post", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const billRows = await tx
        .select()
        .from(schema.bills)
        .where(
          and(
            eq(schema.bills.tenantId, ctx.tenantId),
            eq(schema.bills.id, req.params.id),
            isNull(schema.bills.deletedAt),
          ),
        )
        .limit(1);
      const bill = billRows[0];
      if (!bill) return { error: "NOT_FOUND" as const };
      if (bill.status !== "draft") return { error: "NOT_DRAFT" as const };

      const lines = await tx
        .select()
        .from(schema.billLines)
        .where(eq(schema.billLines.billId, bill.id))
        .orderBy(asc(schema.billLines.lineNo));
      if (lines.length === 0) return { error: "NO_LINES" as const };

      const charges = await tx
        .select()
        .from(schema.billCharges)
        .where(eq(schema.billCharges.billId, bill.id))
        .orderBy(asc(schema.billCharges.lineNo));

      const internalReference = await nextDocumentNumber(tx, "bill");

      // AP account
      const apRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.accountSubtype, "ap"),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      const apAccount = apRows[0];
      if (!apAccount) return { error: "NO_AP_ACCOUNT" as const };

      // Load linked items once — needed both to know which lines are stocked
      // (for charge allocation) and for the stock-receipt pass below.
      const trackedLinesForItems = lines.filter((l) => l.itemId !== null);
      const linkedItems = trackedLinesForItems.length > 0
        ? await tx
            .select()
            .from(schema.items)
            .where(
              and(
                eq(schema.items.tenantId, ctx.tenantId),
                isNull(schema.items.deletedAt),
              ),
            )
        : [];
      const itemById = new Map(linkedItems.map((i) => [i.id, i]));

      // Allocate charges across stocked lines pro-rata by value (default) or
      // by quantity. Lines without a tracked item don't receive any charge
      // allocation; if zero stocked lines exist, the whole charge total is
      // unallocated and posts to 5130 Freight & handling (fallback).
      const allocationLines = lines.map((l) => {
        const item = l.itemId ? itemById.get(l.itemId) : undefined;
        const isStocked = item?.trackInventory === true;
        return {
          lineNetCents: l.lineSubtotalCents - l.discountCents,
          quantity: Number(l.quantity),
          isStocked,
        };
      });
      const chargesTotalCents = charges.reduce((s, c) => s + c.amountCents, 0);
      const allocationMethod = (bill.chargeAllocationMethod as AllocationMethod) ?? "value";
      const { perLineCents: allocatedPerLine, unallocatedCents } = allocateCharges(
        allocationLines,
        chargesTotalCents,
        allocationMethod,
      );

      const journalLines: Parameters<typeof postJournal>[1]["lines"] = [];

      // Expense lines grouped by expense account — for stocked lines this is
      // the inventory account (charges capitalize here); for expense lines
      // this is the per-line expense account.
      const expenseByAccount = new Map<string, number>();
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!;
        if (!l.expenseAccountId) return { error: "MISSING_EXPENSE_ACCOUNT" as const };
        const net = l.lineSubtotalCents - l.discountCents;
        const allocated = allocatedPerLine[i] ?? 0;
        expenseByAccount.set(
          l.expenseAccountId,
          (expenseByAccount.get(l.expenseAccountId) ?? 0) + net + allocated,
        );
      }
      // Unallocated charges (bill has no stocked lines) → expense to
      // 5130 Freight & handling. Falls back to any "cogs" account if 5130
      // isn't seeded yet on this tenant.
      if (unallocatedCents > 0) {
        const freightRows = await tx
          .select()
          .from(schema.chartOfAccounts)
          .where(
            and(
              eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
              eq(schema.chartOfAccounts.code, "5130"),
              isNull(schema.chartOfAccounts.deletedAt),
            ),
          )
          .limit(1);
        const freightAccountId = freightRows[0]?.id;
        if (!freightAccountId) return { error: "NO_FREIGHT_ACCOUNT" as const };
        expenseByAccount.set(
          freightAccountId,
          (expenseByAccount.get(freightAccountId) ?? 0) + unallocatedCents,
        );
      }
      for (const [accountId, amount] of expenseByAccount) {
        if (amount <= 0) continue;
        journalLines.push({
          accountId,
          drCents: amount,
          description: `Expense · ${internalReference}`,
          supplierId: bill.supplierId,
        });
      }

      // VAT recoverable (input tax), grouped by receivable account
      const taxRows = await tx
        .select()
        .from(schema.taxCodes)
        .where(eq(schema.taxCodes.tenantId, ctx.tenantId));
      const receivableByTaxCode = new Map(taxRows.map((t) => [t.id, t.receivableAccountId]));
      const taxByAccount = new Map<string, number>();
      for (const l of lines) {
        if (l.taxCents === 0) continue;
        const recAcc = receivableByTaxCode.get(l.taxCodeId ?? "");
        if (!recAcc) continue;
        taxByAccount.set(recAcc, (taxByAccount.get(recAcc) ?? 0) + l.taxCents);
      }
      for (const [accountId, amount] of taxByAccount) {
        if (amount <= 0) continue;
        journalLines.push({
          accountId,
          drCents: amount,
          description: `Input tax · ${internalReference}`,
        });
      }

      journalLines.push({
        accountId: apAccount.id,
        crCents: bill.totalCents,
        description: `AP · ${internalReference}`,
        supplierId: bill.supplierId,
      });

      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: bill.billDate,
        memo: `Bill ${internalReference}`,
        sourceType: "bill",
        sourceId: bill.id,
        postedByUserId: ctx.userId,
        lines: journalLines,
      });

      // Stock receipts for tracked items — one per line with itemId
      // referencing a tracked item. Unit cost = line net + allocated landed
      // cost, divided by quantity. WAVG propagation in applyStockReceipt
      // picks up the landed figure automatically.
      if (trackedLinesForItems.length > 0) {
        const defaultWarehouse = await resolveDefaultWarehouse(tx, ctx.tenantId);
        if (!defaultWarehouse) return { error: "NO_DEFAULT_WAREHOUSE" as const };

        for (let i = 0; i < lines.length; i++) {
          const l = lines[i]!;
          if (!l.itemId) continue;
          const item = itemById.get(l.itemId);
          if (!item || !item.trackInventory) continue;
          const qty = Number(l.quantity);
          if (qty <= 0) continue;
          const netCents = l.lineSubtotalCents - l.discountCents;
          const allocated = allocatedPerLine[i] ?? 0;
          const unitCost = Math.round((netCents + allocated) / qty);
          await applyStockReceipt(tx, {
            tenantId: ctx.tenantId,
            itemId: item.id,
            warehouseId: defaultWarehouse.id,
            quantity: qty,
            unitCostCents: unitCost,
            sourceDocumentType: "bill",
            sourceDocumentId: bill.id,
            sourceLineId: l.id,
            journalEntryId: entryId,
            postedByUserId: ctx.userId,
            memo: `Bill ${internalReference}`,
          });
        }
      }

      await tx
        .update(schema.bills)
        .set({
          status: "posted",
          internalReference,
          journalEntryId: entryId,
          postedAt: new Date(),
          postedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.bills.id, bill.id));

      const [sup] = await tx
        .select({ name: schema.suppliers.name })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, bill.supplierId))
        .limit(1);

      const tenantUsers = await tx.execute(sql`
        SELECT id FROM users WHERE tenant_id = current_tenant_id()
      `);
      const formattedTotal = (bill.totalCents / 100).toLocaleString("en-LK", {
        style: "currency",
        currency: bill.currency || "LKR",
        maximumFractionDigits: 2,
      });
      for (const u of tenantUsers as unknown as Array<{ id: string }>) {
        await emitNotification(tx, {
          tenantId: ctx.tenantId,
          userId: u.id,
          kind: "bill_posted",
          title: `Bill ${internalReference} posted`,
          body: `${sup?.name ?? "Supplier"} · ${formattedTotal}`,
          refType: "bill",
          refId: bill.id,
        });
      }

      return { ok: true as const, internalReference, entryNumber };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_DRAFT: 409,
        NO_LINES: 400,
        NO_AP_ACCOUNT: 500,
        NO_FREIGHT_ACCOUNT: 500,
        MISSING_EXPENSE_ACCOUNT: 500,
        NO_DEFAULT_WAREHOUSE: 500,
      };
      return reply.status(map[result.error] ?? 500).send({ error: { code: result.error } });
    }
    return reply.send(result);
  });

  // POST /bills/:id/void — reverse a posted bill
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/:id/void",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const billRows = await tx
          .select()
          .from(schema.bills)
          .where(
            and(
              eq(schema.bills.tenantId, ctx.tenantId),
              eq(schema.bills.id, req.params.id),
              isNull(schema.bills.deletedAt),
            ),
          )
          .limit(1);
        const bill = billRows[0];
        if (!bill) return { error: "NOT_FOUND" as const };
        if (bill.status === "void") return { error: "ALREADY_VOID" as const };
        if (!["posted", "partially_paid"].includes(bill.status)) {
          return { error: "NOT_VOIDABLE" as const };
        }
        if (bill.amountPaidCents > 0) return { error: "HAS_PAYMENTS" as const };
        if (!bill.journalEntryId) return { error: "NO_SOURCE_ENTRY" as const };

        const today = new Date().toISOString().slice(0, 10);
        const { entryId, entryNumber } = await postReversingJournal(tx, {
          tenantId: ctx.tenantId,
          sourceEntryId: bill.journalEntryId,
          reversalDate: today,
          memo: `Void bill ${bill.internalReference ?? bill.id.slice(0, 8)}${reason ? " · " + reason : ""}`,
          sourceType: "bill_void",
          sourceId: bill.id,
          postedByUserId: ctx.userId,
        });

        await rewindStockForSource(tx, {
          tenantId: ctx.tenantId,
          sourceDocumentType: "bill",
          sourceDocumentId: bill.id,
          journalEntryId: entryId,
          postedByUserId: ctx.userId,
          memo: `Void bill ${bill.internalReference ?? bill.id.slice(0, 8)}`,
        });

        await tx
          .update(schema.bills)
          .set({
            status: "void",
            balanceDueCents: 0,
            updatedAt: new Date(),
            notes:
              reason && bill.notes
                ? `${bill.notes}\n\n[Voided] ${reason}`
                : reason
                  ? `[Voided] ${reason}`
                  : bill.notes,
          })
          .where(eq(schema.bills.id, bill.id));

        return { ok: true as const, reversalEntryNumber: entryNumber };
      }).catch((err: Error & { message: string }) => {
        if (err.message === "ALREADY_REVERSED") {
          return { error: "ALREADY_REVERSED" as const };
        }
        throw err;
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          NOT_VOIDABLE: 409,
          ALREADY_VOID: 409,
          ALREADY_REVERSED: 409,
          HAS_PAYMENTS: 409,
          NO_SOURCE_ENTRY: 500,
        };
        const messages: Record<string, string> = {
          HAS_PAYMENTS:
            "This bill has payments allocated. Reverse the payments first, then void the bill.",
          NOT_VOIDABLE: "Only posted bills with no payments can be voided.",
          ALREADY_VOID: "This bill is already void.",
          ALREADY_REVERSED: "The original journal entry is already reversed.",
        };
        return reply
          .status(map[result.error] ?? 500)
          .send({ error: { code: result.error, message: messages[result.error] } });
      }
      return reply.send(result);
    },
  );
};
