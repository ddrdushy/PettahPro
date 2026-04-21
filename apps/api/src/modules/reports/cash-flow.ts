import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

const QuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

interface FlowRow {
  accountId: string;
  code: string;
  name: string;
  accountSubtype: string | null;
  flowCents: number; // positive = cash in, negative = cash out
}

interface FlowSection {
  label: string;
  kind: "operating" | "investing" | "financing";
  accounts: FlowRow[];
  totalCents: number;
}

interface CashFlowPayload {
  asOfFrom: string;
  asOfTo: string;
  openingCashCents: number;
  closingCashCents: number;
  netChangeCents: number;
  sections: FlowSection[];
}

/**
 * Cash-flow statement — direct-ish method derived from journal_lines that
 * touched cash / bank accounts.
 *
 * For each JE that has a cash leg, we attribute the *other* legs to
 * operating / investing / financing based on the counterparty account's
 * type + subtype. The sign of each contra-line flips because a debit to
 * cash is balanced by a credit elsewhere and vice-versa. This keeps the
 * statement reconciled to the net cash movement by construction.
 *
 * Classification (SL SME default — overridable per-account is future work):
 * - operating:  income, expense, AR, AP, VAT, tax, salaries, inventory
 * - investing:  fixed assets, accumulated_depreciation
 * - financing:  equity, retained earnings, loans
 */
export const cashFlowRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { from, to } = parsed.data;

    const data = await withTenant(ctx.tenantId, async (tx): Promise<CashFlowPayload> => {
      // Resolve cash/bank account IDs up front.
      const cashRows = (await tx.execute(sql`
        SELECT id FROM chart_of_accounts
        WHERE tenant_id = current_tenant_id()
          AND deleted_at IS NULL
          AND account_type = 'asset'
          AND account_subtype IN ('cash','bank','bank_clearing','bank_transit')
      `)) as unknown as Array<{ id: string }>;
      const cashAccountIds = cashRows.map((r) => r.id);

      if (cashAccountIds.length === 0) {
        return {
          asOfFrom: from,
          asOfTo: to,
          openingCashCents: 0,
          closingCashCents: 0,
          netChangeCents: 0,
          sections: [],
        };
      }

      // Use a cash-accounts subquery rather than an array parameter — drizzle
      // doesn't round-trip JS string arrays cleanly as uuid[] and we'd rather
      // keep the SQL readable than hand-craft a literal. current_tenant_id()
      // in the inner SELECT picks up the right scope via RLS.
      const cashAccountsSql = sql`(SELECT id FROM chart_of_accounts
        WHERE tenant_id = current_tenant_id()
          AND deleted_at IS NULL
          AND account_type = 'asset'
          AND account_subtype IN ('cash','bank','bank_clearing','bank_transit'))`;

      // Opening cash (sum of all cash-account postings strictly before `from`).
      const [openRow] = (await tx.execute(sql`
        SELECT COALESCE(SUM(jl.dr_cents - jl.cr_cents), 0)::bigint AS opening
        FROM journal_lines jl
        JOIN journal_entries je
          ON je.id = jl.journal_entry_id
         AND je.tenant_id = jl.tenant_id
        WHERE jl.tenant_id = current_tenant_id()
          AND jl.account_id IN ${cashAccountsSql}
          AND je.entry_date < ${from}::date
      `)) as unknown as Array<{ opening: number | string }>;

      // Net cash change in period (from the cash side — this is the control total).
      const [changeRow] = (await tx.execute(sql`
        SELECT COALESCE(SUM(jl.dr_cents - jl.cr_cents), 0)::bigint AS change
        FROM journal_lines jl
        JOIN journal_entries je
          ON je.id = jl.journal_entry_id
         AND je.tenant_id = jl.tenant_id
        WHERE jl.tenant_id = current_tenant_id()
          AND jl.account_id IN ${cashAccountsSql}
          AND je.entry_date BETWEEN ${from}::date AND ${to}::date
      `)) as unknown as Array<{ change: number | string }>;

      // For every JE that has a cash leg in the period, pull the non-cash legs
      // grouped by account and flip sign. Dr Cash / Cr Sales → Sales contributes
      // +cr_cents to cash. Cr Cash / Dr Expense → Expense contributes
      // -(dr_cents - cr_cents) to cash. We express this uniformly as
      // `(cr_cents - dr_cents)` on the non-cash side.
      const contraRows = (await tx.execute(sql`
        WITH cash_entries AS (
          SELECT DISTINCT je.id, je.entry_date
          FROM journal_entries je
          JOIN journal_lines jl_cash
            ON jl_cash.journal_entry_id = je.id
           AND jl_cash.tenant_id = je.tenant_id
          WHERE je.tenant_id = current_tenant_id()
            AND je.entry_date BETWEEN ${from}::date AND ${to}::date
            AND jl_cash.account_id IN ${cashAccountsSql}
        )
        SELECT
          coa.id            AS account_id,
          coa.code,
          coa.name,
          coa.account_type,
          coa.account_subtype,
          SUM(jl.cr_cents - jl.dr_cents)::bigint AS flow_cents
        FROM cash_entries ce
        JOIN journal_lines jl
          ON jl.journal_entry_id = ce.id
         AND jl.tenant_id = current_tenant_id()
         AND jl.account_id NOT IN ${cashAccountsSql}
        JOIN chart_of_accounts coa
          ON coa.id = jl.account_id
         AND coa.tenant_id = jl.tenant_id
        GROUP BY coa.id, coa.code, coa.name, coa.account_type, coa.account_subtype
        HAVING SUM(jl.cr_cents - jl.dr_cents) <> 0
        ORDER BY coa.code
      `)) as unknown as Array<{
        account_id: string;
        code: string;
        name: string;
        account_type: "asset" | "liability" | "equity" | "income" | "expense";
        account_subtype: string | null;
        flow_cents: number | string;
      }>;

      const classify = (r: (typeof contraRows)[number]): FlowSection["kind"] => {
        const sub = r.account_subtype ?? "";
        // Investing: long-lived assets being bought/sold
        if (sub === "fixed_asset" || sub === "accumulated_depreciation") return "investing";
        // Financing: equity changes, retained earnings, loans
        if (r.account_type === "equity") return "financing";
        if (sub === "loan" || sub === "loans") return "financing";
        // Everything else rolls up to operating (income, expense, AR, AP,
        // inventory, tax, payroll payables, WHT, etc.)
        return "operating";
      };

      const buckets: Record<FlowSection["kind"], FlowRow[]> = {
        operating: [],
        investing: [],
        financing: [],
      };
      for (const r of contraRows) {
        const kind = classify(r);
        buckets[kind].push({
          accountId: r.account_id,
          code: r.code,
          name: r.name,
          accountSubtype: r.account_subtype,
          flowCents: Number(r.flow_cents),
        });
      }

      const sections: FlowSection[] = (["operating", "investing", "financing"] as const).map(
        (kind) => ({
          label:
            kind === "operating"
              ? "Operating activities"
              : kind === "investing"
                ? "Investing activities"
                : "Financing activities",
          kind,
          accounts: buckets[kind],
          totalCents: buckets[kind].reduce((s, a) => s + a.flowCents, 0),
        }),
      );

      const openingCashCents = Number(openRow?.opening ?? 0);
      const netChangeCents = Number(changeRow?.change ?? 0);

      return {
        asOfFrom: from,
        asOfTo: to,
        openingCashCents,
        closingCashCents: openingCashCents + netChangeCents,
        netChangeCents,
        sections,
      };
    });

    return reply.send(data);
  });
};
