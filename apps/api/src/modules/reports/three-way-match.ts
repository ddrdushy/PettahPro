import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// Status values per PO line (and rolled up per PO header).
// - ok: ordered = received = billed (within tolerance)
// - awaiting_grn: nothing received yet
// - awaiting_bill: received but not billed yet
// - under_received: received < ordered
// - over_received: received > ordered
// - bill_mismatch: billed qty != received qty (either direction)
export type MatchStatus =
  | "ok"
  | "awaiting_grn"
  | "awaiting_bill"
  | "under_received"
  | "over_received"
  | "bill_mismatch";

// Qty tolerance for float compare (quantities stored as numeric(18,4)).
const QTY_EPSILON = 0.0001;

function statusFor(
  ordered: number,
  received: number,
  billed: number,
  billExists: boolean,
): MatchStatus {
  if (received <= QTY_EPSILON) return "awaiting_grn";
  if (!billExists) return "awaiting_bill";
  if (received + QTY_EPSILON < ordered) return "under_received";
  if (received > ordered + QTY_EPSILON) return "over_received";
  if (Math.abs(billed - received) > QTY_EPSILON) return "bill_mismatch";
  return "ok";
}

// Roll up line statuses into an overall PO status.
// Priority: bill_mismatch/over/under > awaiting_bill > awaiting_grn > ok.
function rollup(statuses: MatchStatus[]): MatchStatus {
  if (statuses.length === 0) return "ok";
  if (statuses.some((s) => s === "over_received")) return "over_received";
  if (statuses.some((s) => s === "under_received")) return "under_received";
  if (statuses.some((s) => s === "bill_mismatch")) return "bill_mismatch";
  if (statuses.some((s) => s === "awaiting_bill")) return "awaiting_bill";
  if (statuses.some((s) => s === "awaiting_grn")) return "awaiting_grn";
  return "ok";
}

