import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, sql, asc } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "../accounting/journal-posting.js";

const ReasonEnum = z.enum([
  "return",
  "price_adjustment",
  "discount",
  "goodwill",
  "shortage",
  "other",
]);

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
  billId: z.string().uuid().optional(),
  supplierDebitNumber: z.string().max(64).optional().or(z.literal("")),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: ReasonEnum.optional().default("return"),
  notes: z.string().optional().or(z.literal("")),
  lines: z.array(LineSchema).min(1),
});

interface ComputedLine {
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountPctBps: number;
  discountCents: number;
  taxCodeId: string | null;
  taxRateBps: number;
  taxCents: number;
  lineTotalCents: number;
  expenseAccountId: string | null;
  taxReceivableAccountId: string | null;
}

interface LineInput {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
  expenseAccountId?: string;
}

// Mirror of computeBill — resolves expense account from item default or
// line override or tenant default.
async function computeDebitNote(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  lineInputs: LineInput[],
): Promise<{
  lines: ComputedLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}> {
  const taxCodeIds = Array.from(
    new Set(lineInputs.map((l) => l.taxCodeId).filter((v): v is string => !!v)),
  );
  const itemIds = Array.from(
    new Set(lineInputs.map((l) => l.itemId).filter((v): v is string => !!v)),
  );

  const taxRows = taxCodeIds.length
    ? await tx
        .select()
        .from(schema.taxCodes)
        .where(and(eq(schema.taxCodes.tenantId, tenantId), isNull(schema.taxCodes.deletedAt)))
    : [];
  const taxById = new Map(taxRows.map((t) => [t.id, t]));

  const itemRows = itemIds.length
    ? await tx
        .select()
        .from(schema.items)
        .where(and(eq(schema.items.tenantId, tenantId), isNull(schema.items.deletedAt)))
    : [];
  const itemById = new Map(itemRows.map((i) => [i.id, i]));

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

  const lines: ComputedLine[] = lineInputs.map((l, idx) => {
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
    const expenseAccountId =
      l.expenseAccountId ?? item?.expenseAccountId ?? defaultExpense?.id ?? null;

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
    };
  });

  const subtotalCents = lines.reduce((s, l) => s + l.lineSubtotalCents, 0);
  const discountCents = lines.reduce((s, l) => s + l.discountCents, 0);
  const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);
  const totalCents = subtotalCents - discountCents + taxCents;

  return { lines, subtotalCents, discountCents, taxCents, totalCents };
}

