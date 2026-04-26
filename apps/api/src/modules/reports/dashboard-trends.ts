import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

/**
 * Rolling 12-month trend report (#135 / gaps B5).
 *
 * Pairs with the executive KPI dashboard (#129): KPIs are point-in-
 * time snapshots; this is the time-series story behind them. Returns
 * monthly aggregates for the last N months (default 12) covering:
 *
 *   * Revenue — sum of posted invoices issued that month
 *   * Expenses — sum of debits to expense accounts
 *   * COGS — sum of debits to COGS-tagged accounts (separate from
 *     expenses since gross-margin trend is a different cut)
 *   * Cash flow in / out — debits / credits to bank+cash accounts
 *   * Net cash — flow_in − flow_out
 *   * Invoice count / Payment count — activity volume signals
 *   * AR / AP balance at month-end — running balances per spec B5
 *
 * Month-over-month deltas computed inline so the UI doesn't have to
 * walk the array. Empty months render as 0, not gaps — keeps the
 * sparklines smooth.
 *
 * All queries scoped via withTenant + RLS.
 */

const QuerySchema = z.object({
  months: z.coerce.number().int().min(3).max(36).default(12),
});

interface MonthRow {
  monthStart: string;
  revenueCents: number;
  cogsCents: number;
  expensesCents: number;
  cashInCents: number;
  cashOutCents: number;
  netCashCents: number;
  invoiceCount: number;
  paymentCount: number;
  // Month-end snapshot — running balance through the last day of
  // this month. Useful for AR/AP trend even though revenue/expense
  // are flow numbers.
  arBalanceCents: number;
  apBalanceCents: number;
}

interface TrendPayload {
  months: MonthRow[];
  deltas: {
    // MoM percentage change for the last vs prior month. Null when
    // there's no prior data or prior was zero.
    revenuePct: number | null;
    expensesPct: number | null;
    cogsPct: number | null;
    netCashPct: number | null;
  };
}

