import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

/**
 * Budget vs actual report (#133 / gaps B2).
 *
 * Picks an active budget for the requested fiscal_year, joins each
 * budget_line to the corresponding journal_lines posted in the user's
 * date window, and returns a per-line {budgeted, actual, variance}
 * triple.
 *
 * Math notes:
 *   * Budgeted is annual. The report prorates the annual figure by
 *     (windowDays / 365) so a Jan-Mar window compares 3-month
 *     actuals to 3-month-equivalent budget. Tenants who want exact
 *     monthly figures can split into 12 budgets — out of scope v1.
 *   * Actuals: for income accounts, sum(cr − dr); for expense, sum(dr
 *     − cr). Same convention as the P&L.
 *   * cost_center_id on the budget_line filters the actuals join to
 *     only that center's lines (or NULL for "Unassigned"). Lines
 *     without a center match across all centers.
 */

const QuerySchema = z.object({
  budgetId: z.string().uuid().optional(),
  fiscalYear: z.coerce.number().int().min(2000).max(2100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

interface ReportLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  costCenterId: string | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  budgetedAnnualCents: number;
  budgetedProratedCents: number;
  actualCents: number;
  varianceCents: number;
  // % of prorated budget consumed; null when the budget line is 0
  // (avoids divide-by-zero).
  pctConsumed: number | null;
}

interface ReportPayload {
  budget: {
    id: string;
    name: string;
    fiscalYear: number;
    status: string;
  };
  period: { from: string; to: string; days: number };
  lines: ReportLine[];
  totals: {
    budgetedAnnualCents: number;
    budgetedProratedCents: number;
    actualCents: number;
    varianceCents: number;
  };
}

export const budgetVsActualRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const today = new Date();
    const yearForDefault = today.getUTCFullYear();
    const fiscalYear = parsed.data.fiscalYear ?? yearForDefault;
    const from =
      parsed.data.from ?? `${fiscalYear}-01-01`;
    const to = parsed.data.to ?? `${fiscalYear}-12-31`;
    const days = Math.max(
      1,
      Math.round(
        (new Date(to).getTime() - new Date(from).getTime()) /
          (24 * 60 * 60 * 1000),
      ) + 1,
    );

    const data = await withTenant(ctx.tenantId, async (tx): Promise<ReportPayload | null> => {
      // Resolve budget — explicit id, or the active budget for the
      // fiscal year.
      const budgetRows = parsed.data.budgetId
        ? ((await tx.execute(sql`
            SELECT id, name, fiscal_year, status
              FROM budgets
             WHERE id = ${parsed.data.budgetId}::uuid
               AND tenant_id = current_tenant_id()
               AND deleted_at IS NULL
             LIMIT 1
          `)) as unknown as Array<{
            id: string;
            name: string;
            fiscal_year: number;
            status: string;
          }>)
        : ((await tx.execute(sql`
            SELECT id, name, fiscal_year, status
              FROM budgets
             WHERE tenant_id = current_tenant_id()
               AND fiscal_year = ${fiscalYear}
               AND status = 'active'
               AND deleted_at IS NULL
             LIMIT 1
          `)) as unknown as Array<{
            id: string;
            name: string;
            fiscal_year: number;
            status: string;
          }>);
      const budget = budgetRows[0];
      if (!budget) return null;

      // Pull lines + per-line actuals in one query. The LEFT JOIN to
      // journal_lines respects the cost_center_id constraint:
      //   * line has cost_center: filter actuals to that center
      //   * line has NULL cost_center: include every actual for the
      //     account (any center + unassigned)
      // The CASE in the SELECT applies the income/expense sign
      // convention.
      const rows = (await tx.execute(sql`
        SELECT
          bl.id,
          bl.account_id,
          coa.code AS account_code,
          coa.name AS account_name,
          coa.account_type,
          bl.cost_center_id,
          cc.code AS cost_center_code,
          cc.name AS cost_center_name,
          bl.amount_cents AS budgeted_annual_cents,
          COALESCE(SUM(
            CASE
              WHEN coa.account_type = 'income' THEN jl.cr_cents - jl.dr_cents
              ELSE jl.dr_cents - jl.cr_cents
            END
          ), 0)::bigint AS actual_cents
        FROM budget_lines bl
        JOIN chart_of_accounts coa
          ON coa.id = bl.account_id
         AND coa.tenant_id = bl.tenant_id
        LEFT JOIN cost_centers cc
          ON cc.id = bl.cost_center_id
         AND cc.tenant_id = bl.tenant_id
        LEFT JOIN journal_lines jl
          ON jl.account_id = bl.account_id
         AND jl.tenant_id = bl.tenant_id
         AND (
           bl.cost_center_id IS NULL
           OR jl.cost_center_id = bl.cost_center_id
         )
        LEFT JOIN journal_entries je
          ON je.id = jl.journal_entry_id
         AND je.tenant_id = bl.tenant_id
         AND je.entry_date >= ${from}::date
         AND je.entry_date <= ${to}::date
         AND je.status = 'posted'
        WHERE bl.budget_id = ${budget.id}::uuid
          AND bl.tenant_id = current_tenant_id()
        GROUP BY bl.id, bl.account_id, coa.code, coa.name, coa.account_type,
                 bl.cost_center_id, cc.code, cc.name, bl.amount_cents
        ORDER BY coa.code, cc.code NULLS FIRST
      `)) as unknown as Array<{
        id: string;
        account_id: string;
        account_code: string;
        account_name: string;
        account_type: string;
        cost_center_id: string | null;
        cost_center_code: string | null;
        cost_center_name: string | null;
        budgeted_annual_cents: number | string;
        actual_cents: number | string;
      }>;

      const proratedFactor = days / 365;
      const lines: ReportLine[] = rows.map((r) => {
        const budgetedAnnual = Number(r.budgeted_annual_cents);
        const budgetedProrated = Math.round(budgetedAnnual * proratedFactor);
        const actual = Number(r.actual_cents);
        const variance = budgetedProrated - actual;
        const pctConsumed =
          budgetedProrated > 0 ? actual / budgetedProrated : null;
        return {
          accountId: r.account_id,
          accountCode: r.account_code,
          accountName: r.account_name,
          costCenterId: r.cost_center_id,
          costCenterCode: r.cost_center_code,
          costCenterName: r.cost_center_name,
          budgetedAnnualCents: budgetedAnnual,
          budgetedProratedCents: budgetedProrated,
          actualCents: actual,
          varianceCents: variance,
          pctConsumed,
        };
      });

      const totals = lines.reduce(
        (s, l) => ({
          budgetedAnnualCents: s.budgetedAnnualCents + l.budgetedAnnualCents,
          budgetedProratedCents:
            s.budgetedProratedCents + l.budgetedProratedCents,
          actualCents: s.actualCents + l.actualCents,
          varianceCents: s.varianceCents + l.varianceCents,
        }),
        {
          budgetedAnnualCents: 0,
          budgetedProratedCents: 0,
          actualCents: 0,
          varianceCents: 0,
        },
      );

      return {
        budget: {
          id: budget.id,
          name: budget.name,
          fiscalYear: budget.fiscal_year,
          status: budget.status,
        },
        period: { from, to, days },
        lines,
        totals,
      };
    });

    if (!data) {
      return reply
        .status(404)
        .send({ error: { code: "NO_BUDGET", message: "No matching budget found." } });
    }
    return reply.send(data);
  });
};