export const debitNotesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /debit-notes — list
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.debitNotes.id,
          internalReference: schema.debitNotes.internalReference,
          supplierDebitNumber: schema.debitNotes.supplierDebitNumber,
          status: schema.debitNotes.status,
          issueDate: schema.debitNotes.issueDate,
          supplierId: schema.debitNotes.supplierId,
          supplierName: schema.suppliers.name,
          billId: schema.debitNotes.billId,
          currency: schema.debitNotes.currency,
          totalCents: schema.debitNotes.totalCents,
          appliedCents: schema.debitNotes.appliedCents,
          reason: schema.debitNotes.reason,
          createdAt: schema.debitNotes.createdAt,
        })
        .from(schema.debitNotes)
        .innerJoin(
          schema.suppliers,
          eq(schema.suppliers.id, schema.debitNotes.supplierId),
        )
        .where(
          and(
            eq(schema.debitNotes.tenantId, ctx.tenantId),
            isNull(schema.debitNotes.deletedAt),
          ),
        )
        .orderBy(desc(schema.debitNotes.createdAt))
        .limit(200),
    );

    return reply.send({ debitNotes: rows });
  });

  // GET /debit-notes/:id — detail
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [dn] = await tx
        .select()
        .from(schema.debitNotes)
        .where(
          and(
            eq(schema.debitNotes.tenantId, ctx.tenantId),
            eq(schema.debitNotes.id, req.params.id),
            isNull(schema.debitNotes.deletedAt),
          ),
        )
        .limit(1);
      if (!dn) return null;

      const [supplier] = await tx
        .select()
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, dn.supplierId),
          ),
        )
        .limit(1);

      const lines = await tx
        .select()
        .from(schema.debitNoteLines)
        .where(
          and(
            eq(schema.debitNoteLines.tenantId, ctx.tenantId),
            eq(schema.debitNoteLines.debitNoteId, dn.id),
          ),
        )
        .orderBy(asc(schema.debitNoteLines.lineNo));

      let bill: {
        id: string;
        internalReference: string | null;
        supplierBillNumber: string | null;
        totalCents: number;
        balanceDueCents: number;
      } | null = null;
      if (dn.billId) {
        const [b] = await tx
          .select({
            id: schema.bills.id,
            internalReference: schema.bills.internalReference,
            supplierBillNumber: schema.bills.supplierBillNumber,
            totalCents: schema.bills.totalCents,
            balanceDueCents: schema.bills.balanceDueCents,
          })
          .from(schema.bills)
          .where(
            and(
              eq(schema.bills.tenantId, ctx.tenantId),
              eq(schema.bills.id, dn.billId),
            ),
          )
          .limit(1);
        bill = b ?? null;
      }

      return { debitNote: dn, lines, supplier: supplier ?? null, bill };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /debit-notes — create draft
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const body = parsed.data;
    const issueDate = body.issueDate ?? new Date().toISOString().slice(0, 10);
    const supplierDebitNumber =
      body.supplierDebitNumber && body.supplierDebitNumber.trim()
        ? body.supplierDebitNumber.trim()
        : null;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const supRows = await tx
        .select()
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, body.supplierId),
            isNull(schema.suppliers.deletedAt),
          ),
        )
        .limit(1);
      if (!supRows[0]) return { error: "SUPPLIER_NOT_FOUND" as const };

      if (body.billId) {
        const [b] = await tx
          .select()
          .from(schema.bills)
          .where(
            and(
              eq(schema.bills.tenantId, ctx.tenantId),
              eq(schema.bills.id, body.billId),
              isNull(schema.bills.deletedAt),
            ),
          )
          .limit(1);
        if (!b) return { error: "BILL_NOT_FOUND" as const };
        if (b.supplierId !== body.supplierId) {
          return { error: "BILL_SUPPLIER_MISMATCH" as const };
        }
        if (b.status === "draft" || b.status === "void") {
          return { error: "BILL_NOT_POSTED" as const };
        }
      }

      const computed = await computeDebitNote(
        tx,
        ctx.tenantId,
        body.lines as LineInput[],
      );

      const [dn] = await tx
        .insert(schema.debitNotes)
        .values({
          tenantId: ctx.tenantId,
          supplierId: body.supplierId,
          billId: body.billId ?? null,
          supplierDebitNumber,
          status: "draft",
          issueDate,
          reason: body.reason,
          notes: body.notes && body.notes.trim() ? body.notes.trim() : null,
          subtotalCents: computed.subtotalCents,
          discountCents: computed.discountCents,
          taxCents: computed.taxCents,
          totalCents: computed.totalCents,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!dn) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.debitNoteLines).values(
        computed.lines.map((l) => ({
          tenantId: ctx.tenantId,
          debitNoteId: dn.id,
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          quantity: String(l.quantity),
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

      return { debitNote: dn };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        SUPPLIER_NOT_FOUND: "Supplier not found.",
        BILL_NOT_FOUND: "Bill not found.",
        BILL_SUPPLIER_MISMATCH: "Bill belongs to a different supplier.",
        BILL_NOT_POSTED: "Debit notes can only reference posted bills.",
        INSERT_FAILED: "Couldn't create the debit note.",
      };
      const code = result.error as string;
      const status = code === "INSERT_FAILED" ? 500 : 400;
      return reply
        .status(status)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.status(201).send({ debitNote: result.debitNote });
  });

  // POST /debit-notes/:id/post — post to GL
  fastify.post<{ Params: { id: string } }>("/:id/post", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [dn] = await tx
        .select()
        .from(schema.debitNotes)
        .where(
          and(
            eq(schema.debitNotes.tenantId, ctx.tenantId),
            eq(schema.debitNotes.id, req.params.id),
            isNull(schema.debitNotes.deletedAt),
          ),
        )
        .limit(1);
      if (!dn) return { error: "NOT_FOUND" as const };
      if (dn.status !== "draft") return { error: "ALREADY_POSTED" as const };
      if (dn.totalCents === 0) return { error: "EMPTY" as const };

      // Resolve AP account
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

      const lines = await tx
        .select()
        .from(schema.debitNoteLines)
        .where(
          and(
            eq(schema.debitNoteLines.tenantId, ctx.tenantId),
            eq(schema.debitNoteLines.debitNoteId, dn.id),
          ),
        );
      if (lines.length === 0) return { error: "EMPTY" as const };

      const numRows = (await tx.execute(
        sql`SELECT next_document_number('debit_note') AS number`,
      )) as unknown as Array<{ number: string }>;
      const dnNumber = numRows[0]?.number;
      if (!dnNumber) return { error: "NUMBER_ALLOC_FAILED" as const };

      // Mirror of bill posting, with DR/CR swapped.
      // DR Accounts Payable (reduces what we owe the supplier)
      // CR Expense accounts (reverses the expense booked on the original bill)
      // CR Tax receivable (reverses the input VAT we were going to claim)
      const journalLines: Parameters<typeof postJournal>[1]["lines"] = [
        {
          accountId: apAccount.id,
          drCents: dn.totalCents,
          description: `AP reversal · ${dnNumber}`,
          supplierId: dn.supplierId,
        },
      ];

      // Group expense credits by account
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
          crCents: amount,
          description: `Purchase reversal · ${dnNumber}`,
          supplierId: dn.supplierId,
        });
      }

      // Group tax receivable credits by account (reverses input VAT claim)
      const taxCodeIds = Array.from(
        new Set(lines.map((l) => l.taxCodeId).filter((v): v is string => !!v)),
      );
      if (taxCodeIds.length > 0) {
        const taxRows = await tx
          .select()
          .from(schema.taxCodes)
          .where(eq(schema.taxCodes.tenantId, ctx.tenantId));
        const receivableByCode = new Map(
          taxRows.map((t) => [t.id, t.receivableAccountId]),
        );
        const taxByAccount = new Map<string, number>();
        for (const l of lines) {
          if (l.taxCents === 0) continue;
          const receivable = receivableByCode.get(l.taxCodeId ?? "");
          if (!receivable) continue;
          taxByAccount.set(receivable, (taxByAccount.get(receivable) ?? 0) + l.taxCents);
        }
        for (const [accountId, amount] of taxByAccount) {
          if (amount <= 0) continue;
          journalLines.push({
            accountId,
            crCents: amount,
            description: `Input VAT reversal · ${dnNumber}`,
          });
        }
      }

      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: dn.issueDate,
        memo: `Debit note ${dnNumber}`,
        sourceType: "debit_note",
        sourceId: dn.id,
        postedByUserId: ctx.userId,
        lines: journalLines,
      });

      await tx
        .update(schema.debitNotes)
        .set({
          status: "posted",
          internalReference: dnNumber,
          journalEntryId: entryId,
          postedAt: new Date(),
          postedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.debitNotes.id, dn.id));

      // If linked to a bill, apply as much as possible (bounded by
      // the bill's current balance_due). Unapplied remainder becomes
      // a standing debit against the supplier.
      let appliedCents = 0;
      if (dn.billId) {
        const [b] = await tx
          .select()
          .from(schema.bills)
          .where(
            and(
              eq(schema.bills.tenantId, ctx.tenantId),
              eq(schema.bills.id, dn.billId),
            ),
          )
          .limit(1);
        if (b) {
          appliedCents = Math.min(dn.totalCents, b.balanceDueCents);
          const newBalance = b.balanceDueCents - appliedCents;
          const newAmountPaid = b.amountPaidCents + appliedCents;
          const newStatus =
            newBalance === 0
              ? "paid"
              : newAmountPaid > 0
                ? "partially_paid"
                : b.status;
          await tx
            .update(schema.bills)
            .set({
              balanceDueCents: newBalance,
              amountPaidCents: newAmountPaid,
              status: newStatus,
              updatedAt: new Date(),
            })
            .where(eq(schema.bills.id, b.id));
        }
      }

      if (appliedCents > 0) {
        await tx
          .update(schema.debitNotes)
          .set({ appliedCents })
          .where(eq(schema.debitNotes.id, dn.id));
      }

      return { internalReference: dnNumber, entryNumber, appliedCents };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Debit note not found.",
        ALREADY_POSTED: "This debit note has already been posted.",
        EMPTY: "Debit note has no amount to post.",
        MISSING_EXPENSE_ACCOUNT: "A line is missing its expense account. Check the item or default expense account.",
        NO_AP_ACCOUNT: "No Accounts Payable account configured.",
        NUMBER_ALLOC_FAILED: "Couldn't allocate a debit note number.",
      };
      const code = result.error as string;
      const status = code === "NOT_FOUND" ? 404 : 400;
      return reply
        .status(status)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true, ...result });
  });
};
