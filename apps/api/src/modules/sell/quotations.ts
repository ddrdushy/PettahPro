import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

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

const RejectSchema = z.object({
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

// Mirrors computeInvoice — same math, different destination table.
async function computeQuotation(
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

export const quotationsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /quotations — list
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.quotations.id,
          quotationNumber: schema.quotations.quotationNumber,
          status: schema.quotations.status,
          issueDate: schema.quotations.issueDate,
          validUntil: schema.quotations.validUntil,
          customerId: schema.quotations.customerId,
          customerName: schema.customers.name,
          currency: schema.quotations.currency,
          totalCents: schema.quotations.totalCents,
          convertedInvoiceId: schema.quotations.convertedInvoiceId,
          createdAt: schema.quotations.createdAt,
        })
        .from(schema.quotations)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.quotations.customerId))
        .where(
          and(
            eq(schema.quotations.tenantId, ctx.tenantId),
            isNull(schema.quotations.deletedAt),
          ),
        )
        .orderBy(desc(schema.quotations.createdAt))
        .limit(200),
    );

    return reply.send({ quotations: rows });
  });

  // GET /quotations/:id — detail
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [q] = await tx
        .select()
        .from(schema.quotations)
        .where(
          and(
            eq(schema.quotations.tenantId, ctx.tenantId),
            eq(schema.quotations.id, req.params.id),
            isNull(schema.quotations.deletedAt),
          ),
        )
        .limit(1);
      if (!q) return null;

      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, q.customerId),
          ),
        )
        .limit(1);

      const lines = await tx
        .select()
        .from(schema.quotationLines)
        .where(
          and(
            eq(schema.quotationLines.tenantId, ctx.tenantId),
            eq(schema.quotationLines.quotationId, q.id),
          ),
        )
        .orderBy(asc(schema.quotationLines.lineNo));

      return { quotation: q, lines, customer: customer ?? null };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /quotations — create draft
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

      // Default validity: 30 days from issue. Common SL B2B practice.
      const validUntil =
        body.validUntil ??
        new Date(new Date(issueDate).getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

      const computed = await computeQuotation(
        tx,
        ctx.tenantId,
        body.lines as LineInput[],
      );

      const [q] = await tx
        .insert(schema.quotations)
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
      if (!q) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.quotationLines).values(
        computed.lines.map((l) => ({
          tenantId: ctx.tenantId,
          quotationId: q.id,
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

      return { quotation: q };
    });

    if ("error" in result) {
      const code = result.error as string;
      const status = code === "INSERT_FAILED" ? 500 : 400;
      return reply.status(status).send({ error: { code } });
    }
    return reply.status(201).send({ quotation: result.quotation });
  });

  // POST /quotations/:id/send — allocate number + flip to 'sent'
  fastify.post<{ Params: { id: string } }>("/:id/send", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [q] = await tx
        .select()
        .from(schema.quotations)
        .where(
          and(
            eq(schema.quotations.tenantId, ctx.tenantId),
            eq(schema.quotations.id, req.params.id),
            isNull(schema.quotations.deletedAt),
          ),
        )
        .limit(1);
      if (!q) return { error: "NOT_FOUND" as const };
      if (q.status !== "draft") return { error: "NOT_DRAFT" as const };

      const numRows = (await tx.execute(
        sql`SELECT next_document_number('quotation') AS number`,
      )) as unknown as Array<{ number: string }>;
      const quotationNumber = numRows[0]?.number;
      if (!quotationNumber) return { error: "NUMBER_ALLOC_FAILED" as const };

      const now = new Date();
      await tx
        .update(schema.quotations)
        .set({
          status: "sent",
          quotationNumber,
          sentAt: now,
          updatedAt: now,
        })
        .where(eq(schema.quotations.id, q.id));

      return { quotationNumber };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Quotation not found.",
        NOT_DRAFT: "Only draft quotations can be sent.",
        NUMBER_ALLOC_FAILED: "Couldn't allocate a quotation number.",
      };
      const code = result.error as string;
      const status = code === "NOT_FOUND" ? 404 : 400;
      return reply.status(status).send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true, ...result });
  });

  // POST /quotations/:id/accept — customer said yes
  fastify.post<{ Params: { id: string } }>("/:id/accept", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [q] = await tx
        .select()
        .from(schema.quotations)
        .where(
          and(
            eq(schema.quotations.tenantId, ctx.tenantId),
            eq(schema.quotations.id, req.params.id),
            isNull(schema.quotations.deletedAt),
          ),
        )
        .limit(1);
      if (!q) return { error: "NOT_FOUND" as const };
      if (q.status !== "sent" && q.status !== "draft") {
        return { error: "WRONG_STATUS" as const };
      }

      const now = new Date();
      await tx
        .update(schema.quotations)
        .set({ status: "accepted", acceptedAt: now, updatedAt: now })
        .where(eq(schema.quotations.id, q.id));
      return {};
    });

    if ("error" in result) {
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
    }
    return reply.send({ ok: true });
  });

  // POST /quotations/:id/reject
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/:id/reject",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const parsed = RejectSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }
      const reason = parsed.data.reason?.trim() || null;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [q] = await tx
          .select()
          .from(schema.quotations)
          .where(
            and(
              eq(schema.quotations.tenantId, ctx.tenantId),
              eq(schema.quotations.id, req.params.id),
              isNull(schema.quotations.deletedAt),
            ),
          )
          .limit(1);
        if (!q) return { error: "NOT_FOUND" as const };
        if (q.status === "converted") return { error: "ALREADY_CONVERTED" as const };

        const now = new Date();
        await tx
          .update(schema.quotations)
          .set({ status: "rejected", rejectedAt: now, rejectedReason: reason, updatedAt: now })
          .where(eq(schema.quotations.id, q.id));
        return {};
      });

      if ("error" in result) {
        const code = result.error as string;
        return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
      }
      return reply.send({ ok: true });
    },
  );

  // POST /quotations/:id/convert — create a draft invoice from the quotation
  // and link both ways. Doesn't post the invoice — caller still does that
  // from the invoice detail page.
  fastify.post<{ Params: { id: string } }>("/:id/convert", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [q] = await tx
        .select()
        .from(schema.quotations)
        .where(
          and(
            eq(schema.quotations.tenantId, ctx.tenantId),
            eq(schema.quotations.id, req.params.id),
            isNull(schema.quotations.deletedAt),
          ),
        )
        .limit(1);
      if (!q) return { error: "NOT_FOUND" as const };
      if (q.status === "converted") return { error: "ALREADY_CONVERTED" as const };
      if (q.status === "rejected") return { error: "REJECTED" as const };

      const qLines = await tx
        .select()
        .from(schema.quotationLines)
        .where(eq(schema.quotationLines.quotationId, q.id))
        .orderBy(asc(schema.quotationLines.lineNo));
      if (qLines.length === 0) return { error: "EMPTY" as const };

      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, q.customerId),
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
          customerId: q.customerId,
          branchId: q.branchId,
          status: "draft",
          issueDate: today,
          dueDate,
          currency: q.currency,
          subtotalCents: q.subtotalCents,
          discountCents: q.discountCents,
          taxCents: q.taxCents,
          totalCents: q.totalCents,
          balanceDueCents: q.totalCents,
          reference: q.reference,
          notes: q.notes,
          terms: q.terms,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!inv) return { error: "INVOICE_INSERT_FAILED" as const };

      await tx.insert(schema.invoiceLines).values(
        qLines.map((l) => ({
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
        .update(schema.quotations)
        .set({
          status: "converted",
          convertedInvoiceId: inv.id,
          convertedAt: now,
          acceptedAt: q.acceptedAt ?? now,
          updatedAt: now,
        })
        .where(eq(schema.quotations.id, q.id));

      return { invoiceId: inv.id };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Quotation not found.",
        ALREADY_CONVERTED: "This quotation has already been converted.",
        REJECTED: "Rejected quotations can't be converted.",
        EMPTY: "Quotation has no lines.",
        CUSTOMER_NOT_FOUND: "Customer was deleted.",
        INVOICE_INSERT_FAILED: "Couldn't create the invoice.",
      };
      const code = result.error as string;
      const status = code === "NOT_FOUND" ? 404 : 400;
      return reply.status(status).send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true, ...result });
  });
};
