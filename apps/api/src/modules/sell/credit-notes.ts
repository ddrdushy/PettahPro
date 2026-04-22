import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, sql, asc } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { postJournal } from "../accounting/journal-posting.js";

const ReasonEnum = z.enum([
  "return",
  "price_adjustment",
  "discount",
  "goodwill",
  "write_off",
  "other",
]);

const LineSchema = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unitPriceCents: z.number().int().min(0),
  discountPctBps: z.number().int().min(0).max(10000).default(0),
  taxCodeId: z.string().uuid().optional(),
});

const CreateSchema = z.object({
  customerId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
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
  incomeAccountId: string | null;
  taxPayableAccountId: string | null;
}

interface LineInput {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
}

// Same calculation pipeline as invoices — kept local rather than
// factored out to avoid coupling the two modules at a shared utility.
async function computeCreditNote(
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

  const defaultSalesRows = await tx
    .select()
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        eq(schema.chartOfAccounts.accountSubtype, "sales"),
        isNull(schema.chartOfAccounts.deletedAt),
      ),
    )
    .orderBy(asc(schema.chartOfAccounts.code))
    .limit(1);
  const defaultSalesAccountId = defaultSalesRows[0]?.id ?? null;

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
    const incomeAccountId = item?.incomeAccountId ?? defaultSalesAccountId;

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
      incomeAccountId,
      taxPayableAccountId: tax?.payableAccountId ?? null,
    };
  });

  const subtotalCents = lines.reduce((s, l) => s + l.lineSubtotalCents, 0);
  const discountCents = lines.reduce((s, l) => s + l.discountCents, 0);
  const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);
  const totalCents = subtotalCents - discountCents + taxCents;

  return { lines, subtotalCents, discountCents, taxCents, totalCents };
}

