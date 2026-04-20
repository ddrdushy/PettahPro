import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

const QuerySchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

interface Line {
  accountId: string;
  code: string;
  name: string;
  subtype: string | null;
  balanceCents: number;
}

interface Section {
  label: string;
  accounts: Line[];
  totalCents: number;
}

export const balanceSheetRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const asOf = parsed.data.asOf ?? new Date().toISOString().slice(0, 10);

    const data = await withTenant(ctx.tenantId, async (tx) => {
      // Balance sheet accounts: assets, liabilities, equity — cumulative from
      // inception through asOf. Sign per normal side.
      const rows = (await tx.execute(sql`
        SELECT
          coa.id AS account_id,
          coa.code,
          coa.name,
          coa.account_type,
          coa.account_subtype,
          coa.normal_side,
          COALESCE(SUM(jl.dr_cents), 0)::bigint AS dr_total,
          COALESCE(SUM(jl.cr_cents), 0)::bigint AS cr_total
        FROM chart_of_accounts coa
        LEFT JOIN journal_lines jl
          ON jl.account_id = coa.id AND jl.tenant_id = coa.tenant_id
        LEFT JOIN journal_entries je
          ON je.id = jl.journal_entry_id AND je.tenant_id = coa.tenant_id
         AND je.entry_date <= ${asOf}::date
        WHERE coa.tenant_id = current_tenant_id()
          AND coa.deleted_at IS NULL
          AND coa.account_type IN ('asset','liability','equity')
        GROUP BY coa.id, coa.code, coa.name, coa.account_type, coa.account_subtype, coa.normal_side
        ORDER BY coa.code
      `)) as unknown as Array<{
        account_id: string;
        code: string;
        name: string;
        account_type: "asset" | "liability" | "equity";
        account_subtype: string | null;
        normal_side: "dr" | "cr";
        dr_total: number | string;
        cr_total: number | string;
      }>;

      // Current-period (inception to asOf) net profit — earnings that
      // haven't yet been closed to retained earnings need to appear in
      // equity for the balance sheet to balance.
      const [profit] = (await tx.execute(sql`
        SELECT
          COALESCE(SUM(
            CASE WHEN coa.account_type = 'income' THEN jl.cr_cents - jl.dr_cents
                 WHEN coa.account_type = 'expense' THEN -(jl.dr_cents - jl.cr_cents)
                 ELSE 0 END
          ), 0)::bigint AS net_profit
        FROM journal_lines jl
        JOIN journal_entries je
          ON je.id = jl.journal_entry_id AND je.tenant_id = jl.tenant_id
        JOIN chart_of_accounts coa
          ON coa.id = jl.account_id AND coa.tenant_id = jl.tenant_id
        WHERE jl.tenant_id = current_tenant_id()
          AND je.entry_date <= ${asOf}::date
      `)) as unknown as Array<{ net_profit: number | string }>;

      const currentEarningsCents = Number(profit?.net_profit ?? 0);

      const assets: Line[] = [];
      const liabilities: Line[] = [];
      const equityAccounts: Line[] = [];

      for (const r of rows) {
        const dr = Number(r.dr_total);
        const cr = Number(r.cr_total);
        const bal = r.normal_side === "dr" ? dr - cr : cr - dr;
        if (bal === 0) continue;
        const line: Line = {
          accountId: r.account_id,
          code: r.code,
          name: r.name,
          subtype: r.account_subtype,
          balanceCents: bal,
        };
        if (r.account_type === "asset") assets.push(line);
        else if (r.account_type === "liability") liabilities.push(line);
        else equityAccounts.push(line);
      }

      const sumLines = (ls: Line[]) => ls.reduce((s, l) => s + l.balanceCents, 0);

      const totalAssets = sumLines(assets);
      const totalLiabilities = sumLines(liabilities);
      const totalEquityAccounts = sumLines(equityAccounts);
      const totalEquity = totalEquityAccounts + currentEarningsCents;

      const sections: Section[] = [
        { label: "Assets", accounts: assets, totalCents: totalAssets },
        { label: "Liabilities", accounts: liabilities, totalCents: totalLiabilities },
        {
          label: "Equity",
          accounts: [
            ...equityAccounts,
            ...(currentEarningsCents !== 0
              ? [
                  {
                    accountId: "_earnings",
                    code: "—",
                    name: "Current period earnings",
                    subtype: "period_earnings",
                    balanceCents: currentEarningsCents,
                  },
                ]
              : []),
          ],
          totalCents: totalEquity,
        },
      ];

      return {
        asOf,
        sections,
        totalAssetsCents: totalAssets,
        totalLiabilitiesCents: totalLiabilities,
        totalEquityCents: totalEquity,
        liabilitiesAndEquityCents: totalLiabilities + totalEquity,
        currentEarningsCents,
        balanced: totalAssets === totalLiabilities + totalEquity,
      };
    });

    return reply.send(data);
  });
};
