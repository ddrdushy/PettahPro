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

const CreateSchema = z.object({
  supplierId: z.string().uuid(),
  supplierBillNumber: z.string().max(64).optional().or(z.literal("")),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional().or(z.literal("")),
  lines: z.array(LineSchema).min(1),
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

async function computeBill(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  lineInputs: LineInput[],
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
  const totalCents = subtotalCents - discountCents + taxCents;

  return { lines, subtotalCents, discountCents, taxCents, totalCents };
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

      const supplierRows = await tx
        .select()
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, bill.supplierId))
        .limit(1);

      return { bill, lines, supplier: supplierRows[0] ?? null };
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

      const { lines, subtotalCents, discountCents, taxCents, totalCents } =
        await computeBill(tx, ctx.tenantId, input.lines);

      const [b] = await tx
        .insert(schema.bills)
        .values({
          tenantId: ctx.tenantId,
          supplierId: supplier.id,
          supplierBillNumber: input.supplierBillNumber || null,
          status: "draft",
          billDate,
          dueDate,
          currency: supplier.currency ?? "LKR",
          subtotalCents,
          discountCents,
          taxCents,
          totalCents,
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

      const journalLines: Parameters<typeof postJournal>[1]["lines"] = [];

      // Expense lines grouped by expense account
      const expenseByAccount = new Map<string, number>();
      for (const l of lines) {
        if (!l.expenseAccountId) return { error: "MISSING_EXPENSE_ACCOUNT" as const };
        const net = l.lineSubtotalCents - l.discountCents;
        expenseByAccount.set(
          l.expenseAccountId,
          (expenseByAccount.get(l.expenseAccountId) ?? 0) + net,
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

      // Stock receipts for tracked items — one per line with itemId referencing a tracked item.
      const trackedLines = lines.filter((l) => l.itemId !== null);
      if (trackedLines.length > 0) {
        const linkedItems = await tx
          .select()
          .from(schema.items)
          .where(
            and(
              eq(schema.items.tenantId, ctx.tenantId),
              isNull(schema.items.deletedAt),
            ),
          );
        const itemById = new Map(linkedItems.map((i) => [i.id, i]));

        const defaultWarehouse = await resolveDefaultWarehouse(tx, ctx.tenantId);
        if (!defaultWarehouse) return { error: "NO_DEFAULT_WAREHOUSE" as const };

        for (const l of trackedLines) {
          const item = itemById.get(l.itemId!);
          if (!item || !item.trackInventory) continue;
          const qty = Number(l.quantity);
          if (qty <= 0) continue;
          const netCents = l.lineSubtotalCents - l.discountCents;
          const unitCost = qty > 0 ? Math.round(netCents / qty) : 0;
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
