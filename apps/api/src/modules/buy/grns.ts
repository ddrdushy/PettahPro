import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

const LineSchema = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantityOrdered: z.number().min(0).max(1_000_000).optional(),
  quantityReceived: z.number().positive().max(1_000_000),
  lineNotes: z.string().max(255).optional().or(z.literal("")),
});

const CreateSchema = z.object({
  supplierId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().optional(),
  billId: z.string().uuid().optional(),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  supplierDeliveryNote: z.string().max(64).optional().or(z.literal("")),
  conditionNotes: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  lines: z.array(LineSchema).min(1),
});

const CancelSchema = z.object({
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

export const grnsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /grns
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.grns.id,
          grnNumber: schema.grns.grnNumber,
          status: schema.grns.status,
          receiptDate: schema.grns.receiptDate,
          supplierId: schema.grns.supplierId,
          supplierName: schema.suppliers.name,
          purchaseOrderId: schema.grns.purchaseOrderId,
          billId: schema.grns.billId,
          supplierDeliveryNote: schema.grns.supplierDeliveryNote,
          createdAt: schema.grns.createdAt,
        })
        .from(schema.grns)
        .innerJoin(schema.suppliers, eq(schema.suppliers.id, schema.grns.supplierId))
        .where(
          and(
            eq(schema.grns.tenantId, ctx.tenantId),
            isNull(schema.grns.deletedAt),
          ),
        )
        .orderBy(desc(schema.grns.createdAt))
        .limit(200),
    );

    return reply.send({ grns: rows });
  });

  // GET /grns/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [grn] = await tx
        .select()
        .from(schema.grns)
        .where(
          and(
            eq(schema.grns.tenantId, ctx.tenantId),
            eq(schema.grns.id, req.params.id),
            isNull(schema.grns.deletedAt),
          ),
        )
        .limit(1);
      if (!grn) return null;

      const [supplier] = await tx
        .select()
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, grn.supplierId),
          ),
        )
        .limit(1);

      const lines = await tx
        .select()
        .from(schema.grnLines)
        .where(
          and(
            eq(schema.grnLines.tenantId, ctx.tenantId),
            eq(schema.grnLines.grnId, grn.id),
          ),
        )
        .orderBy(asc(schema.grnLines.lineNo));

      return { grn, lines, supplier: supplier ?? null };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /grns — create draft
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
    const receiptDate = body.receiptDate ?? new Date().toISOString().slice(0, 10);

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [supplier] = await tx
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
      if (!supplier) return { error: "SUPPLIER_NOT_FOUND" as const };

      if (body.purchaseOrderId) {
        const [po] = await tx
          .select()
          .from(schema.purchaseOrders)
          .where(
            and(
              eq(schema.purchaseOrders.tenantId, ctx.tenantId),
              eq(schema.purchaseOrders.id, body.purchaseOrderId),
              isNull(schema.purchaseOrders.deletedAt),
            ),
          )
          .limit(1);
        if (!po) return { error: "PO_NOT_FOUND" as const };
        if (po.supplierId !== body.supplierId) return { error: "PO_SUPPLIER_MISMATCH" as const };
      }
      if (body.billId) {
        const [bill] = await tx
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
        if (!bill) return { error: "BILL_NOT_FOUND" as const };
        if (bill.supplierId !== body.supplierId) return { error: "BILL_SUPPLIER_MISMATCH" as const };
      }

      const [grn] = await tx
        .insert(schema.grns)
        .values({
          tenantId: ctx.tenantId,
          supplierId: supplier.id,
          purchaseOrderId: body.purchaseOrderId ?? null,
          billId: body.billId ?? null,
          status: "draft",
          receiptDate,
          supplierDeliveryNote: body.supplierDeliveryNote?.trim() || null,
          conditionNotes: body.conditionNotes?.trim() || null,
          notes: body.notes?.trim() || null,
          receivedByUserId: ctx.userId,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!grn) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.grnLines).values(
        body.lines.map((l, idx) => ({
          tenantId: ctx.tenantId,
          grnId: grn.id,
          lineNo: (idx + 1) as number,
          itemId: l.itemId ?? null,
          description: l.description,
          quantityOrdered: l.quantityOrdered !== undefined ? String(l.quantityOrdered) : null,
          quantityReceived: String(l.quantityReceived),
          lineNotes: l.lineNotes?.trim() || null,
        })),
      );

      return { grn };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        SUPPLIER_NOT_FOUND: "Supplier not found.",
        PO_NOT_FOUND: "Purchase order not found.",
        PO_SUPPLIER_MISMATCH: "Purchase order belongs to a different supplier.",
        BILL_NOT_FOUND: "Bill not found.",
        BILL_SUPPLIER_MISMATCH: "Bill belongs to a different supplier.",
        INSERT_FAILED: "Couldn't create the GRN.",
      };
      const code = result.error as string;
      return reply
        .status(code === "INSERT_FAILED" ? 500 : 400)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.status(201).send({ grn: result.grn });
  });

  // POST /grns/:id/receive — allocate GRN number + flip to 'received'
  fastify.post<{ Params: { id: string } }>("/:id/receive", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [grn] = await tx
        .select()
        .from(schema.grns)
        .where(
          and(
            eq(schema.grns.tenantId, ctx.tenantId),
            eq(schema.grns.id, req.params.id),
            isNull(schema.grns.deletedAt),
          ),
        )
        .limit(1);
      if (!grn) return { error: "NOT_FOUND" as const };
      if (grn.status !== "draft") return { error: "NOT_DRAFT" as const };

      const numRows = (await tx.execute(
        sql`SELECT next_document_number('grn') AS number`,
      )) as unknown as Array<{ number: string }>;
      const grnNumber = numRows[0]?.number;
      if (!grnNumber) return { error: "NUMBER_ALLOC_FAILED" as const };

      const now = new Date();
      await tx
        .update(schema.grns)
        .set({
          status: "received",
          grnNumber,
          receivedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.grns.id, grn.id));

      return { grnNumber };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "GRN not found.",
        NOT_DRAFT: "Only draft GRNs can be marked received.",
        NUMBER_ALLOC_FAILED: "Couldn't allocate a GRN number.",
      };
      const code = result.error as string;
      return reply
        .status(code === "NOT_FOUND" ? 404 : 400)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true, ...result });
  });

  // POST /grns/:id/cancel
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
        const [grn] = await tx
          .select()
          .from(schema.grns)
          .where(
            and(
              eq(schema.grns.tenantId, ctx.tenantId),
              eq(schema.grns.id, req.params.id),
              isNull(schema.grns.deletedAt),
            ),
          )
          .limit(1);
        if (!grn) return { error: "NOT_FOUND" as const };
        if (grn.status === "cancelled") return { error: "ALREADY_CANCELLED" as const };

        const now = new Date();
        await tx
          .update(schema.grns)
          .set({
            status: "cancelled",
            cancelledAt: now,
            cancelledReason: reason,
            updatedAt: now,
          })
          .where(eq(schema.grns.id, grn.id));
        return {};
      });

      if ("error" in result) {
        const code = result.error as string;
        return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
      }
      return reply.send({ ok: true });
    },
  );
};
