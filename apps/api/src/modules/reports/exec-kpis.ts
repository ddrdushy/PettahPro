import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { withTenant } from "@pettahpro/db";
import { z } from "zod";
import { requireAuth } from "../../lib/with-tenant.js";

/**
 * Executive KPI dashboard (#129 / gaps G1).
 *
 * The /dashboard route gives "what's happening today" — recent docs,
 * AR/AP, cash position. This route gives "how is the business doing"
 * — five SME-relevant operating ratios that matter for the owner who
 * wants to know whether collections are slipping or margins compressing.
 *
 *   * DSO — Days Sales Outstanding = AR / avg-daily-sales-in-period.
 *           "How many days of sales are tied up in unpaid invoices?"
 *           Higher = collections slipping.
 *
 *   * DPO — Days Payables Outstanding = AP / avg-daily-purchases.
 *           "How many days of purchases are we sitting on as AP?"
 *           Higher = stretching suppliers (good for cash, bad for
 *           supplier relationships).
 *
 *   * Gross margin % — (Revenue − COGS) / Revenue × 100.
 *
 *   * Inventory turns — COGS in period / avg-inventory-value.
 *           Annualized to a 12-month equivalent so the number is
 *           comparable across whatever window the user picked.
 *
 *   * Cash runway — cash-on-hand ÷ avg-monthly-net-outflow over the
 *           last 90 days. Months until cash runs out at the current
 *           burn rate. ∞ when net flow is positive.
 *
 * Plus a 6-month revenue + gross-margin trend for sparklines.
 *
 * All math is back-of-the-envelope SME accounting — not GAAP. The
 * intent is "directional credibility on a one-page dashboard," not a
 * fund-grade analysis.
 */

interface KpiPayload {
  period: { from: string; to: string; days: number };
  dso: { days: number | null; arCents: number; salesCents: number };
  dpo: { days: number | null; apCents: number; purchasesCents: number };
  grossMargin: {
    percentBps: number | null; // basis points; null if revenue=0
    revenueCents: number;
    cogsCents: number;
  };
  inventoryTurns: {
    annualized: number | null;
    cogsCents: number;
    avgInventoryCents: number;
  };
  cashRunway: {
    months: number | null; // null = infinite (positive net flow)
    cashCents: number;
    netMonthlyOutflowCents: number; // negative = cash growing
  };
  trend: Array<{
    monthStart: string;
    revenueCents: number;
    cogsCents: number;
    grossMarginBps: number | null;
  }>;
}

