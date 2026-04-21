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
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expectedShipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference: z.string().max(64).optional().or(z.literal("")),
  customerPoNumber: z.string().max(64).optional().or(z.literal("")),
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

async function computeSO(
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

export const salesOrdersRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /sales-orders — list
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.salesOrders.id,
          soNumber: schema.salesOrders.soNumber,
          status: schema.salesOrders.status,
          orderDate: schema.salesOrders.orderDate,
          expectedShipDate: schema.salesOrders.expectedShipDate,
          customerId: schema.salesOrders.customerId,
          customerName: schema.customers.name,
          currency: schema.salesOrders.currency,
          totalCents: schema.salesOrders.totalCents,
          convertedInvoiceId: schema.salesOrders.convertedInvoiceId,
          createdAt: schema.salesOrders.createdAt,
        })
        .from(schema.salesOrders)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.salesOrders.customerId))
        .where(
          and(
            eq(schema.salesOrders.tenantId, ctx.tenantId),
            isNull(schema.salesOrders.deletedAt),
          ),
        )
        .orderBy(desc(schema.salesOrders.createdAt))
        .limit(200),
    );

    return reply.send({ salesOrders: rows });
  });

  // GET /sales-orders/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [so] = await tx
        .select()
        .from(schema.salesOrders)
        .where(
          and(
            eq(schema.salesOrders.tenantId, ctx.tenantId),
            eq(schema.salesOrders.id, req.params.id),
            isNull(schema.salesOrders.deletedAt),
          ),
        )
        .limit(1);
      if (!so) return null;

      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, so.customerId),
          ),
        )
        .limit(1);

      const lines = await tx
        .select()
        .from(schema.salesOrderLines)
        .where(
          and(
            eq(schema.salesOrderLines.tenantId, ctx.tenantId),
            eq(schema.salesOrderLines.salesOrderId, so.id),
          ),
        )
        .orderBy(asc(schema.salesOrderLines.lineNo));

      return { salesOrder: so, lines, customer: customer ?? null };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /sales-orders — create draft
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
    const orderDate = body.orderDate ?? new Date().toISOString().slice(0, 10);

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

      const computed = await computeSO(tx, ctx.tenantId, body.lines as LineInput[]);

      const [so] = await tx
        .insert(schema.salesOrders)
        .values({
          tenantId: ctx.tenantId,
          customerId: customer.id,
          status: "draft",
          orderDate,
          expectedShipDate: body.expectedShipDate ?? null,
          currency: customer.currency ?? "LKR",
          subtotalCents: computed.subtotalCents,
          discountCents: computed.discountCents,
          taxCents: computed.taxCents,
          totalCents: computed.totalCents,
          reference: body.reference && body.reference.trim() ? body.reference.trim() : null,
          customerPoNumber:
            body.customerPoNumber && body.customerPoNumber.trim()
              ? body.customerPoNumber.trim()
              : null,
          notes: body.notes && body.notes.trim() ? body.notes.trim() : null,
          terms: body.terms && body.terms.trim() ? body.terms.trim() : null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!so) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.salesOrderLines).values(
        computed.lines.map((l) => ({
          tenantId: ctx.tenantId,
          salesOrderId: so.id,
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

      return { salesOrder: so };
    });

    if ("error" in result) {
      const code = result.error as string;
      return reply.status(code === "INSERT_FAILED" ? 500 : 400).send({ error: { code } });
    }
    return reply.status(201).send({ salesOrder: result.salesOrder });
  });

  // POST /sales-orders/:id/confirm — allocate number + flip to 'confirmed'
  fastify.post<{ Params: { id: string } }>("/:id/confirm", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [so] = await tx
        .select()
        .from(schema.salesOrders)
        .where(
          and(
            eq(schema.salesOrders.tenantId, ctx.tenantId),
            eq(schema.salesOrders.id, req.params.id),
            isNull(schema.salesOrders.deletedAt),
          ),
        )
        .limit(1);
      if (!so) return { error: "NOT_FOUND" as const };
      if (so.status !== "draft") return { error: "NOT_DRAFT" as const };

      const numRows = (await tx.execute(
        sql`SELECT next_document_number('sales_order') AS number`,
      )) as unknown as Array<{ number: string }>;
      const soNumber = numRows[0]?.number;
      if (!soNumber) return { error: "NUMBER_ALLOC_FAILED" as const };

      const now = new Date();
      await tx
        .update(schema.salesOrders)
        .set({ status: "confirmed", soNumber, confirmedAt: now, updatedAt: now })
        .where(eq(schema.salesOrders.id, so.id));

      return { soNumber };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Sales order not found.",
        NOT_DRAFT: "Only draft sales orders can be confirmed.",
        NUMBER_ALLOC_FAILED: "Couldn't allocate an SO number.",
      };
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true, ...result });
  });

  // POST /sales-orders/:id/cancel
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
        const [so] = await tx
          .select()
          .from(schema.salesOrders)
          .where(
            and(
              eq(schema.salesOrders.tenantId, ctx.tenantId),
              eq(schema.salesOrders.id, req.params.id),
              isNull(schema.salesOrders.deletedAt),
            ),
          )
          .limit(1);
        if (!so) return { error: "NOT_FOUND" as const };
        if (so.status === "converted") return { error: "ALREADY_CONVERTED" as const };

        const now = new Date();
        await tx
          .update(schema.salesOrders)
          .set({
            status: "cancelled",
            cancelledAt: now,
            cancelledReason: reason,
            updatedAt: now,
          })
          .where(eq(schema.salesOrders.id, so.id));
        return {};
      });

      if ("error" in result) {
        const code = result.error as string;
        return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
      }
      return reply.send({ ok: true });
    },
  );

  // POST /sales-orders/:id/convert — create a draft invoice from the SO
  fastify.post<{ Params: { id: string } }>("/:id/convert", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [so] = await tx
        .select()
        .from(schema.salesOrders)
        .where(
          and(
            eq(schema.salesOrders.tenantId, ctx.tenantId),
            eq(schema.salesOrders.id, req.params.id),
            isNull(schema.salesOrders.deletedAt),
          ),
        )
        .limit(1);
      if (!so) return { error: "NOT_FOUND" as const };
      if (so.status === "converted") return { error: "ALREADY_CONVERTED" as const };
      if (so.status === "cancelled") return { error: "CANCELLED" as const };

      const soLines = await tx
        .select()
        .from(schema.salesOrderLines)
        .where(eq(schema.salesOrderLines.salesOrderId, so.id))
        .orderBy(asc(schema.salesOrderLines.lineNo));
      if (soLines.length === 0) return { error: "EMPTY" as const };

      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, so.customerId),
          ),
        )
        .limit(1);
      if (!customer) return { error: "CUSTOMER_NOT_FOUND" as const };

      const today = new Date().toISOString().slice(0, 10);
      const dueDate = new Date(
        new Date(today).getTime() + (customer.paymentTermsDays ?? 0) * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);

      const [inv] = await tx
        .insert(schema.invoices)
        .values({
          tenantId: ctx.tenantId,
          customerId: so.customerId,
          branchId: so.branchId,
          status: "draft",
          issueDate: today,
          dueDate,
          currency: so.currency,
          subtotalCents: so.subtotalCents,
          discountCents: so.discountCents,
          taxCents: so.taxCents,
          totalCents: so.totalCents,
          balanceDueCents: so.totalCents,
          reference: so.reference,
          poNumber: so.customerPoNumber,
          notes: so.notes,
          terms: so.terms,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!inv) return { error: "INVOICE_INSERT_FAILED" as const };

      await tx.insert(schema.invoiceLines).values(
        soLines.map((l) => ({
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
        .update(schema.salesOrders)
        .set({
          status: "converted",
          convertedInvoiceId: inv.id,
          convertedAt: now,
          confirmedAt: so.confirmedAt ?? now,
          updatedAt: now,
        })
        .where(eq(schema.salesOrders.id, so.id));

      return { invoiceId: inv.id };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Sales order not found.",
        ALREADY_CONVERTED: "This sales order has already been converted.",
        CANCELLED: "Cancelled sales orders can't be converted.",
        EMPTY: "Sales order has no lines.",
        CUSTOMER_NOT_FOUND: "Customer was deleted.",
        INVOICE_INSERT_FAILED: "Couldn't create the invoice.",
      };
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true, ...result });
  });
};
