import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

const QuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  compare: z.enum(["none", "prior_month", "prior_year"]).default("none"),
  // Cost-center dimension filter (#129 / gaps B1). UUID = filter to
  // that center; the literal "unassigned" filters to journal_lines
  // with cost_center_id IS NULL; empty/missing = no filter (all
  // centers + unassigned summed together as before).
  costCenterId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("unassigned")),
});

interface Line {
  accountId: string;
  code: string;
  name: string;
  amountCents: number;
  comparisonCents?: number;
}

interface Section {
  label: string;
  accounts: Line[];
  totalCents: number;
  comparisonTotalCents?: number;
}

function monthStart(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function monthEnd(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function priorMonth(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function priorYear(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export const profitLossRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const today = new Date().toISOString().slice(0, 10);
    const from = parsed.data.from ?? monthStart(today);
    const to = parsed.data.to ?? monthEnd(today);
    const compare = parsed.data.compare;

    const [cmpFrom, cmpTo] =
      compare === "prior_month"
        ? [priorMonth(from), priorMonth(to)]
        : compare === "prior_year"
          ? [priorYear(from), priorYear(to)]
          : [null, null];

    // Cost-center dimension filter (#129 / gaps B1). The clause
    // collapses cleanly to "no filter" when costCenterId is missing,
    // restricts to one center when a UUID is given, and matches
    // NULL-only when the literal "unassigned" is given.
    const costCenterClause =
      parsed.data.costCenterId === undefined
        ? sql`true`
        : parsed.data.costCenterId === "unassigned"
          ? sql`jl.cost_center_id IS NULL`
          : sql`jl.cost_center_id = ${parsed.data.costCenterId}::uuid`;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const rows = (await tx.execute(sql`
        WITH balances AS (
          SELECT
            coa.id AS account_id,
            coa.code,
            coa.name,
            coa.account_type,
            coa.account_subtype,
            coa.normal_side,
            COALESCE(SUM(jl.dr_cents) FILTER (
              WHERE je.entry_date >= ${from}::date AND je.entry_date <= ${to}::date AND ${costCenterClause}
            ), 0)::bigint AS dr_current,
            COALESCE(SUM(jl.cr_cents) FILTER (
              WHERE je.entry_date >= ${from}::date AND je.entry_date <= ${to}::date AND ${costCenterClause}
            ), 0)::bigint AS cr_current,
            COALESCE(SUM(jl.dr_cents) FILTER (
              WHERE ${cmpFrom ? sql`je.entry_date >= ${cmpFrom}::date AND je.entry_date <= ${cmpTo}::date AND ${costCenterClause}` : sql`false`}
            ), 0)::bigint AS dr_compare,
            COALESCE(SUM(jl.cr_cents) FILTER (
              WHERE ${cmpFrom ? sql`je.entry_date >= ${cmpFrom}::date AND je.entry_date <= ${cmpTo}::date AND ${costCenterClause}` : sql`false`}
            ), 0)::bigint AS cr_compare
          FROM chart_of_accounts coa
          LEFT JOIN journal_lines jl
            ON jl.account_id = coa.id AND jl.tenant_id = coa.tenant_id
          LEFT JOIN journal_entries je
            ON je.id = jl.journal_entry_id AND je.tenant_id = coa.tenant_id
          WHERE coa.tenant_id = current_tenant_id()
            AND coa.deleted_at IS NULL
            AND coa.account_type IN ('income','expense')
          GROUP BY coa.id, coa.code, coa.name, coa.account_type, coa.account_subtype, coa.normal_side
        )
        SELECT * FROM balances ORDER BY code
      `)) as unknown as Array<{
        account_id: string;
        code: string;
        name: string;
        account_type: "income" | "expense";
        account_subtype: string | null;
        normal_side: "dr" | "cr";
        dr_current: number | string;
        cr_current: number | string;
        dr_compare: number | string;
        cr_compare: number | string;
      }>;

      const income: Line[] = [];
      const cogs: Line[] = [];
      const opex: Line[] = [];

      for (const r of rows) {
        const drCur = Number(r.dr_current);
        const crCur = Number(r.cr_current);
        const drCmp = Number(r.dr_compare);
        const crCmp = Number(r.cr_compare);
        // For income accounts, positive = credit − debit; expense is opposite.
        const cur =
          r.account_type === "income" ? crCur - drCur : drCur - crCur;
        const cmp =
          r.account_type === "income" ? crCmp - drCmp : drCmp - crCmp;

        if (cur === 0 && cmp === 0) continue;

        const line: Line = {
          accountId: r.account_id,
          code: r.code,
          name: r.name,
          amountCents: cur,
          ...(cmpFrom !== null ? { comparisonCents: cmp } : {}),
        };

        if (r.account_type === "income") income.push(line);
        else if (r.account_subtype === "cogs") cogs.push(line);
        else opex.push(line);
      }

      const sumLines = (lines: Line[]): number => lines.reduce((s, l) => s + l.amountCents, 0);
      const sumCompare = (lines: Line[]): number =>
        lines.reduce((s, l) => s + (l.comparisonCents ?? 0), 0);

      const totalIncome = sumLines(income);
      const totalCogs = sumLines(cogs);
      const totalOpex = sumLines(opex);
      const grossProfit = totalIncome - totalCogs;
      const netProfit = grossProfit - totalOpex;

      const cmpIncome = cmpFrom !== null ? sumCompare(income) : undefined;
      const cmpCogs = cmpFrom !== null ? sumCompare(cogs) : undefined;
      const cmpOpex = cmpFrom !== null ? sumCompare(opex) : undefined;
      const cmpGross =
        cmpIncome !== undefined && cmpCogs !== undefined ? cmpIncome - cmpCogs : undefined;
      const cmpNet =
        cmpGross !== undefined && cmpOpex !== undefined ? cmpGross - cmpOpex : undefined;

      const sections: Section[] = [
        {
          label: "Income",
          accounts: income,
          totalCents: totalIncome,
          ...(cmpIncome !== undefined ? { comparisonTotalCents: cmpIncome } : {}),
        },
      ];
      if (cogs.length > 0 || totalCogs !== 0) {
        sections.push({
          label: "Cost of goods sold",
          accounts: cogs,
          totalCents: totalCogs,
          ...(cmpCogs !== undefined ? { comparisonTotalCents: cmpCogs } : {}),
        });
      }
      sections.push({
        label: "Operating expenses",
        accounts: opex,
        totalCents: totalOpex,
        ...(cmpOpex !== undefined ? { comparisonTotalCents: cmpOpex } : {}),
      });

      return {
        asOfFrom: from,
        asOfTo: to,
        compare,
        comparisonFrom: cmpFrom,
        comparisonTo: cmpTo,
        sections,
        grossProfitCents: grossProfit,
        netProfitCents: netProfit,
        totalIncomeCents: totalIncome,
        totalCogsCents: totalCogs,
        totalOpexCents: totalOpex,
        comparison:
          cmpFrom !== null
            ? {
                grossProfitCents: cmpGross ?? 0,
                netProfitCents: cmpNet ?? 0,
                totalIncomeCents: cmpIncome ?? 0,
                totalCogsCents: cmpCogs ?? 0,
                totalOpexCents: cmpOpex ?? 0,
              }
            : null,
      };
    });

    return reply.send(data);
  });
};
