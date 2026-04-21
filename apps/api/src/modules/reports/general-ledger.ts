import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

const QuerySchema = z.object({
  accountId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const LINE_CAP = 2000;

interface LedgerLine {
  journalEntryId: string;
  entryNumber: string;
  entryDate: string;
  memo: string | null;
  sourceType: string | null;
  sourceId: string | null;
  lineNo: number;
  description: string | null;
  drCents: number;
  crCents: number;
  runningBalanceCents: number;
}

interface LedgerPayload {
  account: {
    id: string;
    code: string;
    name: string;
    accountType: "asset" | "liability" | "equity" | "income" | "expense";
    accountSubtype: string | null;
    normalSide: "dr" | "cr";
  };
  asOfFrom: string | null;
  asOfTo: string | null;
  openingBalanceCents: number;
  closingBalanceCents: number;
  totalDebitsCents: number;
  totalCreditsCents: number;
  lines: LedgerLine[];
  truncated: boolean;
}

export const generalLedgerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { accountId, from, to } = parsed.data;

    const data = await withTenant(ctx.tenantId, async (tx): Promise<LedgerPayload | null> => {
      // -- Account metadata (+ tenant scoping)
      const accountRows = (await tx.execute(sql`
        SELECT id, code, name, account_type, account_subtype, normal_side
        FROM chart_of_accounts
        WHERE tenant_id = current_tenant_id()
          AND id = ${accountId}
          AND deleted_at IS NULL
        LIMIT 1
      `)) as unknown as Array<{
        id: string;
        code: string;
        name: string;
        account_type: LedgerPayload["account"]["accountType"];
        account_subtype: string | null;
        normal_side: "dr" | "cr";
      }>;

      const acc = accountRows[0];
      if (!acc) return null;

      // -- Opening balance: sum(dr - cr) for all lines dated before `from`
      //    Expressed signed per the account's normal side so the running balance
      //    reads naturally (asset / expense go up on debit, etc.).
      const openingRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(jl.dr_cents - jl.cr_cents), 0)::bigint AS raw
        FROM journal_lines jl
        JOIN journal_entries je
          ON je.id = jl.journal_entry_id
         AND je.tenant_id = jl.tenant_id
        WHERE jl.tenant_id = current_tenant_id()
          AND jl.account_id = ${accountId}
          ${from ? sql`AND je.entry_date < ${from}::date` : sql`AND false`}
      `)) as unknown as Array<{ raw: number | string }>;

      const rawOpening = from ? Number(openingRows[0]?.raw ?? 0) : 0;
      const openingBalanceCents = acc.normal_side === "dr" ? rawOpening : -rawOpening;

      // -- In-range lines, oldest → newest so the running balance builds forward.
      const lineRows = (await tx.execute(sql`
        SELECT
          je.id AS entry_id,
          je.entry_number,
          je.entry_date::text AS entry_date,
          je.memo,
          je.source_type,
          je.source_id,
          jl.line_no,
          jl.description,
          jl.dr_cents,
          jl.cr_cents
        FROM journal_lines jl
        JOIN journal_entries je
          ON je.id = jl.journal_entry_id
         AND je.tenant_id = jl.tenant_id
        WHERE jl.tenant_id = current_tenant_id()
          AND jl.account_id = ${accountId}
          ${from ? sql`AND je.entry_date >= ${from}::date` : sql``}
          ${to ? sql`AND je.entry_date <= ${to}::date` : sql``}
        ORDER BY je.entry_date ASC, je.entry_number ASC, jl.line_no ASC
        LIMIT ${LINE_CAP + 1}
      `)) as unknown as Array<{
        entry_id: string;
        entry_number: string;
        entry_date: string;
        memo: string | null;
        source_type: string | null;
        source_id: string | null;
        line_no: number;
        description: string | null;
        dr_cents: number | string;
        cr_cents: number | string;
      }>;

      const truncated = lineRows.length > LINE_CAP;
      const capped = truncated ? lineRows.slice(0, LINE_CAP) : lineRows;

      let running = openingBalanceCents;
      let totalDr = 0;
      let totalCr = 0;
      const lines: LedgerLine[] = capped.map((r) => {
        const dr = Number(r.dr_cents);
        const cr = Number(r.cr_cents);
        const signed = acc.normal_side === "dr" ? dr - cr : cr - dr;
        running += signed;
        totalDr += dr;
        totalCr += cr;
        return {
          journalEntryId: r.entry_id,
          entryNumber: r.entry_number,
          entryDate: r.entry_date,
          memo: r.memo,
          sourceType: r.source_type,
          sourceId: r.source_id,
          lineNo: r.line_no,
          description: r.description,
          drCents: dr,
          crCents: cr,
          runningBalanceCents: running,
        };
      });

      return {
        account: {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          accountType: acc.account_type,
          accountSubtype: acc.account_subtype,
          normalSide: acc.normal_side,
        },
        asOfFrom: from ?? null,
        asOfTo: to ?? null,
        openingBalanceCents,
        closingBalanceCents: running,
        totalDebitsCents: totalDr,
        totalCreditsCents: totalCr,
        lines,
        truncated,
      };
    });

    if (!data) {
      return reply.status(404).send({ error: { code: "ACCOUNT_NOT_FOUND", message: "Account not found" } });
    }

    return reply.send(data);
  });
};
