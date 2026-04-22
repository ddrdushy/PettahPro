import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, type Database } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

const QuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

type BucketLabel = "current" | "0-30" | "30-60" | "60-90" | "90+";

export interface StatementTransaction {
  kind: "invoice" | "payment";
  id: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  description: string;
  debitCents: number;
  creditCents: number;
  runningBalanceCents: number;
}

export interface StatementBucket {
  label: BucketLabel;
  balanceCents: number;
  invoiceCount: number;
}

export interface StatementData {
  customer: typeof schema.customers.$inferSelect;
  asOfFrom: string;
  asOfTo: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  totalBilledCents: number;
  totalReceivedCents: number;
  transactions: StatementTransaction[];
  aging: StatementBucket[];
}

/**
 * Compute a statement of account for a single customer.
 *
 * Called from:
 *   · GET /customers/:id/statement (sync read)
 *   · Email flows (manual button + monthly cron) that render the same payload
 *     into an email body. Keeping this in one place means the email matches
 *     exactly what the user sees on-screen.
 *
 * Caller must already be inside a withTenant(...) transaction — every query
 * here relies on current_tenant_id() via RLS.
 */
export async function computeCustomerStatement(
  tx: Database,
  customerId: string,
  tenantId: string,
  range: { from: string; to: string },
): Promise<StatementData | null> {
  const { from, to } = range;
  const custRows = await tx
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.tenantId, tenantId),
        eq(schema.customers.id, customerId),
        isNull(schema.customers.deletedAt),
      ),
    )
    .limit(1);
  const customer = custRows[0];
  if (!customer) return null;

  const [openingRow] = (await tx.execute(sql`
    SELECT
      COALESCE((
        SELECT SUM(total_cents)
        FROM invoices
        WHERE tenant_id = current_tenant_id()
          AND customer_id = ${customer.id}
          AND deleted_at IS NULL
          AND status NOT IN ('draft','void')
          AND issue_date < ${from}::date
      ), 0)::bigint
      -
      COALESCE((
        SELECT SUM(amount_cents)
        FROM customer_payments
        WHERE tenant_id = current_tenant_id()
          AND customer_id = ${customer.id}
          AND deleted_at IS NULL
          AND status = 'posted'
          AND payment_date < ${from}::date
      ), 0)::bigint
      AS opening_cents
  `)) as unknown as Array<{ opening_cents: number | string }>;

  const openingBalanceCents = Number(openingRow?.opening_cents ?? 0);

  const invoices = (await tx.execute(sql`
    SELECT id, invoice_number, issue_date::text AS issue_date, due_date::text AS due_date,
           total_cents, status, reference, po_number
    FROM invoices
    WHERE tenant_id = current_tenant_id()
      AND customer_id = ${customer.id}
      AND deleted_at IS NULL
      AND status NOT IN ('draft','void')
      AND issue_date BETWEEN ${from}::date AND ${to}::date
  `)) as unknown as Array<{
    id: string;
    invoice_number: string | null;
    issue_date: string;
    due_date: string;
    total_cents: number | string;
    status: string;
    reference: string | null;
    po_number: string | null;
  }>;

  const payments = (await tx.execute(sql`
    SELECT id, payment_number, payment_date::text AS payment_date, amount_cents,
           method, reference, memo
    FROM customer_payments
    WHERE tenant_id = current_tenant_id()
      AND customer_id = ${customer.id}
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
    memo: string | null;
  }>;

  type MergedRow =
    | { kind: "invoice"; sortKey: string; date: string; row: (typeof invoices)[number] }
    | { kind: "payment"; sortKey: string; date: string; row: (typeof payments)[number] };

  const merged: MergedRow[] = [
    ...invoices.map<MergedRow>((r) => ({
      kind: "invoice",
      sortKey: `${r.issue_date}-0-${r.invoice_number ?? r.id}`,
      date: r.issue_date,
      row: r,
    })),
    ...payments.map<MergedRow>((r) => ({
      kind: "payment",
      sortKey: `${r.payment_date}-1-${r.payment_number ?? r.id}`,
      date: r.payment_date,
      row: r,
    })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  let running = openingBalanceCents;
  let totalBilled = 0;
  let totalReceived = 0;
  const transactions: StatementTransaction[] = merged.map((m) => {
    if (m.kind === "invoice") {
      const r = m.row;
      const debit = Number(r.total_cents);
      running += debit;
      totalBilled += debit;
      return {
        kind: "invoice",
        id: r.id,
        number: r.invoice_number,
        date: r.issue_date,
        dueDate: r.due_date,
        description:
          [r.reference, r.po_number ? `PO ${r.po_number}` : null]
            .filter(Boolean)
            .join(" · ") || "Invoice",
        debitCents: debit,
        creditCents: 0,
        runningBalanceCents: running,
      };
    }
    const r = m.row;
    const credit = Number(r.amount_cents);
    running -= credit;
    totalReceived += credit;
    return {
      kind: "payment",
      id: r.id,
      number: r.payment_number,
      date: r.payment_date,
      dueDate: null,
      description: [
        methodLabel(r.method),
        r.reference ? `Ref ${r.reference}` : null,
        r.memo,
      ]
        .filter(Boolean)
        .join(" · "),
      debitCents: 0,
      creditCents: credit,
      runningBalanceCents: running,
    };
  });

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
    FROM invoices
    WHERE tenant_id = current_tenant_id()
      AND customer_id = ${customer.id}
      AND deleted_at IS NULL
      AND status IN ('posted','partially_paid')
      AND issue_date <= ${to}::date
    GROUP BY bucket
  `)) as unknown as Array<{ bucket: BucketLabel; balance_cents: number | string; inv_count: number }>;

  const agingMap = new Map(agingRows.map((r) => [r.bucket, r]));
  const aging: StatementBucket[] = (
    ["current", "0-30", "30-60", "60-90", "90+"] as const
  ).map((b) => ({
    label: b,
    balanceCents: Number(agingMap.get(b)?.balance_cents ?? 0),
    invoiceCount: agingMap.get(b)?.inv_count ?? 0,
  }));

  return {
    customer,
    asOfFrom: from,
    asOfTo: to,
    openingBalanceCents,
    closingBalanceCents: running,
    totalBilledCents: totalBilled,
    totalReceivedCents: totalReceived,
    transactions,
    aging,
  };
}

export function defaultStatementRange(today: Date = new Date()): {
  from: string;
  to: string;
} {
  const to = today.toISOString().slice(0, 10);
  const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  return { from, to };
}

export const customerStatementRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /customers/:id/statement
  fastify.get<{ Params: { id: string } }>("/:id/statement", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const defaults = defaultStatementRange();
    const from = parsed.data.from ?? defaults.from;
    const to = parsed.data.to ?? defaults.to;

    const data = await withTenant(ctx.tenantId, (tx) =>
      computeCustomerStatement(tx, req.params.id, ctx.tenantId, { from, to }),
    );

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });
};

export function methodLabel(m: string): string {
  const map: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank transfer",
    cheque: "Cheque",
    card: "Card",
    lankaqr: "LankaQR",
    payhere: "PayHere",
    frimi: "FriMi",
    genie: "Genie",
    ipay: "iPay",
    other: "Other",
  };
  return map[m] ?? m;
}
