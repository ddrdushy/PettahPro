import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "./journal-posting.js";

// Opening balance is a single journal entry dated the day before the tenant's
// books start, tagged sourceType='opening_balance'. Each tenant posts at most
// one such entry — if a tenant needs to correct opening balances after going
// live, they reverse this entry and post a new one (reopen period first if
// it's locked).

const LineSchema = z.object({
  accountCode: z.string().min(1).max(16),
  drCents: z.number().int().min(0).default(0),
  crCents: z.number().int().min(0).default(0),
  description: z.string().max(255).optional(),
}).refine((l) => l.drCents > 0 || l.crCents > 0, {
  message: "Each line needs a debit or credit amount",
}).refine((l) => !(l.drCents > 0 && l.crCents > 0), {
  message: "Line can't have both a debit and a credit",
});

const PostSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(LineSchema).min(2),
});

interface OpeningBalanceState {
  posted: boolean;
  entry: {
    id: string;
    entryNumber: string | null;
    entryDate: string;
    lineCount: number;
    totalDrCents: number;
    totalCrCents: number;
  } | null;
}

export const openingBalanceRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /opening-balance — check whether the tenant has already posted one.
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx): Promise<OpeningBalanceState> => {
      const rows = (await tx.execute(sql`
        SELECT je.id,
               je.entry_number,
               je.entry_date::text AS entry_date,
               COUNT(jl.id)::int       AS line_count,
               COALESCE(SUM(jl.dr_cents), 0)::bigint AS dr_total,
               COALESCE(SUM(jl.cr_cents), 0)::bigint AS cr_total
          FROM journal_entries je
          LEFT JOIN journal_lines jl ON jl.journal_entry_id = je.id
         WHERE je.tenant_id = current_tenant_id()
           AND je.source_type = 'opening_balance'
           AND je.is_reversed = false
         GROUP BY je.id, je.entry_number, je.entry_date
         ORDER BY je.entry_date DESC
         LIMIT 1
      `)) as unknown as Array<{
        id: string;
        entry_number: string | null;
        entry_date: string;
        line_count: number;
        dr_total: number | string;
        cr_total: number | string;
      }>;

      if (rows.length === 0) return { posted: false, entry: null };

      const r = rows[0]!;
      return {
        posted: true,
        entry: {
          id: r.id,
          entryNumber: r.entry_number,
          entryDate: r.entry_date,
          lineCount: r.line_count,
          totalDrCents: Number(r.dr_total),
          totalCrCents: Number(r.cr_total),
        },
      };
    });

    return reply.send(data);
  });

  // POST /opening-balance — validate and post the single opening entry.
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = PostSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { asOfDate, lines } = parsed.data;

    // Header-level balance check — friendlier error than postJournal's.
    const drTotal = lines.reduce((s, l) => s + l.drCents, 0);
    const crTotal = lines.reduce((s, l) => s + l.crCents, 0);
    if (drTotal === 0) {
      return reply.status(400).send({ error: { code: "NO_AMOUNTS" } });
    }
    if (drTotal !== crTotal) {
      return reply.status(400).send({
        error: {
          code: "UNBALANCED",
          message: `Debits (${(drTotal / 100).toFixed(2)}) don't match credits (${(crTotal / 100).toFixed(2)}).`,
        },
      });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Reject if a non-reversed opening entry already exists.
      const existing = (await tx.execute(sql`
        SELECT id FROM journal_entries
         WHERE tenant_id = current_tenant_id()
           AND source_type = 'opening_balance'
           AND is_reversed = false
         LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      if (existing.length > 0) {
        return { error: "ALREADY_POSTED" as const, existingId: existing[0]!.id };
      }

      // Resolve every account_code in one query. Returns a map code → id.
      // Drizzle doesn't round-trip JS arrays as text[], so we go through
      // jsonb_array_elements_text instead of ANY().
      const codes = Array.from(new Set(lines.map((l) => l.accountCode.trim())));
      const accountRows = (await tx.execute(sql`
        SELECT id, code
          FROM chart_of_accounts
         WHERE tenant_id = current_tenant_id()
           AND deleted_at IS NULL
           AND code IN (
             SELECT jsonb_array_elements_text(${JSON.stringify(codes)}::jsonb)
           )
      `)) as unknown as Array<{ id: string; code: string }>;
      const idByCode = new Map(accountRows.map((r) => [r.code, r.id]));

      const missing = codes.filter((c) => !idByCode.has(c));
      if (missing.length > 0) {
        return { error: "UNKNOWN_ACCOUNTS" as const, missing };
      }

      // Map to postJournal lines.
      const postingLines = lines.map((l) => ({
        accountId: idByCode.get(l.accountCode.trim())!,
        drCents: l.drCents,
        crCents: l.crCents,
        description: l.description ?? `Opening balance · ${l.accountCode}`,
      }));

      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: asOfDate,
        memo: `Opening balances as of ${asOfDate}`,
        sourceType: "opening_balance",
        postedByUserId: ctx.userId,
        lines: postingLines,
      });

      return { ok: true as const, entryId, entryNumber };
    });

    if ("error" in result) {
      if (result.error === "ALREADY_POSTED") {
        return reply.status(409).send({
          error: {
            code: "ALREADY_POSTED",
            message: "An opening balance entry is already posted. Reverse it first if you need to restate.",
            existingId: (result as { existingId: string }).existingId,
          },
        });
      }
      if (result.error === "UNKNOWN_ACCOUNTS") {
        return reply.status(400).send({
          error: {
            code: "UNKNOWN_ACCOUNTS",
            message: `These account codes don't exist in your chart of accounts: ${(result as { missing: string[] }).missing.join(", ")}`,
            missing: (result as { missing: string[] }).missing,
          },
        });
      }
      return reply.status(400).send({ error: { code: String(result.error) } });
    }

    return reply.send(result);
  });
};