export const creditNotesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /credit-notes — list
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.creditNotes.id,
          creditNoteNumber: schema.creditNotes.creditNoteNumber,
          status: schema.creditNotes.status,
          issueDate: schema.creditNotes.issueDate,
          customerId: schema.creditNotes.customerId,
          customerName: schema.customers.name,
          invoiceId: schema.creditNotes.invoiceId,
          currency: schema.creditNotes.currency,
          totalCents: schema.creditNotes.totalCents,
          appliedCents: schema.creditNotes.appliedCents,
          reason: schema.creditNotes.reason,
          createdAt: schema.creditNotes.createdAt,
        })
        .from(schema.creditNotes)
        .innerJoin(
          schema.customers,
          eq(schema.customers.id, schema.creditNotes.customerId),
        )
        .where(
          and(
            eq(schema.creditNotes.tenantId, ctx.tenantId),
            isNull(schema.creditNotes.deletedAt),
          ),
        )
        .orderBy(desc(schema.creditNotes.createdAt))
        .limit(200),
    );

    return reply.send({ creditNotes: rows });
  });

  // GET /credit-notes/:id — detail
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [cn] = await tx
        .select()
        .from(schema.creditNotes)
        .where(
          and(
            eq(schema.creditNotes.tenantId, ctx.tenantId),
            eq(schema.creditNotes.id, req.params.id),
            isNull(schema.creditNotes.deletedAt),
          ),
        )
        .limit(1);
      if (!cn) return null;

      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, cn.customerId),
          ),
        )
        .limit(1);

      const lines = await tx
        .select()
        .from(schema.creditNoteLines)
        .where(
          and(
            eq(schema.creditNoteLines.tenantId, ctx.tenantId),
            eq(schema.creditNoteLines.creditNoteId, cn.id),
          ),
        )
        .orderBy(asc(schema.creditNoteLines.lineNo));

      // If linked, grab a minimal invoice summary for the UI
      let invoice: {
        id: string;
        invoiceNumber: string | null;
        totalCents: number;
        balanceDueCents: number;
      } | null = null;
      if (cn.invoiceId) {
        const [inv] = await tx
          .select({
            id: schema.invoices.id,
            invoiceNumber: schema.invoices.invoiceNumber,
            totalCents: schema.invoices.totalCents,
            balanceDueCents: schema.invoices.balanceDueCents,
          })
          .from(schema.invoices)
          .where(
            and(
              eq(schema.invoices.tenantId, ctx.tenantId),
              eq(schema.invoices.id, cn.invoiceId),
            ),
          )
          .limit(1);
        invoice = inv ?? null;
      }

      return { creditNote: cn, lines, customer: customer ?? null, invoice };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /credit-notes — create draft
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

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Sanity: customer exists, (if linked) invoice is for the same customer.
      const custRows = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, body.customerId),
            isNull(schema.customers.deletedAt),
          ),
        )
        .limit(1);
      if (!custRows[0]) return { error: "CUSTOMER_NOT_FOUND" as const };

      if (body.invoiceId) {
        const [inv] = await tx
          .select()
          .from(schema.invoices)
          .where(
            and(
              eq(schema.invoices.tenantId, ctx.tenantId),
              eq(schema.invoices.id, body.invoiceId),
              isNull(schema.invoices.deletedAt),
            ),
          )
          .limit(1);
        if (!inv) return { error: "INVOICE_NOT_FOUND" as const };
        if (inv.customerId !== body.customerId) {
          return { error: "INVOICE_CUSTOMER_MISMATCH" as const };
        }
        if (inv.status === "draft" || inv.status === "void") {
          return { error: "INVOICE_NOT_POSTED" as const };
        }
      }

      const computed = await computeCreditNote(
        tx,
        ctx.tenantId,
        body.lines as LineInput[],
      );

      const [cn] = await tx
        .insert(schema.creditNotes)
        .values({
          tenantId: ctx.tenantId,
          customerId: body.customerId,
          invoiceId: body.invoiceId ?? null,
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
      if (!cn) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.creditNoteLines).values(
        computed.lines.map((l) => ({
          tenantId: ctx.tenantId,
          creditNoteId: cn.id,
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
          incomeAccountId: l.incomeAccountId,
        })),
      );

      return { creditNote: cn };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        CUSTOMER_NOT_FOUND: "Customer not found.",
        INVOICE_NOT_FOUND: "Invoice not found.",
        INVOICE_CUSTOMER_MISMATCH: "Invoice belongs to a different customer.",
        INVOICE_NOT_POSTED: "Credit notes can only reference posted invoices.",
        INSERT_FAILED: "Couldn't create the credit note.",
      };
      const code = result.error as string;
      const status = code === "INSERT_FAILED" ? 500 : 400;
      return reply
        .status(status)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.status(201).send({ creditNote: result.creditNote });
  });

  // POST /credit-notes/:id/post — post to GL. Credit notes reverse sales,
  // so the poster needs the same gate as invoices.post — not a separate perm.
  fastify.post<{ Params: { id: string } }>("/:id/post", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "invoices.post");
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [cn] = await tx
        .select()
        .from(schema.creditNotes)
        .where(
          and(
            eq(schema.creditNotes.tenantId, ctx.tenantId),
            eq(schema.creditNotes.id, req.params.id),
            isNull(schema.creditNotes.deletedAt),
          ),
        )
        .limit(1);
      if (!cn) return { error: "NOT_FOUND" as const };
      if (cn.status !== "draft") return { error: "ALREADY_POSTED" as const };
      if (cn.totalCents === 0) return { error: "EMPTY" as const };

      // Resolve AR account
      const arRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.accountSubtype, "ar"),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      const arAccount = arRows[0];
      if (!arAccount) return { error: "NO_AR_ACCOUNT" as const };

      const lines = await tx
        .select()
        .from(schema.creditNoteLines)
        .where(
          and(
            eq(schema.creditNoteLines.tenantId, ctx.tenantId),
            eq(schema.creditNoteLines.creditNoteId, cn.id),
          ),
        );
      if (lines.length === 0) return { error: "EMPTY" as const };

      // Allocate CN number
      const numRows = (await tx.execute(
        sql`SELECT next_document_number('credit_note') AS number`,
      )) as unknown as Array<{ number: string }>;
      const cnNumber = numRows[0]?.number;
      if (!cnNumber) return { error: "NUMBER_ALLOC_FAILED" as const };

      // Mirror of invoice posting, with DR/CR swapped.
      // CR Accounts Receivable (reduces customer's owed balance)
      // DR Income accounts (reverses revenue booked on the original invoice)
      // DR Tax payable (reverses the tax we previously owed IRD)
      const journalLines: Parameters<typeof postJournal>[1]["lines"] = [
        {
          accountId: arAccount.id,
          crCents: cn.totalCents,
          description: `AR reversal · ${cnNumber}`,
          customerId: cn.customerId,
        },
      ];

      // Group income debits by account
      const incomeByAccount = new Map<string, number>();
      for (const l of lines) {
        if (!l.incomeAccountId) return { error: "MISSING_INCOME_ACCOUNT" as const };
        const net = l.lineSubtotalCents - l.discountCents;
        incomeByAccount.set(
          l.incomeAccountId,
          (incomeByAccount.get(l.incomeAccountId) ?? 0) + net,
        );
      }
      for (const [accountId, amount] of incomeByAccount) {
        if (amount <= 0) continue;
        journalLines.push({
          accountId,
          drCents: amount,
          description: `Sales reversal · ${cnNumber}`,
          customerId: cn.customerId,
        });
      }

      // Group tax payable debits by account
      const taxCodeIds = Array.from(
        new Set(lines.map((l) => l.taxCodeId).filter((v): v is string => !!v)),
      );
      if (taxCodeIds.length > 0) {
        const taxRows = await tx
          .select()
          .from(schema.taxCodes)
          .where(eq(schema.taxCodes.tenantId, ctx.tenantId));
        const payableByCode = new Map(taxRows.map((t) => [t.id, t.payableAccountId]));
        const taxByAccount = new Map<string, number>();
        for (const l of lines) {
          if (l.taxCents === 0) continue;
          const payable = payableByCode.get(l.taxCodeId ?? "");
          if (!payable) continue;
          taxByAccount.set(payable, (taxByAccount.get(payable) ?? 0) + l.taxCents);
        }
        for (const [accountId, amount] of taxByAccount) {
          if (amount <= 0) continue;
          journalLines.push({
            accountId,
            drCents: amount,
            description: `Tax payable reversal · ${cnNumber}`,
          });
        }
      }

      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: cn.issueDate,
        memo: `Credit note ${cnNumber}`,
        sourceType: "credit_note",
        sourceId: cn.id,
        postedByUserId: ctx.userId,
        lines: journalLines,
      });

      // Mark credit note as posted
      await tx
        .update(schema.creditNotes)
        .set({
          status: "posted",
          creditNoteNumber: cnNumber,
          journalEntryId: entryId,
          postedAt: new Date(),
          postedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.creditNotes.id, cn.id));

      // If linked to an invoice, apply as much as possible (bounded by
      // the invoice's current balance_due). Unapplied remainder becomes
      // a standing credit on the customer (negative AR for that customer).
      let appliedCents = 0;
      if (cn.invoiceId) {
        const [inv] = await tx
          .select()
          .from(schema.invoices)
          .where(
            and(
              eq(schema.invoices.tenantId, ctx.tenantId),
              eq(schema.invoices.id, cn.invoiceId),
            ),
          )
          .limit(1);
        if (inv) {
          appliedCents = Math.min(cn.totalCents, inv.balanceDueCents);
          const newBalance = inv.balanceDueCents - appliedCents;
          const newAmountPaid = inv.amountPaidCents + appliedCents;
          const newStatus =
            newBalance === 0
              ? "paid"
              : newAmountPaid > 0
                ? "partially_paid"
                : inv.status;
          await tx
            .update(schema.invoices)
            .set({
              balanceDueCents: newBalance,
              amountPaidCents: newAmountPaid,
              status: newStatus,
              updatedAt: new Date(),
            })
            .where(eq(schema.invoices.id, inv.id));
        }
      }

      if (appliedCents > 0) {
        await tx
          .update(schema.creditNotes)
          .set({ appliedCents })
          .where(eq(schema.creditNotes.id, cn.id));
      }

      return { creditNoteNumber: cnNumber, entryNumber, appliedCents };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Credit note not found.",
        ALREADY_POSTED: "This credit note has already been posted.",
        EMPTY: "Credit note has no amount to post.",
        MISSING_INCOME_ACCOUNT: "A line is missing its income account. Check the item or default sales account.",
        NO_AR_ACCOUNT: "No Accounts Receivable account configured.",
        NUMBER_ALLOC_FAILED: "Couldn't allocate a credit note number.",
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
