import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "../accounting/journal-posting.js";
import {
  applyStockIssue,
  peekStockIssue,
  resolveDefaultWarehouse,
  resolveStockGLAccounts,
} from "../inventory/stock-posting.js";
import { loadTenantSettings } from "../settings/routes.js";

const LineSchema = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
});

const CreateSchema = z.object({
  customerId: z.string().uuid(),
  salesOrderId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  shippingAddressLine1: z.string().max(255).optional().or(z.literal("")),
  shippingAddressLine2: z.string().max(255).optional().or(z.literal("")),
  shippingCity: z.string().max(128).optional().or(z.literal("")),
  shippingPostalCode: z.string().max(16).optional().or(z.literal("")),
  carrier: z.string().max(128).optional().or(z.literal("")),
  trackingNumber: z.string().max(64).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  lines: z.array(LineSchema).min(1),
});

const DeliverSchema = z.object({
  receivedByName: z.string().trim().max(128).optional().or(z.literal("")),
});

const CancelSchema = z.object({
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

export const deliveryNotesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /delivery-notes
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.deliveryNotes.id,
          dnNumber: schema.deliveryNotes.dnNumber,
          status: schema.deliveryNotes.status,
          deliveryDate: schema.deliveryNotes.deliveryDate,
          customerId: schema.deliveryNotes.customerId,
          customerName: schema.customers.name,
          salesOrderId: schema.deliveryNotes.salesOrderId,
          invoiceId: schema.deliveryNotes.invoiceId,
          carrier: schema.deliveryNotes.carrier,
          trackingNumber: schema.deliveryNotes.trackingNumber,
          createdAt: schema.deliveryNotes.createdAt,
        })
        .from(schema.deliveryNotes)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.deliveryNotes.customerId))
        .where(
          and(
            eq(schema.deliveryNotes.tenantId, ctx.tenantId),
            isNull(schema.deliveryNotes.deletedAt),
          ),
        )
        .orderBy(desc(schema.deliveryNotes.createdAt))
        .limit(200),
    );

    return reply.send({ deliveryNotes: rows });
  });

  // GET /delivery-notes/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [dn] = await tx
        .select()
        .from(schema.deliveryNotes)
        .where(
          and(
            eq(schema.deliveryNotes.tenantId, ctx.tenantId),
            eq(schema.deliveryNotes.id, req.params.id),
            isNull(schema.deliveryNotes.deletedAt),
          ),
        )
        .limit(1);
      if (!dn) return null;

      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, dn.customerId),
          ),
        )
        .limit(1);

      const lines = await tx
        .select()
        .from(schema.deliveryNoteLines)
        .where(
          and(
            eq(schema.deliveryNoteLines.tenantId, ctx.tenantId),
            eq(schema.deliveryNoteLines.deliveryNoteId, dn.id),
          ),
        )
        .orderBy(asc(schema.deliveryNoteLines.lineNo));

      return { deliveryNote: dn, lines, customer: customer ?? null };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /delivery-notes — create draft
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
    const deliveryDate = body.deliveryDate ?? new Date().toISOString().slice(0, 10);

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Customer must exist
      const [customer] = await tx
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
      if (!customer) return { error: "CUSTOMER_NOT_FOUND" as const };

      // If linked, verify the SO / invoice matches the customer
      if (body.salesOrderId) {
        const [so] = await tx
          .select()
          .from(schema.salesOrders)
          .where(
            and(
              eq(schema.salesOrders.tenantId, ctx.tenantId),
              eq(schema.salesOrders.id, body.salesOrderId),
              isNull(schema.salesOrders.deletedAt),
            ),
          )
          .limit(1);
        if (!so) return { error: "SALES_ORDER_NOT_FOUND" as const };
        if (so.customerId !== body.customerId) return { error: "SO_CUSTOMER_MISMATCH" as const };
      }
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
        if (inv.customerId !== body.customerId) return { error: "INVOICE_CUSTOMER_MISMATCH" as const };
      }

      const [dn] = await tx
        .insert(schema.deliveryNotes)
        .values({
          tenantId: ctx.tenantId,
          customerId: customer.id,
          salesOrderId: body.salesOrderId ?? null,
          invoiceId: body.invoiceId ?? null,
          status: "draft",
          deliveryDate,
          shippingAddressLine1: body.shippingAddressLine1?.trim() || null,
          shippingAddressLine2: body.shippingAddressLine2?.trim() || null,
          shippingCity: body.shippingCity?.trim() || null,
          shippingPostalCode: body.shippingPostalCode?.trim() || null,
          carrier: body.carrier?.trim() || null,
          trackingNumber: body.trackingNumber?.trim() || null,
          notes: body.notes?.trim() || null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!dn) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.deliveryNoteLines).values(
        body.lines.map((l, idx) => ({
          tenantId: ctx.tenantId,
          deliveryNoteId: dn.id,
          lineNo: (idx + 1) as number,
          itemId: l.itemId ?? null,
          description: l.description,
          quantity: String(l.quantity),
        })),
      );

      return { deliveryNote: dn };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        CUSTOMER_NOT_FOUND: "Customer not found.",
        SALES_ORDER_NOT_FOUND: "Sales order not found.",
        SO_CUSTOMER_MISMATCH: "Sales order belongs to a different customer.",
        INVOICE_NOT_FOUND: "Invoice not found.",
        INVOICE_CUSTOMER_MISMATCH: "Invoice belongs to a different customer.",
        INSERT_FAILED: "Couldn't create the delivery note.",
      };
      const code = result.error as string;
      return reply
        .status(code === "INSERT_FAILED" ? 500 : 400)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.status(201).send({ deliveryNote: result.deliveryNote });
  });

  // POST /delivery-notes/:id/deliver — allocate DN number + flip to 'delivered'
  fastify.post<{ Params: { id: string }; Body: { receivedByName?: string } }>(
    "/:id/deliver",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const parsed = DeliverSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }
      const receivedByName = parsed.data.receivedByName?.trim() || null;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [dn] = await tx
          .select()
          .from(schema.deliveryNotes)
          .where(
            and(
              eq(schema.deliveryNotes.tenantId, ctx.tenantId),
              eq(schema.deliveryNotes.id, req.params.id),
              isNull(schema.deliveryNotes.deletedAt),
            ),
          )
          .limit(1);
        if (!dn) return { error: "NOT_FOUND" as const };
        if (dn.status !== "draft") return { error: "NOT_DRAFT" as const };

        const numRows = (await tx.execute(
          sql`SELECT next_document_number('delivery_note') AS number`,
        )) as unknown as Array<{ number: string }>;
        const dnNumber = numRows[0]?.number;
        if (!dnNumber) return { error: "NUMBER_ALLOC_FAILED" as const };

        // If tenant has opted into DN-based stock relief, this is where stock
        // actually leaves inventory (COGS journal + stock_ledger writes).
        // In 'invoice' mode (default), the invoice post already handled it —
        // we just flip status here.
        const settings = await loadTenantSettings(tx);
        if (settings.stockRelieveOn === "delivery_note") {
          const dnLines = await tx
            .select()
            .from(schema.deliveryNoteLines)
            .where(
              and(
                eq(schema.deliveryNoteLines.tenantId, ctx.tenantId),
                eq(schema.deliveryNoteLines.deliveryNoteId, dn.id),
              ),
            );

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
          const { inventoryAccountId, cogsAccountId } = await resolveStockGLAccounts(
            tx,
            ctx.tenantId,
          );

          const trackedLines: Array<{
            line: (typeof dnLines)[number];
            item: typeof schema.items.$inferSelect;
            cogsCents: number;
          }> = [];
          let totalCogsCents = 0;

          for (const l of dnLines) {
            if (!l.itemId) continue;
            const item = itemById.get(l.itemId);
            if (!item || !item.trackInventory) continue;
            if (!defaultWarehouse) return { error: "NO_DEFAULT_WAREHOUSE" as const };
            if (!inventoryAccountId || !cogsAccountId) {
              return { error: "NO_STOCK_ACCOUNTS" as const };
            }

            const qty = Number(l.quantity);
            if (qty <= 0) continue;

            try {
              const { cogsCents } = await peekStockIssue(tx, {
                tenantId: ctx.tenantId,
                itemId: item.id,
                warehouseId: defaultWarehouse.id,
                quantity: qty,
              });
              trackedLines.push({ line: l, item, cogsCents });
              totalCogsCents += cogsCents;
            } catch (err) {
              const e = err as Error & { code?: string };
              if (e.code === "NEGATIVE_STOCK") return { error: "NEGATIVE_STOCK" as const };
              throw err;
            }
          }

          if (totalCogsCents > 0 && cogsAccountId && inventoryAccountId) {
            const { entryId } = await postJournal(tx, {
              tenantId: ctx.tenantId,
              entryDate: dn.deliveryDate,
              memo: `Delivery ${dnNumber}`,
              sourceType: "delivery_note",
              sourceId: dn.id,
              postedByUserId: ctx.userId,
              lines: [
                {
                  accountId: cogsAccountId,
                  drCents: totalCogsCents,
                  description: `COGS · ${dnNumber}`,
                  customerId: dn.customerId,
                },
                {
                  accountId: inventoryAccountId,
                  crCents: totalCogsCents,
                  description: `Inventory relief · ${dnNumber}`,
                  customerId: dn.customerId,
                },
              ],
            });

            for (const t of trackedLines) {
              await applyStockIssue(tx, {
                tenantId: ctx.tenantId,
                itemId: t.item.id,
                warehouseId: defaultWarehouse!.id,
                quantity: Number(t.line.quantity),
                sourceDocumentType: "delivery_note",
                sourceDocumentId: dn.id,
                sourceLineId: t.line.id,
                journalEntryId: entryId,
                postedByUserId: ctx.userId,
                memo: `Delivery ${dnNumber}`,
              });
            }
          }
        }

        const now = new Date();
        await tx
          .update(schema.deliveryNotes)
          .set({
            status: "delivered",
            dnNumber,
            receivedByName,
            deliveredAt: now,
            updatedAt: now,
          })
          .where(eq(schema.deliveryNotes.id, dn.id));

        return { dnNumber };
      });

      if ("error" in result) {
        const msgs: Record<string, string> = {
          NOT_FOUND: "Delivery note not found.",
          NOT_DRAFT: "Only draft delivery notes can be marked delivered.",
          NUMBER_ALLOC_FAILED: "Couldn't allocate a DN number.",
          NO_DEFAULT_WAREHOUSE: "No default warehouse is configured for this tenant.",
          NO_STOCK_ACCOUNTS: "Inventory or COGS account isn't set up.",
          NEGATIVE_STOCK: "Not enough stock on hand to fulfill this delivery.",
        };
        const code = result.error as string;
        return reply
          .status(code === "NOT_FOUND" ? 404 : 400)
          .send({ error: { code, message: msgs[code] ?? code } });
      }
      return reply.send({ ok: true, ...result });
    },
  );

  // POST /delivery-notes/:id/cancel
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
        const [dn] = await tx
          .select()
          .from(schema.deliveryNotes)
          .where(
            and(
              eq(schema.deliveryNotes.tenantId, ctx.tenantId),
              eq(schema.deliveryNotes.id, req.params.id),
              isNull(schema.deliveryNotes.deletedAt),
            ),
          )
          .limit(1);
        if (!dn) return { error: "NOT_FOUND" as const };
        if (dn.status === "cancelled") return { error: "ALREADY_CANCELLED" as const };

        const now = new Date();
        await tx
          .update(schema.deliveryNotes)
          .set({
            status: "cancelled",
            cancelledAt: now,
            cancelledReason: reason,
            updatedAt: now,
          })
          .where(eq(schema.deliveryNotes.id, dn.id));
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
