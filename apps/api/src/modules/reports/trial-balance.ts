import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

const QuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: "asset" | "liability" | "equity" | "income" | "expense";
  accountSubtype: string | null;
  normalSide: "dr" | "cr";
  debitCents: number;
  creditCents: number;
  balanceCents: number; // signed: positive if debit-side, negative if credit-side
}

export const trialBalanceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { from, to } = parsed.data;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT
          coa.id,
          coa.code,
          coa.name,
          coa.account_type,
          coa.account_subtype,
          coa.normal_side,
          COALESCE(SUM(jl.dr_cents), 0)::bigint AS debit_cents,
          COALESCE(SUM(jl.cr_cents), 0)::bigint AS credit_cents
        FROM chart_of_accounts coa
        LEFT JOIN journal_lines jl
          ON jl.account_id = coa.id
         AND jl.tenant_id = coa.tenant_id
        LEFT JOIN journal_entries je
          ON je.id = jl.journal_entry_id
         AND je.tenant_id = coa.tenant_id
         ${from ? sql`AND je.entry_date >= ${from}::date` : sql``}
         ${to ? sql`AND je.entry_date <= ${to}::date` : sql``}
        WHERE coa.tenant_id = current_tenant_id()
          AND coa.deleted_at IS NULL
        GROUP BY coa.id, coa.code, coa.name, coa.account_type, coa.account_subtype, coa.normal_side
        ORDER BY coa.code
      `)) as unknown as Array<{
        id: string;
        code: string;
        name: string;
        account_type: TrialBalanceRow["accountType"];
        account_subtype: string | null;
        normal_side: "dr" | "cr";
        debit_cents: number | string;
        credit_cents: number | string;
      }>;

      const accounts: TrialBalanceRow[] = rows.map((r) => {
        const dr = Number(r.debit_cents);
        const cr = Number(r.credit_cents);
        const balance = r.normal_side === "dr" ? dr - cr : cr - dr;
        return {
          accountId: r.id,
          code: r.code,
          name: r.name,
          accountType: r.account_type,
          accountSubtype: r.account_subtype,
          normalSide: r.normal_side,
          debitCents: dr,
          creditCents: cr,
          balanceCents: balance,
        };
      });

      const totalDebits = accounts.reduce((s, a) => s + a.debitCents, 0);
      const totalCredits = accounts.reduce((s, a) => s + a.creditCents, 0);

      return {
        accounts,
        totalDebits,
        totalCredits,
        balanced: totalDebits === totalCredits,
        asOfFrom: from ?? null,
        asOfTo: to ?? null,
      };
    });

    return reply.send(data);
  });
};