const ListQuery = z.object({
  status: z
    .enum(["ok", "awaiting_grn", "awaiting_bill", "under_received", "over_received", "bill_mismatch", "variance"])
    .optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const threeWayMatchRoutes: FastifyPluginAsync = async (fastify) => {
  // List — aggregated reconciliation per PO.
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { status: wantStatus, from, to } = parsed.data;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      // Pull PO headers + lines + supplier + aggregated GRN/bill qty per line.
      // Line matching between PO<->GRN<->Bill is done by item_id when both sides
      // have it; otherwise by trimmed lowered description.
      const rows = (await tx.execute(sql`
        WITH po_headers AS (
          SELECT po.id, po.po_number, po.supplier_id, po.order_date, po.status,
                 po.total_cents, po.converted_bill_id, s.name AS supplier_name
            FROM purchase_orders po
            JOIN suppliers s ON s.id = po.supplier_id
           WHERE po.tenant_id = current_tenant_id()
             AND po.deleted_at IS NULL
             AND po.status NOT IN ('draft', 'cancelled')
             ${from ? sql`AND po.order_date >= ${from}::date` : sql``}
             ${to ? sql`AND po.order_date <= ${to}::date` : sql``}
        ),
        grn_agg AS (
          -- Sum received qty per (PO, item_id | lower(description)).
          SELECT g.purchase_order_id AS po_id,
                 gl.item_id,
                 LOWER(TRIM(gl.description)) AS desc_key,
                 SUM(gl.quantity_received)::numeric AS received_qty
            FROM grns g
            JOIN grn_lines gl ON gl.grn_id = g.id
           WHERE g.tenant_id = current_tenant_id()
             AND g.deleted_at IS NULL
             AND g.status = 'received'
             AND g.purchase_order_id IS NOT NULL
             AND g.purchase_order_id IN (SELECT id FROM po_headers)
           GROUP BY g.purchase_order_id, gl.item_id, LOWER(TRIM(gl.description))
        ),
        bill_agg AS (
          -- Sum billed qty from the converted bill per (PO, item_id | lower(description)).
          SELECT ph.id AS po_id,
                 bl.item_id,
                 LOWER(TRIM(bl.description)) AS desc_key,
                 SUM(bl.quantity)::numeric AS billed_qty
            FROM po_headers ph
            JOIN bills b ON b.id = ph.converted_bill_id
            JOIN bill_lines bl ON bl.bill_id = b.id
           WHERE b.tenant_id = current_tenant_id()
             AND b.deleted_at IS NULL
             AND b.status != 'void'
           GROUP BY ph.id, bl.item_id, LOWER(TRIM(bl.description))
        )
        SELECT ph.id AS po_id,
               ph.po_number,
               ph.supplier_id,
               ph.supplier_name,
               ph.order_date::text AS order_date,
               ph.status AS po_status,
               ph.total_cents,
               ph.converted_bill_id,
               pol.id AS line_id,
               pol.line_no,
               pol.item_id,
               pol.description,
               pol.quantity::numeric AS ordered_qty,
               COALESCE(ga.received_qty, 0)::numeric AS received_qty,
               COALESCE(ba.billed_qty, 0)::numeric AS billed_qty
          FROM po_headers ph
          JOIN purchase_order_lines pol ON pol.purchase_order_id = ph.id
          LEFT JOIN grn_agg ga
            ON ga.po_id = ph.id
           AND (
                 (pol.item_id IS NOT NULL AND ga.item_id = pol.item_id)
              OR (pol.item_id IS NULL AND ga.item_id IS NULL
                  AND ga.desc_key = LOWER(TRIM(pol.description)))
              )
          LEFT JOIN bill_agg ba
            ON ba.po_id = ph.id
           AND (
                 (pol.item_id IS NOT NULL AND ba.item_id = pol.item_id)
              OR (pol.item_id IS NULL AND ba.item_id IS NULL
                  AND ba.desc_key = LOWER(TRIM(pol.description)))
              )
         ORDER BY ph.order_date DESC, ph.po_number, pol.line_no
      `)) as unknown as Array<{
        po_id: string;
        po_number: string | null;
        supplier_id: string;
        supplier_name: string;
        order_date: string;
        po_status: string;
        total_cents: number | string;
        converted_bill_id: string | null;
        line_id: string;
        line_no: number;
        item_id: string | null;
        description: string;
        ordered_qty: string | number;
        received_qty: string | number;
        billed_qty: string | number;
      }>;

      // Group into PO buckets.
      type Line = {
        lineId: string;
        lineNo: number;
        itemId: string | null;
        description: string;
        orderedQty: number;
        receivedQty: number;
        billedQty: number;
        status: MatchStatus;
      };
      type Po = {
        poId: string;
        poNumber: string | null;
        supplierId: string;
        supplierName: string;
        orderDate: string;
        poStatus: string;
        totalCents: number;
        convertedBillId: string | null;
        lines: Line[];
        status: MatchStatus;
        lineCount: number;
        varianceCount: number;
      };
      const byPo = new Map<string, Po>();

      for (const r of rows) {
        const ordered = Number(r.ordered_qty);
        const received = Number(r.received_qty);
        const billed = Number(r.billed_qty);
        const billExists = r.converted_bill_id != null;
        const st = statusFor(ordered, received, billed, billExists);

        let po = byPo.get(r.po_id);
        if (!po) {
          po = {
            poId: r.po_id,
            poNumber: r.po_number,
            supplierId: r.supplier_id,
            supplierName: r.supplier_name,
            orderDate: r.order_date,
            poStatus: r.po_status,
            totalCents: Number(r.total_cents),
            convertedBillId: r.converted_bill_id,
            lines: [],
            status: "ok",
            lineCount: 0,
            varianceCount: 0,
          };
          byPo.set(r.po_id, po);
        }
        po.lines.push({
          lineId: r.line_id,
          lineNo: r.line_no,
          itemId: r.item_id,
          description: r.description,
          orderedQty: ordered,
          receivedQty: received,
          billedQty: billed,
          status: st,
        });
      }

      const pos = Array.from(byPo.values()).map((po) => {
        const statuses = po.lines.map((l) => l.status);
        po.status = rollup(statuses);
        po.lineCount = po.lines.length;
        po.varianceCount = statuses.filter(
          (s) => s === "under_received" || s === "over_received" || s === "bill_mismatch",
        ).length;
        return po;
      });

      const filtered = wantStatus
        ? pos.filter((p) => {
            if (wantStatus === "variance") {
              return p.status === "under_received" || p.status === "over_received" || p.status === "bill_mismatch";
            }
            return p.status === wantStatus;
          })
        : pos;

      // Overall summary counts (across all POs, ignoring status filter).
      const summary = {
        total: pos.length,
        ok: pos.filter((p) => p.status === "ok").length,
        awaitingGrn: pos.filter((p) => p.status === "awaiting_grn").length,
        awaitingBill: pos.filter((p) => p.status === "awaiting_bill").length,
        underReceived: pos.filter((p) => p.status === "under_received").length,
        overReceived: pos.filter((p) => p.status === "over_received").length,
        billMismatch: pos.filter((p) => p.status === "bill_mismatch").length,
      };

      return { purchaseOrders: filtered, summary };
    });

    return reply.send(data);
  });
};
