import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

interface AgingBucket {
  label: "current" | "0-30" | "30-60" | "60-90" | "90+";
  lowerDays: number;
  upperDays: number | null;
  balanceCents: number;
  invoiceCount: number;
}

interface DashboardPayload {
  cashPositionCents: number;
  cashByAccount: Array<{ code: string; name: string; balanceCents: number }>;
  arTotalCents: number;
  openInvoiceCount: number;
  overdueCents: number;
  overdueCount: number;
  apTotalCents: number;
  openBillCount: number;
  overdueBillsCents: number;
  overdueBillsCount: number;
  revenueThisMonthCents: number;
  revenueLastMonthCents: number;
  invoicesThisMonth: number;
  paymentsThisMonthCents: number;
  aging: AgingBucket[];
  apAging: AgingBucket[];
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string | null;
    customerName: string;
    totalCents: number;
    balanceDueCents: number;
    status: string;
    issueDate: string;
    dueDate: string;
  }>;
  recentPayments: Array<{
    id: string;
    paymentNumber: string | null;
    customerName: string;
    amountCents: number;
    method: string;
    paymentDate: string;
  }>;
  revenueSeries: Array<{ day: string; revenueCents: number }>;
}

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx): Promise<DashboardPayload> => {
      // -- Cash position: sum(dr − cr) on bank/cash accounts from posted journals
      const cashRows = (await tx.execute(sql`
        SELECT coa.id, coa.code, coa.name,
               COALESCE(SUM(jl.dr_cents - jl.cr_cents), 0)::bigint AS balance_cents
        FROM chart_of_accounts coa
        LEFT JOIN journal_lines jl ON jl.account_id = coa.id AND jl.tenant_id = coa.tenant_id
        WHERE coa.tenant_id = current_tenant_id()
          AND coa.deleted_at IS NULL
          AND coa.account_type = 'asset'
          AND coa.account_subtype IN ('cash', 'bank')
        GROUP BY coa.id, coa.code, coa.name
        ORDER BY coa.code
      `)) as unknown as Array<{ id: string; code: string; name: string; balance_cents: number | string }>;

      const cashByAccount = cashRows.map((r) => ({
        code: r.code,
        name: r.name,
        balanceCents: Number(r.balance_cents),
      }));
      const cashPositionCents = cashByAccount.reduce((s, a) => s + a.balanceCents, 0);

      // -- AR outstanding
      const [arStats] = (await tx.execute(sql`
        SELECT
          COALESCE(SUM(balance_due_cents), 0)::bigint AS ar_total_cents,
          COUNT(*) FILTER (WHERE status IN ('posted','partially_paid'))::int AS open_count,
          COALESCE(SUM(balance_due_cents) FILTER (WHERE due_date < current_date), 0)::bigint AS overdue_cents,
          COUNT(*) FILTER (WHERE status IN ('posted','partially_paid') AND due_date < current_date)::int AS overdue_count
        FROM invoices
        WHERE tenant_id = current_tenant_id()
          AND deleted_at IS NULL
          AND status IN ('posted','partially_paid')
      `)) as unknown as Array<{
        ar_total_cents: number | string;
        open_count: number;
        overdue_cents: number | string;
        overdue_count: number;
      }>;

      // -- Aging buckets
      const agingRows = (await tx.execute(sql`
        SELECT
          CASE
            WHEN due_date >= current_date            THEN 'current'
            WHEN current_date - due_date BETWEEN 1 AND 30   THEN '0-30'
            WHEN current_date - due_date BETWEEN 31 AND 60  THEN '30-60'
            WHEN current_date - due_date BETWEEN 61 AND 90  THEN '60-90'
            ELSE '90+'
          END AS bucket,
          COALESCE(SUM(balance_due_cents), 0)::bigint AS balance_cents,
          COUNT(*)::int AS inv_count
        FROM invoices
        WHERE tenant_id = current_tenant_id()
          AND deleted_at IS NULL
          AND status IN ('posted','partially_paid')
        GROUP BY bucket
      `)) as unknown as Array<{ bucket: AgingBucket["label"]; balance_cents: number | string; inv_count: number }>;

      const agingMap = new Map(agingRows.map((r) => [r.bucket, r]));
      const aging: AgingBucket[] = [
        { label: "current", lowerDays: 0, upperDays: 0, balanceCents: 0, invoiceCount: 0 },
        { label: "0-30", lowerDays: 1, upperDays: 30, balanceCents: 0, invoiceCount: 0 },
        { label: "30-60", lowerDays: 31, upperDays: 60, balanceCents: 0, invoiceCount: 0 },
        { label: "60-90", lowerDays: 61, upperDays: 90, balanceCents: 0, invoiceCount: 0 },
        { label: "90+", lowerDays: 91, upperDays: null, balanceCents: 0, invoiceCount: 0 },
      ].map((b) => {
        const row = agingMap.get(b.label);
        return row
          ? { ...b, balanceCents: Number(row.balance_cents), invoiceCount: row.inv_count }
          : b;
      });

      // -- AP outstanding
      const [apStats] = (await tx.execute(sql`
        SELECT
          COALESCE(SUM(balance_due_cents), 0)::bigint AS ap_total_cents,
          COUNT(*) FILTER (WHERE status IN ('posted','partially_paid'))::int AS open_count,
          COALESCE(SUM(balance_due_cents) FILTER (WHERE due_date < current_date), 0)::bigint AS overdue_cents,
          COUNT(*) FILTER (WHERE status IN ('posted','partially_paid') AND due_date < current_date)::int AS overdue_count
        FROM bills
        WHERE tenant_id = current_tenant_id()
          AND deleted_at IS NULL
          AND status IN ('posted','partially_paid')
      `)) as unknown as Array<{
        ap_total_cents: number | string;
        open_count: number;
        overdue_cents: number | string;
        overdue_count: number;
      }>;

      // -- AP aging buckets
      const apAgingRows = (await tx.execute(sql`
        SELECT
          CASE
            WHEN due_date >= current_date            THEN 'current'
            WHEN current_date - due_date BETWEEN 1 AND 30   THEN '0-30'
            WHEN current_date - due_date BETWEEN 31 AND 60  THEN '30-60'
            WHEN current_date - due_date BETWEEN 61 AND 90  THEN '60-90'
            ELSE '90+'
          END AS bucket,
          COALESCE(SUM(balance_due_cents), 0)::bigint AS balance_cents,
          COUNT(*)::int AS inv_count
        FROM bills
        WHERE tenant_id = current_tenant_id()
          AND deleted_at IS NULL
          AND status IN ('posted','partially_paid')
        GROUP BY bucket
      `)) as unknown as Array<{ bucket: AgingBucket["label"]; balance_cents: number | string; inv_count: number }>;

      const apAgingMap = new Map(apAgingRows.map((r) => [r.bucket, r]));
      const apAging: AgingBucket[] = [
        { label: "current", lowerDays: 0, upperDays: 0, balanceCents: 0, invoiceCount: 0 },
        { label: "0-30", lowerDays: 1, upperDays: 30, balanceCents: 0, invoiceCount: 0 },
        { label: "30-60", lowerDays: 31, upperDays: 60, balanceCents: 0, invoiceCount: 0 },
        { label: "60-90", lowerDays: 61, upperDays: 90, balanceCents: 0, invoiceCount: 0 },
        { label: "90+", lowerDays: 91, upperDays: null, balanceCents: 0, invoiceCount: 0 },
      ].map((b) => {
        const row = apAgingMap.get(b.label);
        return row
          ? { ...b, balanceCents: Number(row.balance_cents), invoiceCount: row.inv_count }
          : b;
      });

      // -- Revenue & invoice counts this/last month (posted only)
      const [revStats] = (await tx.execute(sql`
        SELECT
          COALESCE(SUM(subtotal_cents) FILTER (
            WHERE issue_date >= date_trunc('month', current_date)
              AND issue_date < date_trunc('month', current_date) + interval '1 month'
          ), 0)::bigint AS rev_this_month,
          COALESCE(SUM(subtotal_cents) FILTER (
            WHERE issue_date >= date_trunc('month', current_date) - interval '1 month'
              AND issue_date < date_trunc('month', current_date)
          ), 0)::bigint AS rev_last_month,
          COUNT(*) FILTER (
            WHERE issue_date >= date_trunc('month', current_date)
          )::int AS invoices_this_month
        FROM invoices
        WHERE tenant_id = current_tenant_id()
          AND status <> 'draft'
          AND deleted_at IS NULL
      `)) as unknown as Array<{
        rev_this_month: number | string;
        rev_last_month: number | string;
        invoices_this_month: number;
      }>;

      // -- Payments collected this month
      const [payStats] = (await tx.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0)::bigint AS paid_this_month
        FROM customer_payments
        WHERE tenant_id = current_tenant_id()
          AND status = 'posted'
          AND deleted_at IS NULL
          AND payment_date >= date_trunc('month', current_date)
      `)) as unknown as Array<{ paid_this_month: number | string }>;

      // -- 14-day revenue sparkline (posted invoices)
      const seriesRows = (await tx.execute(sql`
        WITH days AS (
          SELECT (current_date - i)::date AS day
          FROM generate_series(0, 13) AS s(i)
        )
        SELECT d.day::text AS day,
               COALESCE(SUM(inv.subtotal_cents), 0)::bigint AS revenue_cents
        FROM days d
        LEFT JOIN invoices inv
          ON inv.tenant_id = current_tenant_id()
         AND inv.status <> 'draft'
         AND inv.deleted_at IS NULL
         AND inv.issue_date = d.day
        GROUP BY d.day
        ORDER BY d.day ASC
      `)) as unknown as Array<{ day: string; revenue_cents: number | string }>;

      const revenueSeries = seriesRows.map((r) => ({
        day: r.day,
        revenueCents: Number(r.revenue_cents),
      }));

      // -- Recent invoices (5)
      const recentInvoices = (await tx.execute(sql`
        SELECT inv.id, inv.invoice_number, c.name AS customer_name,
               inv.total_cents, inv.balance_due_cents, inv.status,
               inv.issue_date, inv.due_date
        FROM invoices inv
        JOIN customers c ON c.id = inv.customer_id
        WHERE inv.tenant_id = current_tenant_id()
          AND inv.deleted_at IS NULL
        ORDER BY inv.created_at DESC
        LIMIT 5
      `)) as unknown as Array<{
        id: string;
        invoice_number: string | null;
        customer_name: string;
        total_cents: number | string;
        balance_due_cents: number | string;
        status: string;
        issue_date: string;
        due_date: string;
      }>;

      // -- Recent payments (5)
      const recentPayments = (await tx.execute(sql`
        SELECT p.id, p.payment_number, c.name AS customer_name,
               p.amount_cents, p.method, p.payment_date
        FROM customer_payments p
        JOIN customers c ON c.id = p.customer_id
        WHERE p.tenant_id = current_tenant_id()
          AND p.deleted_at IS NULL
          AND p.status = 'posted'
        ORDER BY p.created_at DESC
        LIMIT 5
      `)) as unknown as Array<{
        id: string;
        payment_number: string | null;
        customer_name: string;
        amount_cents: number | string;
        method: string;
        payment_date: string;
      }>;

      return {
        cashPositionCents,
        cashByAccount,
        arTotalCents: Number(arStats?.ar_total_cents ?? 0),
        openInvoiceCount: Number(arStats?.open_count ?? 0),
        overdueCents: Number(arStats?.overdue_cents ?? 0),
        overdueCount: Number(arStats?.overdue_count ?? 0),
        apTotalCents: Number(apStats?.ap_total_cents ?? 0),
        openBillCount: Number(apStats?.open_count ?? 0),
        overdueBillsCents: Number(apStats?.overdue_cents ?? 0),
        overdueBillsCount: Number(apStats?.overdue_count ?? 0),
        revenueThisMonthCents: Number(revStats?.rev_this_month ?? 0),
        revenueLastMonthCents: Number(revStats?.rev_last_month ?? 0),
        invoicesThisMonth: Number(revStats?.invoices_this_month ?? 0),
        paymentsThisMonthCents: Number(payStats?.paid_this_month ?? 0),
        aging,
        apAging,
        recentInvoices: recentInvoices.map((r) => ({
          id: r.id,
          invoiceNumber: r.invoice_number,
          customerName: r.customer_name,
          totalCents: Number(r.total_cents),
          balanceDueCents: Number(r.balance_due_cents),
          status: r.status,
          issueDate: r.issue_date,
          dueDate: r.due_date,
        })),
        recentPayments: recentPayments.map((r) => ({
          id: r.id,
          paymentNumber: r.payment_number,
          customerName: r.customer_name,
          amountCents: Number(r.amount_cents),
          method: r.method,
          paymentDate: r.payment_date,
        })),
        revenueSeries,
      };
    });

    return reply.send(data);
  });
};
