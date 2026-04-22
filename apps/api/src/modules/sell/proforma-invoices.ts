import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// -----------------------------------------------------------------------------
// Proforma invoices — pre-sale invoice-shaped documents. See 47-proforma-invoices.sql
// for the "why proforma, not quotation" rationale. Lifecycle:
//   draft → sent → converted | cancelled
// No GL impact at any stage. Conversion creates a draft invoice and links the
// two, same pattern as quotation → invoice in quotations.ts.
// -----------------------------------------------------------------------------

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
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference: z.string().max(64).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  terms: z.string().optional().or(z.literal("")),
  lines: z.array(LineSchema).min(1),
});

const CancelSchema = z.object({
  reason: z.string().trim().max(500).optional().or(z.literal("")),
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
}

interface LineInput {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
}

// Mirrors computeQuotation / computeInvoice. Pulled tax rates + income-account
// fallback so proforma totals match what the converted invoice will show.
async function computeProforma(
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
    };
  });

  const subtotalCents = lines.reduce((s, l) => s + l.lineSubtotalCents, 0);
  const discountCents = lines.reduce((s, l) => s + l.discountCents, 0);
  const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);
  const totalCents = subtotalCents - discountCents + taxCents;

  return { lines, subtotalCents, discountCents, taxCents, totalCents };
}

