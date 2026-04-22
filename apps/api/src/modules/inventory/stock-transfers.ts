import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

const LineSchema = z.object({
  itemId: z.string().uuid(),
  quantityRequested: z.number().positive().max(1_000_000),
  notes: z.string().max(255).optional().or(z.literal("")),
});

const CreateSchema = z.object({
  sourceWarehouseId: z.string().uuid(),
  destinationWarehouseId: z.string().uuid(),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional().or(z.literal("")),
  lines: z.array(LineSchema).min(1),
}).refine((v) => v.sourceWarehouseId !== v.destinationWarehouseId, {
  message: "Source and destination must be different warehouses",
});

const ReceiveLineSchema = z.object({
  lineId: z.string().uuid(),
  quantityReceived: z.number().min(0).max(1_000_000),
});

const ReceiveSchema = z.object({
  lines: z.array(ReceiveLineSchema).min(1),
  notes: z.string().max(500).optional(),
});

export const stockTransfersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx.execute(sql`
        SELECT st.id,
               st.transfer_number,
               st.status,
               st.requested_date::text AS requested_date,
               st.dispatched_at,
               st.received_at,
               st.has_discrepancy,
               st.created_at,
               src.code AS source_code,
               src.name AS source_name,
               dst.code AS dest_code,
               dst.name AS dest_name,
               (SELECT COUNT(*)::int FROM stock_transfer_lines stl
                 WHERE stl.transfer_id = st.id) AS line_count
          FROM stock_transfers st
          INNER JOIN warehouses src ON src.id = st.source_warehouse_id
          INNER JOIN warehouses dst ON dst.id = st.destination_warehouse_id
         WHERE st.tenant_id = current_tenant_id()
           AND st.deleted_at IS NULL
         ORDER BY st.created_at DESC
         LIMIT 200
      `),
    ) as unknown as Array<{
      id: string;
      transfer_number: string | null;
      status: string;
      requested_date: string;
      dispatched_at: string | null;
      received_at: string | null;
      has_discrepancy: boolean;
      created_at: string;
      source_code: string;
      source_name: string;
      dest_code: string;
      dest_name: string;
      line_count: number;
    }>;

    return reply.send({
      transfers: rows.map((r) => ({
        id: r.id,
        transferNumber: r.transfer_number,
        status: r.status,
        requestedDate: r.requested_date,
        dispatchedAt: r.dispatched_at,
        receivedAt: r.received_at,
        hasDiscrepancy: r.has_discrepancy,
        createdAt: r.created_at,
        sourceCode: r.source_code,
        sourceName: r.source_name,
        destCode: r.dest_code,
        destName: r.dest_name,
        lineCount: r.line_count,
      })),
    });
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [header] = await tx
        .select()
        .from(schema.stockTransfers)
        .where(
          and(
            eq(schema.stockTransfers.tenantId, ctx.tenantId),
            eq(schema.stockTransfers.id, req.params.id),
            isNull(schema.stockTransfers.deletedAt),
          ),
        )
        .limit(1);
      if (!header) return null;

      const lineRows = (await tx.execute(sql`
        SELECT stl.*, i.name AS item_name, i.sku, i.unit
          FROM stock_transfer_lines stl
          INNER JOIN items i ON i.id = stl.item_id
         WHERE stl.transfer_id = ${header.id}::uuid
         ORDER BY stl.line_no ASC
      `)) as unknown as Array<{
        id: string;
        line_no: number;
        item_id: string;
        item_name: string;
        sku: string | null;
        unit: string;
        quantity_requested: string;
        quantity_dispatched: string | null;
        quantity_received: string | null;
        unit_cost_cents_at_dispatch: number | string | null;
        notes: string | null;
      }>;

      return { transfer: header, lines: lineRows };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // Create a draft transfer.
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;
    const requestedDate = input.requestedDate ?? new Date().toISOString().slice(0, 10);

    const transfer = await withTenant(ctx.tenantId, async (tx) => {
      // Validate both warehouses belong to the tenant and are active.
      const whRows = await tx
        .select()
        .from(schema.warehouses)
        .where(
          and(
            eq(schema.warehouses.tenantId, ctx.tenantId),
            isNull(schema.warehouses.deletedAt),
          ),
        );
      const whIds = new Set(whRows.map((w) => w.id));
      if (!whIds.has(input.sourceWarehouseId) || !whIds.has(input.destinationWarehouseId)) {
        throw new Error("WAREHOUSE_NOT_FOUND");
      }

      const [row] = await tx
        .insert(schema.stockTransfers)
        .values({
          tenantId: ctx.tenantId,
          sourceWarehouseId: input.sourceWarehouseId,
          destinationWarehouseId: input.destinationWarehouseId,
          requestedDate,
          notes: input.notes || null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!row) throw new Error("INSERT_FAILED");

      await tx.insert(schema.stockTransferLines).values(
        input.lines.map((l, idx) => ({
          tenantId: ctx.tenantId,
          transferId: row.id,
          lineNo: idx + 1,
          itemId: l.itemId,
          quantityRequested: l.quantityRequested.toString(),
          notes: l.notes && l.notes.trim() ? l.notes.trim() : null,
        })),
      );

      return row;
    }).catch((err: Error) => {
      if (err.message === "WAREHOUSE_NOT_FOUND") {
        reply.status(400).send({ error: { code: "WAREHOUSE_NOT_FOUND" } });
        return null;
      }
      throw err;
    });

    if (!transfer) return;
    return reply.status(201).send({ transfer });
  });

  // POST /stock-transfers/:id/dispatch — reduce source warehouse stock,
  // allocate transfer number, flip status to 'dispatched'.
  fastify.post<{ Params: { id: string } }>("/:id/dispatch", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [header] = await tx
        .select()
        .from(schema.stockTransfers)
        .where(
          and(
            eq(schema.stockTransfers.tenantId, ctx.tenantId),
            eq(schema.stockTransfers.id, req.params.id),
            isNull(schema.stockTransfers.deletedAt),
          ),
        )
        .limit(1);
      if (!header) return { error: "NOT_FOUND" as const };
      if (header.status !== "draft") return { error: "NOT_DRAFT" as const };

      const lines = await tx
        .select()
        .from(schema.stockTransferLines)
        .where(eq(schema.stockTransferLines.transferId, header.id))
        .orderBy(asc(schema.stockTransferLines.lineNo));

      // For each line: lock source balance, check availability, reduce qty
      // and total value at current WAVG, write stock_ledger 'transfer_out'.
      // Destination isn't touched until receive.
      for (const line of lines) {
        const qty = Number(line.quantityRequested);
        if (qty <= 0) continue;

        const [bal] = await tx
          .select()
          .from(schema.itemBalances)
          .where(
            and(
              eq(schema.itemBalances.tenantId, ctx.tenantId),
              eq(schema.itemBalances.itemId, line.itemId),
              eq(schema.itemBalances.warehouseId, header.sourceWarehouseId),
            ),
          )
          .for("update")
          .limit(1);

        const currentQty = bal ? Number(bal.quantityOnHand) : 0;
        if (currentQty < qty) {
          return { error: "INSUFFICIENT_STOCK" as const, lineId: line.id, have: currentQty, need: qty };
        }

        const currentAvg = bal?.averageCostCents ?? 0;
        const currentValue = bal?.totalValueCents ?? 0;
        const movedValue = Math.round(qty * currentAvg);
        const newQty = currentQty - qty;
        const newValue = Math.max(0, currentValue - movedValue);
        const newAvg = newQty > 0 ? Math.round(newValue / newQty) : 0;

        await tx
          .update(schema.itemBalances)
          .set({
            quantityOnHand: newQty.toString(),
            averageCostCents: newAvg,
            totalValueCents: newValue,
            lastMovementAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.itemBalances.tenantId, ctx.tenantId),
              eq(schema.itemBalances.itemId, line.itemId),
              eq(schema.itemBalances.warehouseId, header.sourceWarehouseId),
            ),
          );

        await tx.insert(schema.stockLedger).values({
          tenantId: ctx.tenantId,
          itemId: line.itemId,
          warehouseId: header.sourceWarehouseId,
          movementType: "transfer_out",
          quantity: (-qty).toString(),
          unitCostCents: currentAvg,
          totalCostCents: -movedValue,
          runningQuantity: newQty.toString(),
          runningValueCents: newValue,
          runningAvgCostCents: newAvg,
          sourceDocumentType: "stock_transfer",
          sourceDocumentId: header.id,
          sourceLineId: line.id,
          memo: `Transfer out · ${header.id.slice(0, 8)}`,
          postedByUserId: ctx.userId,
        });

        await tx
          .update(schema.stockTransferLines)
          .set({
            quantityDispatched: qty.toString(),
            unitCostCentsAtDispatch: currentAvg,
          })
          .where(eq(schema.stockTransferLines.id, line.id));
      }

      // Allocate transfer number via existing sequence helper.
      const [{ number: transferNumber }] = (await tx.execute(
        sql`SELECT next_document_number('stock_transfer') AS number`,
      )) as unknown as Array<{ number: string }>;

      await tx
        .update(schema.stockTransfers)
        .set({
          status: "dispatched",
          transferNumber,
          dispatchedAt: new Date(),
          dispatchedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.stockTransfers.id, header.id));

      return { ok: true as const, transferNumber };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_DRAFT: 409,
        INSUFFICIENT_STOCK: 409,
      };
      const msgs: Record<string, string> = {
        NOT_DRAFT: "Only draft transfers can be dispatched.",
        INSUFFICIENT_STOCK: "One or more lines don't have enough stock in the source warehouse.",
      };
      const code = result.error as string;
      return reply.status(map[code] ?? 500).send({ error: { code, message: msgs[code] ?? code, ...result } });
    }
    return reply.send(result);
  });

  // POST /stock-transfers/:id/receive — add the received qty at dispatch-time
  // cost into the destination warehouse. If received < dispatched, flag the
  // header with has_discrepancy so the variance is visible.
  fastify.post<{ Params: { id: string }; Body: { lines: unknown[]; notes?: string } }>(
    "/:id/receive",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const parsed = ReceiveSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }
      const { lines: receiveLines } = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [header] = await tx
          .select()
          .from(schema.stockTransfers)
          .where(
            and(
              eq(schema.stockTransfers.tenantId, ctx.tenantId),
              eq(schema.stockTransfers.id, req.params.id),
              isNull(schema.stockTransfers.deletedAt),
            ),
          )
          .limit(1);
        if (!header) return { error: "NOT_FOUND" as const };
        if (header.status !== "dispatched") return { error: "NOT_DISPATCHED" as const };

        const receivedById = new Map(receiveLines.map((r) => [r.lineId, r.quantityReceived]));
        const lines = await tx
          .select()
          .from(schema.stockTransferLines)
          .where(eq(schema.stockTransferLines.transferId, header.id));

        let anyDiscrepancy = false;

        for (const line of lines) {
          const receivedRaw = receivedById.get(line.id);
          if (receivedRaw === undefined) {
            return { error: "MISSING_LINE" as const, lineId: line.id };
          }
          const dispatched = Number(line.quantityDispatched ?? 0);
          const received = Number(receivedRaw);
          if (received > dispatched) {
            return { error: "RECEIVED_EXCEEDS_DISPATCHED" as const, lineId: line.id, dispatched, received };
          }
          if (received < dispatched) anyDiscrepancy = true;

          if (received > 0) {
            // Add received qty at the dispatch-time unit cost (preserved on
            // the line). This blends into destination WAVG.
            const unitCost = line.unitCostCentsAtDispatch ?? 0;
            const [bal] = await tx
              .select()
              .from(schema.itemBalances)
              .where(
                and(
                  eq(schema.itemBalances.tenantId, ctx.tenantId),
                  eq(schema.itemBalances.itemId, line.itemId),
                  eq(schema.itemBalances.warehouseId, header.destinationWarehouseId),
                ),
              )
              .for("update")
              .limit(1);

            let currentQty = 0;
            let currentValue = 0;
            if (bal) {
              currentQty = Number(bal.quantityOnHand);
              currentValue = bal.totalValueCents;
            } else {
              await tx.insert(schema.itemBalances).values({
                tenantId: ctx.tenantId,
                itemId: line.itemId,
                warehouseId: header.destinationWarehouseId,
              });
            }

            const incomingValue = Math.round(received * unitCost);
            const newQty = currentQty + received;
            const newValue = currentValue + incomingValue;
            const newAvg = newQty > 0 ? Math.round(newValue / newQty) : 0;

            await tx
              .update(schema.itemBalances)
              .set({
                quantityOnHand: newQty.toString(),
                averageCostCents: newAvg,
                totalValueCents: newValue,
                lastMovementAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.itemBalances.tenantId, ctx.tenantId),
                  eq(schema.itemBalances.itemId, line.itemId),
                  eq(schema.itemBalances.warehouseId, header.destinationWarehouseId),
                ),
              );

            await tx.insert(schema.stockLedger).values({
              tenantId: ctx.tenantId,
              itemId: line.itemId,
              warehouseId: header.destinationWarehouseId,
              movementType: "transfer_in",
              quantity: received.toString(),
              unitCostCents: unitCost,
              totalCostCents: incomingValue,
              runningQuantity: newQty.toString(),
              runningValueCents: newValue,
              runningAvgCostCents: newAvg,
              sourceDocumentType: "stock_transfer",
              sourceDocumentId: header.id,
              sourceLineId: line.id,
              memo: `Transfer in · ${header.transferNumber ?? header.id.slice(0, 8)}`,
              postedByUserId: ctx.userId,
            });
          }

          await tx
            .update(schema.stockTransferLines)
            .set({ quantityReceived: received.toString() })
            .where(eq(schema.stockTransferLines.id, line.id));
        }

        await tx
          .update(schema.stockTransfers)
          .set({
            status: "received",
            receivedAt: new Date(),
            receivedByUserId: ctx.userId,
            hasDiscrepancy: anyDiscrepancy,
            updatedAt: new Date(),
          })
          .where(eq(schema.stockTransfers.id, header.id));

        return { ok: true as const, hasDiscrepancy: anyDiscrepancy };
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          NOT_DISPATCHED: 409,
          MISSING_LINE: 400,
          RECEIVED_EXCEEDS_DISPATCHED: 409,
        };
        const msgs: Record<string, string> = {
          NOT_DISPATCHED: "Only dispatched transfers can be received.",
          MISSING_LINE: "Receive payload is missing one of the transfer lines.",
          RECEIVED_EXCEEDS_DISPATCHED: "Received quantity can't exceed dispatched quantity.",
        };
        const code = result.error as string;
        return reply.status(map[code] ?? 500).send({ error: { code, message: msgs[code] ?? code, ...result } });
      }
      return reply.send(result);
    },
  );

  // POST /stock-transfers/:id/cancel — draft only. Post-dispatch cancellation
  // is deliberately not supported here; use a reverse transfer instead.
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/:id/cancel",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;
      const reason = (req.body?.reason ?? "").trim();

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [header] = await tx
          .select()
          .from(schema.stockTransfers)
          .where(
            and(
              eq(schema.stockTransfers.tenantId, ctx.tenantId),
              eq(schema.stockTransfers.id, req.params.id),
              isNull(schema.stockTransfers.deletedAt),
            ),
          )
          .limit(1);
        if (!header) return { error: "NOT_FOUND" as const };
        if (header.status !== "draft") return { error: "ONLY_DRAFT" as const };

        await tx
          .update(schema.stockTransfers)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledReason: reason || null,
            updatedAt: new Date(),
          })
          .where(eq(schema.stockTransfers.id, header.id));
        return { ok: true as const };
      });

      if ("error" in result) {
        return reply.status(400).send({ error: { code: result.error } });
      }
      return reply.send(result);
    },
  );
};