const QuerySchema = z.object({
  // Default window: last 90 days. The DSO/DPO formulas need a
  // window long enough that one fat invoice doesn't dominate.
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const execKpiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const to = parsed.data.to ?? new Date().toISOString().slice(0, 10);
    const from =
      parsed.data.from ??
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const days = Math.max(
      1,
      Math.round(
        (new Date(to).getTime() - new Date(from).getTime()) /
          (24 * 60 * 60 * 1000),
      ) + 1,
    );

    const payload = await withTenant(ctx.tenantId, async (tx): Promise<KpiPayload> => {
      // Revenue + COGS in window. Revenue from posted invoices
      // (issue_date in window). COGS from journal lines posted in
      // window against a COGS account (account_subtype='cogs' if
      // we have it; fall back to account_type='expense' AND
      // account_code starting '5' which is the SL CoA convention).
      const revenueRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(total_cents), 0)::bigint AS revenue_cents
        FROM invoices
        WHERE tenant_id = current_tenant_id()
          AND deleted_at IS NULL
          AND status IN ('posted', 'partially_paid', 'paid')
          AND issue_date >= ${from}::date
          AND issue_date <= ${to}::date
      `)) as unknown as Array<{ revenue_cents: number | string }>;
      const revenueCents = Number(revenueRows[0]?.revenue_cents ?? 0);

      // COGS — sum of debits to COGS accounts in window. We treat
      // any account whose subtype is 'cogs' as COGS; fall back to
      // accounts in the 5xxx range whose name contains "Cost of"
      // for tenants that haven't tagged subtypes yet.
      const cogsRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(jl.dr_cents - jl.cr_cents), 0)::bigint AS cogs_cents
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        JOIN chart_of_accounts coa ON coa.id = jl.account_id
        WHERE jl.tenant_id = current_tenant_id()
          AND je.tenant_id = current_tenant_id()
          AND coa.tenant_id = current_tenant_id()
          AND je.status = 'posted'
          AND je.entry_date >= ${from}::date
          AND je.entry_date <= ${to}::date
          AND (
            coa.account_subtype = 'cogs'
            OR (coa.account_type = 'expense' AND coa.code LIKE '50%')
          )
      `)) as unknown as Array<{ cogs_cents: number | string }>;
      const cogsCents = Number(cogsRows[0]?.cogs_cents ?? 0);

      // AR balance — outstanding on posted/partially-paid invoices
      // (across all time, not just window). Same query the dashboard
      // uses minus the per-bucket aging.
      const arRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(total_cents - amount_paid_cents), 0)::bigint AS ar_cents
        FROM invoices
        WHERE tenant_id = current_tenant_id()
          AND deleted_at IS NULL
          AND status IN ('posted', 'partially_paid')
      `)) as unknown as Array<{ ar_cents: number | string }>;
      const arCents = Number(arRows[0]?.ar_cents ?? 0);

      // AP balance — outstanding on posted/partially-paid bills.
      const apRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(total_cents - amount_paid_cents), 0)::bigint AS ap_cents
        FROM bills
        WHERE tenant_id = current_tenant_id()
          AND deleted_at IS NULL
          AND status IN ('posted', 'partially_paid')
      `)) as unknown as Array<{ ap_cents: number | string }>;
      const apCents = Number(apRows[0]?.ap_cents ?? 0);

      // Purchases in window — total of posted bills issued in window.
      const purchaseRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(total_cents), 0)::bigint AS purchases_cents
        FROM bills
        WHERE tenant_id = current_tenant_id()
          AND deleted_at IS NULL
          AND status IN ('posted', 'partially_paid', 'paid')
          AND bill_date >= ${from}::date
          AND bill_date <= ${to}::date
      `)) as unknown as Array<{ purchases_cents: number | string }>;
      const purchasesCents = Number(purchaseRows[0]?.purchases_cents ?? 0);

      // DSO + DPO. Avoid divide-by-zero — null means "no sales /
      // purchases in window, ratio undefined."
      const dso =
        revenueCents > 0 ? (arCents / revenueCents) * days : null;
      const dpo =
        purchasesCents > 0 ? (apCents / purchasesCents) * days : null;

      // Inventory value — sum of (qty × wavg_cost) across all items.
      // Approximation: pull the latest inventory adjustment/ledger
      // running balance. Cheaper proxy: stock-on-hand × wavg.
      const invRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(ib.qty_on_hand * ib.weighted_avg_cost_cents), 0)::bigint AS inv_cents
        FROM item_balances ib
        WHERE ib.tenant_id = current_tenant_id()
      `)) as unknown as Array<{ inv_cents: number | string }>;
      const inventoryNowCents = Number(invRows[0]?.inv_cents ?? 0);
      // Avg inventory v1: just current value. A proper average would
      // pull mid-period valuations; for SMEs the noise is acceptable
      // and "now" is a reasonable proxy on a 90-day window.
      const avgInventoryCents = inventoryNowCents;
      const inventoryTurnsAnnualized =
        avgInventoryCents > 0
          ? ((cogsCents / avgInventoryCents) * 365) / days
          : null;

      // Cash position — sum across all bank/cash accounts.
      const cashRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(jl.dr_cents - jl.cr_cents), 0)::bigint AS cash_cents
        FROM journal_lines jl
        JOIN chart_of_accounts coa ON coa.id = jl.account_id
        WHERE jl.tenant_id = current_tenant_id()
          AND coa.tenant_id = current_tenant_id()
          AND coa.deleted_at IS NULL
          AND coa.account_type = 'asset'
          AND coa.account_subtype IN ('cash', 'bank')
      `)) as unknown as Array<{ cash_cents: number | string }>;
      const cashCents = Number(cashRows[0]?.cash_cents ?? 0);

      // Cash runway — last 90 days of cash net flow, divided by 3.
      // Negative net = cash growing; runway = ∞ (return null).
      const burnRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(jl.dr_cents - jl.cr_cents), 0)::bigint AS net_flow_cents
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        JOIN chart_of_accounts coa ON coa.id = jl.account_id
        WHERE jl.tenant_id = current_tenant_id()
          AND je.tenant_id = current_tenant_id()
          AND coa.tenant_id = current_tenant_id()
          AND je.status = 'posted'
          AND je.entry_date >= (CURRENT_DATE - interval '90 days')
          AND coa.account_type = 'asset'
          AND coa.account_subtype IN ('cash', 'bank')
      `)) as unknown as Array<{ net_flow_cents: number | string }>;
      const netFlow90 = Number(burnRows[0]?.net_flow_cents ?? 0);
      // netFlow > 0 = cash growing (no burn). Convert outflow to
      // monthly. Three months in window.
      const netMonthlyOutflow = -netFlow90 / 3; // positive = burn
      const runwayMonths =
        netMonthlyOutflow > 0
          ? cashCents / netMonthlyOutflow
          : null;

      // Trend — last 6 months of revenue + COGS, grouped by month.
      const trendRows = (await tx.execute(sql`
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', CURRENT_DATE - interval '5 months'),
            date_trunc('month', CURRENT_DATE),
            interval '1 month'
          )::date AS month_start
        )
        SELECT
          m.month_start,
          COALESCE(SUM(CASE
            WHEN i.id IS NOT NULL THEN i.total_cents ELSE 0
          END), 0)::bigint AS revenue_cents,
          COALESCE(SUM(CASE
            WHEN je.id IS NOT NULL AND coa.account_subtype = 'cogs'
            THEN jl.dr_cents - jl.cr_cents ELSE 0
          END), 0)::bigint AS cogs_cents
        FROM months m
        LEFT JOIN invoices i
          ON i.tenant_id = current_tenant_id()
          AND i.deleted_at IS NULL
          AND i.status IN ('posted', 'partially_paid', 'paid')
          AND date_trunc('month', i.issue_date) = m.month_start
        LEFT JOIN journal_entries je
          ON je.tenant_id = current_tenant_id()
          AND je.status = 'posted'
          AND date_trunc('month', je.entry_date) = m.month_start
        LEFT JOIN journal_lines jl
          ON jl.journal_entry_id = je.id
          AND jl.tenant_id = current_tenant_id()
        LEFT JOIN chart_of_accounts coa
          ON coa.id = jl.account_id
          AND coa.tenant_id = current_tenant_id()
        GROUP BY m.month_start
        ORDER BY m.month_start
      `)) as unknown as Array<{
        month_start: string | Date;
        revenue_cents: number | string;
        cogs_cents: number | string;
      }>;

      const trend = trendRows.map((row) => {
        const r = Number(row.revenue_cents);
        const c = Number(row.cogs_cents);
        const grossMarginBps = r > 0 ? Math.round(((r - c) / r) * 10000) : null;
        const monthStart =
          row.month_start instanceof Date
            ? row.month_start.toISOString().slice(0, 10)
            : String(row.month_start).slice(0, 10);
        return {
          monthStart,
          revenueCents: r,
          cogsCents: c,
          grossMarginBps,
        };
      });

      const grossMarginBps =
        revenueCents > 0
          ? Math.round(((revenueCents - cogsCents) / revenueCents) * 10000)
          : null;

      return {
        period: { from, to, days },
        dso: {
          days: dso !== null ? Math.round(dso) : null,
          arCents,
          salesCents: revenueCents,
        },
        dpo: {
          days: dpo !== null ? Math.round(dpo) : null,
          apCents,
          purchasesCents,
        },
        grossMargin: {
          percentBps: grossMarginBps,
          revenueCents,
          cogsCents,
        },
        inventoryTurns: {
          annualized:
            inventoryTurnsAnnualized !== null
              ? Math.round(inventoryTurnsAnnualized * 100) / 100
              : null,
          cogsCents,
          avgInventoryCents,
        },
        cashRunway: {
          months:
            runwayMonths !== null
              ? Math.round(runwayMonths * 10) / 10
              : null,
          cashCents,
          netMonthlyOutflowCents: Math.round(netMonthlyOutflow),
        },
        trend,
      };
    });

    return reply.send(payload);
  });
};
