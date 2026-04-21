import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

const QuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

type BucketLabel = "current" | "0-30" | "30-60" | "60-90" | "90+";

interface StatementTransaction {
  kind: "bill" | "payment";
  id: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  description: string;
  // For AP, a bill increases what we owe (credit); a payment reduces it (debit).
  // We keep the "debit/credit" naming consistent with the customer statement
  // from the supplier's point of view: debit column = we paid them,
  // credit column = they billed us.
  debitCents: number;
  creditCents: number;
  runningBalanceCents: number;
}

export const supplierStatementRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /suppliers/:id/statement
  fastify.get<{ Params: { id: string } }>("/:id/statement", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const today = new Date();
    const defaultTo = today.toISOString().slice(0, 10);
    const defaultFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    const from = parsed.data.from ?? defaultFrom;
    const to = parsed.data.to ?? defaultTo;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const supRows = await tx
        .select()
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, req.params.id),
            isNull(schema.suppliers.deletedAt),
          ),
        )
        .limit(1);
      const supplier = supRows[0];
      if (!supplier) return null;

      // -- Opening balance (amount we owe): bills billed minus payments made, BEFORE `from`.
      const [openingRow] = (await tx.execute(sql`
        SELECT
          COALESCE((
            SELECT SUM(total_cents)
            FROM bills
            WHERE tenant_id = current_tenant_id()
              AND supplier_id = ${supplier.id}
              AND deleted_at IS NULL
              AND status NOT IN ('draft','void')
              AND bill_date < ${from}::date
          ), 0)::bigint
          -
          COALESCE((
            SELECT SUM(amount_cents)
            FROM supplier_payments
            WHERE tenant_id = current_tenant_id()
              AND supplier_id = ${supplier.id}
              AND deleted_at IS NULL
              AND status = 'posted'
              AND payment_date < ${from}::date
          ), 0)::bigint
          AS opening_cents
      `)) as unknown as Array<{ opening_cents: number | string }>;

      const openingBalanceCents = Number(openingRow?.opening_cents ?? 0);

      // -- In-range bills (non-draft, non-void)
      const bills = (await tx.execute(sql`
        SELECT id, internal_reference, supplier_bill_number,
               bill_date::text AS bill_date, due_date::text AS due_date,
               total_cents, status
        FROM bills
        WHERE tenant_id = current_tenant_id()
          AND supplier_id = ${supplier.id}
          AND deleted_at IS NULL
          AND status NOT IN ('draft','void')
          AND bill_date BETWEEN ${from}::date AND ${to}::date
      `)) as unknown as Array<{
        id: string;
        internal_reference: string | null;
        supplier_bill_number: string | null;
        bill_date: string;
        due_date: string;
        total_cents: number | string;
        status: string;
      }>;

      // -- In-range supplier payments (posted)
      const payments = (await tx.execute(sql`
        SELECT id, payment_number, payment_date::text AS payment_date, amount_cents,
               method, reference, cheque_number, memo
        FROM supplier_payments
        WHERE tenant_id = current_tenant_id()
          AND supplier_id = ${supplier.id}
          AND deleted_at IS NULL
          AND status = 'posted'
          AND payment_date BETWEEN ${from}::date AND ${to}::date
      `)) as unknown as Array<{
        id: string;
        payment_number: string | null;
        payment_date: string;
        amount_cents: number | string;
        method: string;
        reference: string | null;
        cheque_number: string | null;
        memo: string | null;
      }>;

      type MergedRow =
        | { kind: "bill"; sortKey: string; row: (typeof bills)[number] }
        | { kind: "payment"; sortKey: string; row: (typeof payments)[number] };

      // Bills ordered before payments on the same day — conservative: supplier
      // billed you first, you paid after.
      const merged: MergedRow[] = [
        ...bills.map<MergedRow>((r) => ({
          kind: "bill",
          sortKey: `${r.bill_date}-0-${r.supplier_bill_number ?? r.internal_reference ?? r.id}`,
          row: r,
        })),
        ...payments.map<MergedRow>((r) => ({
          kind: "payment",
          sortKey: `${r.payment_date}-1-${r.payment_number ?? r.id}`,
          row: r,
        })),
      ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

      let running = openingBalanceCents;
      let totalBilled = 0;
      let totalPaid = 0;
      const transactions: StatementTransaction[] = merged.map((m) => {
        if (m.kind === "bill") {
          const r = m.row;
          const credit = Number(r.total_cents);
          running += credit;
          totalBilled += credit;
          return {
            kind: "bill",
            id: r.id,
            number: r.supplier_bill_number ?? r.internal_reference,
            date: r.bill_date,
            dueDate: r.due_date,
            description: r.internal_reference && r.supplier_bill_number
              ? `Our ref ${r.internal_reference}`
              : "Supplier bill",
            debitCents: 0,
            creditCents: credit,
            runningBalanceCents: running,
          };
        }
        const r = m.row;
        const debit = Number(r.amount_cents);
        running -= debit;
        totalPaid += debit;
        return {
          kind: "payment",
          id: r.id,
          number: r.payment_number,
          date: r.payment_date,
          dueDate: null,
          description: [
            methodLabel(r.method),
            r.cheque_number ? `Cheque ${r.cheque_number}` : null,
            r.reference ? `Ref ${r.reference}` : null,
            r.memo,
          ]
            .filter(Boolean)
            .join(" · "),
          debitCents: debit,
          creditCents: 0,
          runningBalanceCents: running,
        };
      });

      // -- Aging as of `to` (open bills only)
      const agingRows = (await tx.execute(sql`
        SELECT
          CASE
            WHEN due_date >= ${to}::date                                      THEN 'current'
            WHEN ${to}::date - due_date BETWEEN 1 AND 30                       THEN '0-30'
            WHEN ${to}::date - due_date BETWEEN 31 AND 60                      THEN '30-60'
            WHEN ${to}::date - due_date BETWEEN 61 AND 90                      THEN '60-90'
            ELSE '90+'
          END AS bucket,
          COALESCE(SUM(balance_due_cents), 0)::bigint AS balance_cents,
          COUNT(*)::int AS inv_count
        FROM bills
        WHERE tenant_id = current_tenant_id()
          AND supplier_id = ${supplier.id}
          AND deleted_at IS NULL
          AND status IN ('posted','partially_paid')
          AND bill_date <= ${to}::date
        GROUP BY bucket
      `)) as unknown as Array<{ bucket: BucketLabel; balance_cents: number | string; inv_count: number }>;

      const agingMap = new Map(agingRows.map((r) => [r.bucket, r]));
      const aging = (["current", "0-30", "30-60", "60-90", "90+"] as const).map((b) => ({
        label: b,
        balanceCents: Number(agingMap.get(b)?.balance_cents ?? 0),
        invoiceCount: agingMap.get(b)?.inv_count ?? 0,
      }));

      return {
        supplier,
        asOfFrom: from,
        asOfTo: to,
        openingBalanceCents,
        closingBalanceCents: running,
        totalBilledCents: totalBilled,
        totalPaidCents: totalPaid,
        transactions,
        aging,
      };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });
};

function methodLabel(m: string): string {
  const map: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank transfer",
    cheque: "Cheque",
    slips: "Slip",
    other: "Other",
  };
  return map[m] ?? m;
}