export const proformaInvoicesRoutes: FastifyPluginAsync = async (fastify) => {
  // List
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.proformaInvoices.id,
          proformaNumber: schema.proformaInvoices.proformaNumber,
          status: schema.proformaInvoices.status,
          issueDate: schema.proformaInvoices.issueDate,
          validUntil: schema.proformaInvoices.validUntil,
          customerId: schema.proformaInvoices.customerId,
          customerName: schema.customers.name,
          currency: schema.proformaInvoices.currency,
          totalCents: schema.proformaInvoices.totalCents,
          convertedInvoiceId: schema.proformaInvoices.convertedInvoiceId,
          createdAt: schema.proformaInvoices.createdAt,
        })
        .from(schema.proformaInvoices)
        .innerJoin(
          schema.customers,
          eq(schema.customers.id, schema.proformaInvoices.customerId),
        )
        .where(
          and(
            eq(schema.proformaInvoices.tenantId, ctx.tenantId),
            isNull(schema.proformaInvoices.deletedAt),
          ),
        )
        .orderBy(desc(schema.proformaInvoices.createdAt))
        .limit(200),
    );

    return reply.send({ proformaInvoices: rows });
  });

  // Detail
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [p] = await tx
        .select()
        .from(schema.proformaInvoices)
        .where(
          and(
            eq(schema.proformaInvoices.tenantId, ctx.tenantId),
            eq(schema.proformaInvoices.id, req.params.id),
            isNull(schema.proformaInvoices.deletedAt),
          ),
        )
        .limit(1);
      if (!p) return null;

      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, p.customerId),
          ),
        )
        .limit(1);

      const lines = await tx
        .select()
        .from(schema.proformaInvoiceLines)
        .where(
          and(
            eq(schema.proformaInvoiceLines.tenantId, ctx.tenantId),
            eq(schema.proformaInvoiceLines.proformaInvoiceId, p.id),
          ),
        )
        .orderBy(asc(schema.proformaInvoiceLines.lineNo));

      return { proformaInvoice: p, lines, customer: customer ?? null };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // Create (draft)
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
      const customer = custRows[0];
      if (!customer) return { error: "CUSTOMER_NOT_FOUND" as const };

      // Default validity: 30 days from issue — proformas are typically
      // tied to deal windows (customs, LC, advance payment deadlines).
      const validUntil =
        body.validUntil ??
        new Date(new Date(issueDate).getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

      const computed = await computeProforma(tx, ctx.tenantId, body.lines as LineInput[]);

      const [p] = await tx
        .insert(schema.proformaInvoices)
        .values({
          tenantId: ctx.tenantId,
          customerId: customer.id,
          status: "draft",
          issueDate,
          validUntil,
          currency: customer.currency ?? "LKR",
          subtotalCents: computed.subtotalCents,
          discountCents: computed.discountCents,
          taxCents: computed.taxCents,
          totalCents: computed.totalCents,
          reference: body.reference && body.reference.trim() ? body.reference.trim() : null,
          notes: body.notes && body.notes.trim() ? body.notes.trim() : null,
          terms: body.terms && body.terms.trim() ? body.terms.trim() : null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!p) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.proformaInvoiceLines).values(
        computed.lines.map((l) => ({
          tenantId: ctx.tenantId,
          proformaInvoiceId: p.id,
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

      return { proformaInvoice: p };
    });

    if ("error" in result) {
      const code = result.error as string;
      const status = code === "INSERT_FAILED" ? 500 : 400;
      return reply.status(status).send({ error: { code } });
    }
    return reply.status(201).send({ proformaInvoice: result.proformaInvoice });
  });

  // Send — allocates the proforma number and stamps status to 'sent'.
  // Same pattern as invoice.post / quotation.send: no number in draft state
  // so tenants can freely delete drafts without burning sequence numbers.
  fastify.post<{ Params: { id: string } }>("/:id/send", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [p] = await tx
        .select()
        .from(schema.proformaInvoices)
        .where(
          and(
            eq(schema.proformaInvoices.tenantId, ctx.tenantId),
            eq(schema.proformaInvoices.id, req.params.id),
            isNull(schema.proformaInvoices.deletedAt),
          ),
        )
        .limit(1);
      if (!p) return { error: "NOT_FOUND" as const };
      if (p.status !== "draft") return { error: "NOT_DRAFT" as const };

      const numRows = (await tx.execute(
        sql`SELECT next_document_number('proforma_invoice') AS number`,
      )) as unknown as Array<{ number: string }>;
      const proformaNumber = numRows[0]?.number;
      if (!proformaNumber) return { error: "NUMBER_ALLOC_FAILED" as const };

      const now = new Date();
      await tx
        .update(schema.proformaInvoices)
        .set({
          status: "sent",
          proformaNumber,
          sentAt: now,
          updatedAt: now,
        })
        .where(eq(schema.proformaInvoices.id, p.id));

      return { proformaNumber };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Proforma not found.",
        NOT_DRAFT: "Only draft proformas can be sent.",
        NUMBER_ALLOC_FAILED: "Couldn't allocate a proforma number.",
      };
      const code = result.error as string;
      const status = code === "NOT_FOUND" ? 404 : 400;
      return reply
        .status(status)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true, ...result });
  });

  // Cancel — customer walked away, deal died. Soft state, keeps the record
  // and its number so audit can see "this proforma existed but went nowhere".
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/:id/cancel",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const parsed = CancelSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }
      const reason = parsed.data.reason?.trim() || null;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [p] = await tx
          .select()
          .from(schema.proformaInvoices)
          .where(
            and(
              eq(schema.proformaInvoices.tenantId, ctx.tenantId),
              eq(schema.proformaInvoices.id, req.params.id),
              isNull(schema.proformaInvoices.deletedAt),
            ),
          )
          .limit(1);
        if (!p) return { error: "NOT_FOUND" as const };
        if (p.status === "converted") return { error: "ALREADY_CONVERTED" as const };
        if (p.status === "cancelled") return { error: "ALREADY_CANCELLED" as const };

        const now = new Date();
        await tx
          .update(schema.proformaInvoices)
          .set({
            status: "cancelled",
            cancelledAt: now,
            cancelledReason: reason,
            updatedAt: now,
          })
          .where(eq(schema.proformaInvoices.id, p.id));
        return {};
      });

      if ("error" in result) {
        const code = result.error as string;
        return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
      }
      return reply.send({ ok: true });
    },
  );

  // Convert — creates a draft invoice mirroring the proforma lines and links
  // them. The invoice still has to be posted manually from the invoice screen;
  // posting from here would mean bypassing the usual period / approval checks.
  fastify.post<{ Params: { id: string } }>("/:id/convert", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [p] = await tx
        .select()
        .from(schema.proformaInvoices)
        .where(
          and(
            eq(schema.proformaInvoices.tenantId, ctx.tenantId),
            eq(schema.proformaInvoices.id, req.params.id),
            isNull(schema.proformaInvoices.deletedAt),
          ),
        )
        .limit(1);
      if (!p) return { error: "NOT_FOUND" as const };
      if (p.status === "converted") return { error: "ALREADY_CONVERTED" as const };
      if (p.status === "cancelled") return { error: "CANCELLED" as const };

      const pLines = await tx
        .select()
        .from(schema.proformaInvoiceLines)
        .where(eq(schema.proformaInvoiceLines.proformaInvoiceId, p.id))
        .orderBy(asc(schema.proformaInvoiceLines.lineNo));
      if (pLines.length === 0) return { error: "EMPTY" as const };

      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, p.customerId),
          ),
        )
        .limit(1);
      if (!customer) return { error: "CUSTOMER_NOT_FOUND" as const };

      const today = new Date().toISOString().slice(0, 10);
      const dueDate = new Date(
        new Date(today).getTime() + customer.paymentTermsDays * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);

      const [inv] = await tx
        .insert(schema.invoices)
        .values({
          tenantId: ctx.tenantId,
          customerId: p.customerId,
          branchId: p.branchId,
          status: "draft",
          issueDate: today,
          dueDate,
          currency: p.currency,
          subtotalCents: p.subtotalCents,
          discountCents: p.discountCents,
          taxCents: p.taxCents,
          totalCents: p.totalCents,
          balanceDueCents: p.totalCents,
          reference: p.reference,
          notes: p.notes
            ? `${p.notes}\n\n(Converted from proforma ${p.proformaNumber ?? "(unsent)"})`
            : `(Converted from proforma ${p.proformaNumber ?? "(unsent)"})`,
          terms: p.terms,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!inv) return { error: "INVOICE_INSERT_FAILED" as const };

      await tx.insert(schema.invoiceLines).values(
        pLines.map((l) => ({
          tenantId: ctx.tenantId,
          invoiceId: inv.id,
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
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

      const now = new Date();
      await tx
        .update(schema.proformaInvoices)
        .set({
          status: "converted",
          convertedInvoiceId: inv.id,
          convertedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.proformaInvoices.id, p.id));

      return { invoiceId: inv.id };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Proforma not found.",
        ALREADY_CONVERTED: "This proforma has already been converted.",
        CANCELLED: "Cancelled proformas can't be converted.",
        EMPTY: "Proforma has no lines.",
        CUSTOMER_NOT_FOUND: "Customer was deleted.",
        INVOICE_INSERT_FAILED: "Couldn't create the invoice.",
      };
      const code = result.error as string;
      const status = code === "NOT_FOUND" ? 404 : 400;
      return reply
        .status(status)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true, ...result });
  });

  // Soft delete — only for drafts. Sent/converted proformas keep audit trail.
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [p] = await tx
        .select()
        .from(schema.proformaInvoices)
        .where(
          and(
            eq(schema.proformaInvoices.tenantId, ctx.tenantId),
            eq(schema.proformaInvoices.id, req.params.id),
            isNull(schema.proformaInvoices.deletedAt),
          ),
        )
        .limit(1);
      if (!p) return { error: "NOT_FOUND" as const };
      if (p.status !== "draft") return { error: "NOT_DRAFT" as const };

      await tx
        .update(schema.proformaInvoices)
        .set({ deletedAt: new Date() })
        .where(eq(schema.proformaInvoices.id, p.id));
      return {};
    });

    if ("error" in result) {
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
    }
    return reply.send({ ok: true });
  });
};