export const dashboardTrendsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const months = parsed.data.months;

    const data = await withTenant(ctx.tenantId, async (tx): Promise<TrendPayload> => {
      // One trip pulls the per-month aggregates. The months CTE
      // generates the calendar so empty months still get a row at 0.
      // The journal-line aggregates filter by je.entry_date, which
      // is the canonical "money moved in this month" timestamp.
      const rows = (await tx.execute(sql`
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', CURRENT_DATE - (${months - 1} || ' months')::interval),
            date_trunc('month', CURRENT_DATE),
            interval '1 month'
          )::date AS month_start
        )
        SELECT
          m.month_start,
          (m.month_start + interval '1 month' - interval '1 day')::date AS month_end,
          -- Revenue: invoices issued in month
          COALESCE((
            SELECT SUM(i.total_cents)::bigint
            FROM invoices i
            WHERE i.tenant_id = current_tenant_id()
              AND i.deleted_at IS NULL
              AND i.status IN ('posted', 'partially_paid', 'paid')
              AND date_trunc('month', i.issue_date)::date = m.month_start
          ), 0)::bigint AS revenue_cents,
          -- COGS: debits to cogs-tagged accounts (subtype) plus
          -- 5xxx fallback for tenants with un-tagged CoA
          COALESCE((
            SELECT SUM(jl.dr_cents - jl.cr_cents)::bigint
            FROM journal_lines jl
            JOIN journal_entries je ON je.id = jl.journal_entry_id
            JOIN chart_of_accounts coa ON coa.id = jl.account_id
            WHERE jl.tenant_id = current_tenant_id()
              AND je.tenant_id = current_tenant_id()
              AND coa.tenant_id = current_tenant_id()
              AND je.status = 'posted'
              AND date_trunc('month', je.entry_date)::date = m.month_start
              AND (
                coa.account_subtype = 'cogs'
                OR (coa.account_type = 'expense' AND coa.code LIKE '50%')
              )
          ), 0)::bigint AS cogs_cents,
          -- Other expenses: all expense accounts NOT tagged cogs
          COALESCE((
            SELECT SUM(jl.dr_cents - jl.cr_cents)::bigint
            FROM journal_lines jl
            JOIN journal_entries je ON je.id = jl.journal_entry_id
            JOIN chart_of_accounts coa ON coa.id = jl.account_id
            WHERE jl.tenant_id = current_tenant_id()
              AND je.tenant_id = current_tenant_id()
              AND coa.tenant_id = current_tenant_id()
              AND je.status = 'posted'
              AND date_trunc('month', je.entry_date)::date = m.month_start
              AND coa.account_type = 'expense'
              AND coa.account_subtype IS DISTINCT FROM 'cogs'
              AND NOT (coa.code LIKE '50%')
          ), 0)::bigint AS expenses_cents,
          -- Cash inflow: debits to bank/cash in month
          COALESCE((
            SELECT SUM(jl.dr_cents)::bigint
            FROM journal_lines jl
            JOIN journal_entries je ON je.id = jl.journal_entry_id
            JOIN chart_of_accounts coa ON coa.id = jl.account_id
            WHERE jl.tenant_id = current_tenant_id()
              AND je.tenant_id = current_tenant_id()
              AND coa.tenant_id = current_tenant_id()
              AND je.status = 'posted'
              AND date_trunc('month', je.entry_date)::date = m.month_start
              AND coa.account_type = 'asset'
              AND coa.account_subtype IN ('cash', 'bank')
          ), 0)::bigint AS cash_in_cents,
          -- Cash outflow: credits to bank/cash in month
          COALESCE((
            SELECT SUM(jl.cr_cents)::bigint
            FROM journal_lines jl
            JOIN journal_entries je ON je.id = jl.journal_entry_id
            JOIN chart_of_accounts coa ON coa.id = jl.account_id
            WHERE jl.tenant_id = current_tenant_id()
              AND je.tenant_id = current_tenant_id()
              AND coa.tenant_id = current_tenant_id()
              AND je.status = 'posted'
              AND date_trunc('month', je.entry_date)::date = m.month_start
              AND coa.account_type = 'asset'
              AND coa.account_subtype IN ('cash', 'bank')
          ), 0)::bigint AS cash_out_cents,
          -- Activity counts
          COALESCE((
            SELECT COUNT(*)::int
            FROM invoices i
            WHERE i.tenant_id = current_tenant_id()
              AND i.deleted_at IS NULL
              AND i.status IN ('posted', 'partially_paid', 'paid')
              AND date_trunc('month', i.issue_date)::date = m.month_start
          ), 0)::int AS invoice_count,
          COALESCE((
            SELECT COUNT(*)::int
            FROM customer_payments cp
            WHERE cp.tenant_id = current_tenant_id()
              AND cp.deleted_at IS NULL
              AND date_trunc('month', cp.payment_date)::date = m.month_start
          ), 0)::int AS payment_count,
          -- AR balance at month-end: outstanding on posted invoices
          -- whose issue_date <= month_end. Approximation — true
          -- point-in-time AR would need a snapshot of paid_cents AS
          -- OF month_end which we don't track. v1: balance-as-of-now
          -- for the latest month, then naive lookback for prior
          -- months (issue_date <= month_end and status currently
          -- non-paid). Good enough for trend signal.
          COALESCE((
            SELECT SUM(i.total_cents - i.amount_paid_cents)::bigint
            FROM invoices i
            WHERE i.tenant_id = current_tenant_id()
              AND i.deleted_at IS NULL
              AND i.status IN ('posted', 'partially_paid')
              AND i.issue_date <= (m.month_start + interval '1 month' - interval '1 day')::date
          ), 0)::bigint AS ar_balance_cents,
          COALESCE((
            SELECT SUM(b.total_cents - b.amount_paid_cents)::bigint
            FROM bills b
            WHERE b.tenant_id = current_tenant_id()
              AND b.deleted_at IS NULL
              AND b.status IN ('posted', 'partially_paid')
              AND b.bill_date <= (m.month_start + interval '1 month' - interval '1 day')::date
          ), 0)::bigint AS ap_balance_cents
        FROM months m
        ORDER BY m.month_start
      `)) as unknown as Array<{
        month_start: Date | string;
        month_end: Date | string;
        revenue_cents: number | string;
        cogs_cents: number | string;
        expenses_cents: number | string;
        cash_in_cents: number | string;
        cash_out_cents: number | string;
        invoice_count: number;
        payment_count: number;
        ar_balance_cents: number | string;
        ap_balance_cents: number | string;
      }>;

      const monthsOut: MonthRow[] = rows.map((r) => {
        const cashIn = Number(r.cash_in_cents);
        const cashOut = Number(r.cash_out_cents);
        return {
          monthStart:
            r.month_start instanceof Date
              ? r.month_start.toISOString().slice(0, 10)
              : String(r.month_start).slice(0, 10),
          revenueCents: Number(r.revenue_cents),
          cogsCents: Number(r.cogs_cents),
          expensesCents: Number(r.expenses_cents),
          cashInCents: cashIn,
          cashOutCents: cashOut,
          netCashCents: cashIn - cashOut,
          invoiceCount: r.invoice_count,
          paymentCount: r.payment_count,
          arBalanceCents: Number(r.ar_balance_cents),
          apBalanceCents: Number(r.ap_balance_cents),
        };
      });

      // MoM deltas — last vs previous-to-last. Null when prior was
      // zero (avoid Infinity) or when we have <2 months of data.
      function mom(current: number, prior: number): number | null {
        if (monthsOut.length < 2) return null;
        if (prior === 0) return null;
        return (current - prior) / Math.abs(prior);
      }
      const last = monthsOut[monthsOut.length - 1];
      const prior = monthsOut[monthsOut.length - 2];

      const deltas = {
        revenuePct: last && prior ? mom(last.revenueCents, prior.revenueCents) : null,
        expensesPct:
          last && prior ? mom(last.expensesCents, prior.expensesCents) : null,
        cogsPct: last && prior ? mom(last.cogsCents, prior.cogsCents) : null,
        netCashPct:
          last && prior ? mom(last.netCashCents, prior.netCashCents) : null,
      };

      return { months: monthsOut, deltas };
    });

    return reply.send(data);
  });
};
