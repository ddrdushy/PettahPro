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
  expenseAccountId: z.string().uuid().optional(),
});

const CreateSchema = z.object({
  supplierId: z.string().uuid(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expectedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference: z.string().max(64).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  terms: z.string().optional().or(z.literal("")),
  lines: z.array(LineSchema).min(1),
});

const AckSchema = z.object({
  supplierReference: z.string().trim().max(64).optional().or(z.literal("")),
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
  expenseAccountId: string | null;
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

// Mirror of the bill compute pipeline — same math, different destination table.
async function computePO(
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
    };
  });

  const subtotalCents = lines.reduce((s, l) => s + l.lineSubtotalCents, 0);
  const discountCents = lines.reduce((s, l) => s + l.discountCents, 0);
  const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);
  const totalCents = subtotalCents - discountCents + taxCents;

  return { lines, subtotalCents, discountCents, taxCents, totalCents };
}

export const purchaseOrdersRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /purchase-orders — list
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.purchaseOrders.id,
          poNumber: schema.purchaseOrders.poNumber,
          status: schema.purchaseOrders.status,
          orderDate: schema.purchaseOrders.orderDate,
          expectedDeliveryDate: schema.purchaseOrders.expectedDeliveryDate,
          supplierId: schema.purchaseOrders.supplierId,
          supplierName: schema.suppliers.name,
          currency: schema.purchaseOrders.currency,
          totalCents: schema.purchaseOrders.totalCents,
          convertedBillId: schema.purchaseOrders.convertedBillId,
          createdAt: schema.purchaseOrders.createdAt,
        })
        .from(schema.purchaseOrders)
        .innerJoin(schema.suppliers, eq(schema.suppliers.id, schema.purchaseOrders.supplierId))
        .where(
          and(
            eq(schema.purchaseOrders.tenantId, ctx.tenantId),
            isNull(schema.purchaseOrders.deletedAt),
          ),
        )
        .orderBy(desc(schema.purchaseOrders.createdAt))
        .limit(200),
    );

    return reply.send({ purchaseOrders: rows });
  });

  // GET /purchase-orders/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [po] = await tx
        .select()
        .from(schema.purchaseOrders)
        .where(
          and(
            eq(schema.purchaseOrders.tenantId, ctx.tenantId),
            eq(schema.purchaseOrders.id, req.params.id),
            isNull(schema.purchaseOrders.deletedAt),
          ),
        )
        .limit(1);
      if (!po) return null;

      const [supplier] = await tx
        .select()
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, po.supplierId),
          ),
        )
        .limit(1);

      const lines = await tx
        .select()
        .from(schema.purchaseOrderLines)
        .where(
          and(
            eq(schema.purchaseOrderLines.tenantId, ctx.tenantId),
            eq(schema.purchaseOrderLines.purchaseOrderId, po.id),
          ),
        )
        .orderBy(asc(schema.purchaseOrderLines.lineNo));

      return { purchaseOrder: po, lines, supplier: supplier ?? null };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /purchase-orders — create draft
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
      const supplier = supRows[0];
      if (!supplier) return { error: "SUPPLIER_NOT_FOUND" as const };

      const computed = await computePO(tx, ctx.tenantId, body.lines as LineInput[]);

      const [po] = await tx
        .insert(schema.purchaseOrders)
        .values({
          tenantId: ctx.tenantId,
          supplierId: supplier.id,
          status: "draft",
          orderDate,
          expectedDeliveryDate: body.expectedDeliveryDate ?? null,
          currency: supplier.currency ?? "LKR",
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
      if (!po) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.purchaseOrderLines).values(
        computed.lines.map((l) => ({
          tenantId: ctx.tenantId,
          purchaseOrderId: po.id,
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

      return { purchaseOrder: po };
    });

    if ("error" in result) {
      const code = result.error as string;
      return reply.status(code === "INSERT_FAILED" ? 500 : 400).send({ error: { code } });
    }
    return reply.status(201).send({ purchaseOrder: result.purchaseOrder });
  });

  // POST /purchase-orders/:id/send — allocate number + flip to 'sent'
  fastify.post<{ Params: { id: string } }>("/:id/send", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [po] = await tx
        .select()
        .from(schema.purchaseOrders)
        .where(
          and(
            eq(schema.purchaseOrders.tenantId, ctx.tenantId),
            eq(schema.purchaseOrders.id, req.params.id),
            isNull(schema.purchaseOrders.deletedAt),
          ),
        )
        .limit(1);
      if (!po) return { error: "NOT_FOUND" as const };
      if (po.status !== "draft") return { error: "NOT_DRAFT" as const };

      const numRows = (await tx.execute(
        sql`SELECT next_document_number('purchase_order') AS number`,
      )) as unknown as Array<{ number: string }>;
      const poNumber = numRows[0]?.number;
      if (!poNumber) return { error: "NUMBER_ALLOC_FAILED" as const };

      const now = new Date();
      await tx
        .update(schema.purchaseOrders)
        .set({ status: "sent", poNumber, sentAt: now, updatedAt: now })
        .where(eq(schema.purchaseOrders.id, po.id));

      return { poNumber };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Purchase order not found.",
        NOT_DRAFT: "Only draft purchase orders can be sent.",
        NUMBER_ALLOC_FAILED: "Couldn't allocate a PO number.",
      };
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true, ...result });
  });

  // POST /purchase-orders/:id/acknowledge — supplier confirmed receipt
  fastify.post<{ Params: { id: string }; Body: { supplierReference?: string } }>(
    "/:id/acknowledge",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const parsed = AckSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }
      const supplierReference = parsed.data.supplierReference?.trim() || null;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [po] = await tx
          .select()
          .from(schema.purchaseOrders)
          .where(
            and(
              eq(schema.purchaseOrders.tenantId, ctx.tenantId),
              eq(schema.purchaseOrders.id, req.params.id),
              isNull(schema.purchaseOrders.deletedAt),
            ),
          )
          .limit(1);
        if (!po) return { error: "NOT_FOUND" as const };
        if (po.status !== "sent" && po.status !== "draft") {
          return { error: "WRONG_STATUS" as const };
        }

        const now = new Date();
        await tx
          .update(schema.purchaseOrders)
          .set({
            status: "acknowledged",
            supplierReference,
            acknowledgedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.purchaseOrders.id, po.id));
        return {};
      });

      if ("error" in result) {
        const code = result.error as string;
        return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
      }
      return reply.send({ ok: true });
    },
  );

  // POST /purchase-orders/:id/cancel
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
        const [po] = await tx
          .select()
          .from(schema.purchaseOrders)
          .where(
            and(
              eq(schema.purchaseOrders.tenantId, ctx.tenantId),
              eq(schema.purchaseOrders.id, req.params.id),
              isNull(schema.purchaseOrders.deletedAt),
            ),
          )
          .limit(1);
        if (!po) return { error: "NOT_FOUND" as const };
        if (po.status === "converted") return { error: "ALREADY_CONVERTED" as const };

        const now = new Date();
        await tx
          .update(schema.purchaseOrders)
          .set({
            status: "cancelled",
            cancelledAt: now,
            cancelledReason: reason,
            updatedAt: now,
          })
          .where(eq(schema.purchaseOrders.id, po.id));
        return {};
      });

      if ("error" in result) {
        const code = result.error as string;
        return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
      }
      return reply.send({ ok: true });
    },
  );

  // POST /purchase-orders/:id/convert — create a draft bill from the PO
  fastify.post<{ Params: { id: string } }>("/:id/convert", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [po] = await tx
        .select()
        .from(schema.purchaseOrders)
        .where(
          and(
            eq(schema.purchaseOrders.tenantId, ctx.tenantId),
            eq(schema.purchaseOrders.id, req.params.id),
            isNull(schema.purchaseOrders.deletedAt),
          ),
        )
        .limit(1);
      if (!po) return { error: "NOT_FOUND" as const };
      if (po.status === "converted") return { error: "ALREADY_CONVERTED" as const };
      if (po.status === "cancelled") return { error: "CANCELLED" as const };

      const poLines = await tx
        .select()
        .from(schema.purchaseOrderLines)
        .where(eq(schema.purchaseOrderLines.purchaseOrderId, po.id))
        .orderBy(asc(schema.purchaseOrderLines.lineNo));
      if (poLines.length === 0) return { error: "EMPTY" as const };

      const [supplier] = await tx
        .select()
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, po.supplierId),
          ),
        )
        .limit(1);
      if (!supplier) return { error: "SUPPLIER_NOT_FOUND" as const };

      const today = new Date().toISOString().slice(0, 10);
      const dueDate = new Date(
        new Date(today).getTime() + (supplier.paymentTermsDays ?? 0) * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);

      const [bill] = await tx
        .insert(schema.bills)
        .values({
          tenantId: ctx.tenantId,
          supplierId: po.supplierId,
          branchId: po.branchId,
          status: "draft",
          billDate: today,
          dueDate,
          currency: po.currency,
          subtotalCents: po.subtotalCents,
          discountCents: po.discountCents,
          taxCents: po.taxCents,
          totalCents: po.totalCents,
          balanceDueCents: po.totalCents,
          notes: po.notes,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!bill) return { error: "BILL_INSERT_FAILED" as const };

      await tx.insert(schema.billLines).values(
        poLines.map((l) => ({
          tenantId: ctx.tenantId,
          billId: bill.id,
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
          expenseAccountId: l.expenseAccountId,
        })),
      );

      const now = new Date();
      await tx
        .update(schema.purchaseOrders)
        .set({
          status: "converted",
          convertedBillId: bill.id,
          convertedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.purchaseOrders.id, po.id));

      return { billId: bill.id };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Purchase order not found.",
        ALREADY_CONVERTED: "This purchase order has already been converted.",
        CANCELLED: "Cancelled purchase orders can't be converted.",
        EMPTY: "Purchase order has no lines.",
        SUPPLIER_NOT_FOUND: "Supplier was deleted.",
        BILL_INSERT_FAILED: "Couldn't create the bill.",
      };
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true, ...result });
  });
};
