import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "./journal-posting.js";

// GET /wht — snapshot for the WHT dashboard: outstanding WHT Payable
// balance, WHT withheld per month (from posted supplier_payments), and
// remittance history (JEs with sourceType='wht_remit').
interface WhtPerMonth {
  year: number;
  month: number;
  withheldCents: number;
  remittedCents: number;
  netBalanceCents: number;
}

interface WhtBySupplier {
  supplierId: string;
  supplierName: string;
  withheldCents: number;
  paymentCount: number;
}

interface WhtRemittance {
  id: string;
  entryNumber: string | null;
  entryDate: string;
  amountCents: number;
  reference: string | null;
  memo: string | null;
}

const RemitSchema = z.object({
  bankAccountId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference: z.string().max(64).optional(),
  memo: z.string().max(500).optional(),
});

export const whtRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      // Balance on WHT Payable (account code 2110). Credit-normal, so
      // balance = CR − DR on journal_lines.
      const balanceRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(jl.cr_cents), 0)::bigint AS cr_total,
               COALESCE(SUM(jl.dr_cents), 0)::bigint AS dr_total
          FROM journal_lines jl
          INNER JOIN chart_of_accounts coa ON coa.id = jl.account_id
         WHERE coa.tenant_id = current_tenant_id()
           AND coa.code = '2110'
      `)) as unknown as Array<{ cr_total: number | string; dr_total: number | string }>;
      const balance = balanceRows[0]
        ? Number(balanceRows[0].cr_total) - Number(balanceRows[0].dr_total)
        : 0;

      // Withholdings per year/month from posted supplier_payments.
      const perMonthWithheld = (await tx.execute(sql`
        SELECT EXTRACT(year  FROM payment_date)::int AS year,
               EXTRACT(month FROM payment_date)::int AS month,
               COALESCE(SUM(wht_cents), 0)::bigint    AS withheld_cents
          FROM supplier_payments
         WHERE tenant_id = current_tenant_id()
           AND deleted_at IS NULL
           AND wht_cents > 0
         GROUP BY year, month
         ORDER BY year DESC, month DESC
      `)) as unknown as Array<{ year: number; month: number; withheld_cents: number | string }>;

      // Remittances per year/month. The JE dr hits WHT Payable, so sum
      // dr_cents on journal_lines where je.source_type='wht_remit'.
      const perMonthRemitted = (await tx.execute(sql`
        SELECT EXTRACT(year  FROM je.entry_date)::int AS year,
               EXTRACT(month FROM je.entry_date)::int AS month,
               COALESCE(SUM(jl.dr_cents), 0)::bigint    AS remitted_cents
          FROM journal_entries je
          INNER JOIN journal_lines jl ON jl.journal_entry_id = je.id
          INNER JOIN chart_of_accounts coa ON coa.id = jl.account_id
         WHERE je.tenant_id = current_tenant_id()
           AND je.source_type = 'wht_remit'
           AND coa.code = '2110'
         GROUP BY year, month
         ORDER BY year DESC, month DESC
      `)) as unknown as Array<{ year: number; month: number; remitted_cents: number | string }>;

      // Merge into one list keyed by year-month.
      type Key = string;
      const map = new Map<Key, WhtPerMonth>();
      for (const r of perMonthWithheld) {
        const k = `${r.year}-${r.month}`;
        map.set(k, {
          year: r.year,
          month: r.month,
          withheldCents: Number(r.withheld_cents),
          remittedCents: 0,
          netBalanceCents: Number(r.withheld_cents),
        });
      }
      for (const r of perMonthRemitted) {
        const k = `${r.year}-${r.month}`;
        const existing = map.get(k);
        if (existing) {
          existing.remittedCents = Number(r.remitted_cents);
          existing.netBalanceCents = existing.withheldCents - existing.remittedCents;
        } else {
          map.set(k, {
            year: r.year,
            month: r.month,
            withheldCents: 0,
            remittedCents: Number(r.remitted_cents),
            netBalanceCents: -Number(r.remitted_cents),
          });
        }
      }
      const perMonth = Array.from(map.values()).sort(
        (a, b) => b.year - a.year || b.month - a.month,
      );

      // By supplier, lifetime-to-date.
      const bySupplier = (await tx.execute(sql`
        SELECT sp.supplier_id,
               s.name AS supplier_name,
               COALESCE(SUM(sp.wht_cents), 0)::bigint AS withheld_cents,
               COUNT(*)::int AS payment_count
          FROM supplier_payments sp
          INNER JOIN suppliers s ON s.id = sp.supplier_id
         WHERE sp.tenant_id = current_tenant_id()
           AND sp.deleted_at IS NULL
           AND sp.wht_cents > 0
         GROUP BY sp.supplier_id, s.name
         ORDER BY withheld_cents DESC
         LIMIT 100
      `)) as unknown as Array<{
        supplier_id: string;
        supplier_name: string;
        withheld_cents: number | string;
        payment_count: number;
      }>;

      const suppliers: WhtBySupplier[] = bySupplier.map((r) => ({
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        withheldCents: Number(r.withheld_cents),
        paymentCount: r.payment_count,
      }));

      // Remittance history.
      const remRows = (await tx.execute(sql`
        SELECT je.id,
               je.entry_number,
               je.entry_date::text AS entry_date,
               COALESCE(SUM(jl.dr_cents), 0)::bigint AS amount_cents,
               je.memo
          FROM journal_entries je
          INNER JOIN journal_lines jl ON jl.journal_entry_id = je.id
          INNER JOIN chart_of_accounts coa ON coa.id = jl.account_id
         WHERE je.tenant_id = current_tenant_id()
           AND je.source_type = 'wht_remit'
           AND coa.code = '2110'
         GROUP BY je.id, je.entry_number, je.entry_date, je.memo
         ORDER BY je.entry_date DESC
         LIMIT 50
      `)) as unknown as Array<{
        id: string;
        entry_number: string | null;
        entry_date: string;
        amount_cents: number | string;
        memo: string | null;
      }>;

      const remittances: WhtRemittance[] = remRows.map((r) => ({
        id: r.id,
        entryNumber: r.entry_number,
        entryDate: r.entry_date,
        amountCents: Number(r.amount_cents),
        reference: null,
        memo: r.memo,
      }));

      return {
        balanceCents: balance,
        perMonth,
        suppliers,
        remittances,
      };
    });

    return reply.send(data);
  });

  // POST /wht/remit — post a remittance journal (DR WHT Payable, CR Bank)
  // and tag it sourceType='wht_remit' so the history query picks it up.
  fastify.post("/remit", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = RemitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Resolve WHT Payable + bank account.
      const [wht] = (await tx.execute(sql`
        SELECT id FROM chart_of_accounts
         WHERE tenant_id = current_tenant_id() AND code = '2110' AND deleted_at IS NULL
         LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      if (!wht) return { error: "NO_WHT_ACCOUNT" as const };

      const [bank] = (await tx.execute(sql`
        SELECT id, account_type, account_subtype
          FROM chart_of_accounts
         WHERE tenant_id = current_tenant_id()
           AND id = ${input.bankAccountId}::uuid
           AND deleted_at IS NULL
         LIMIT 1
      `)) as unknown as Array<{ id: string; account_type: string; account_subtype: string | null }>;
      if (!bank) return { error: "BANK_NOT_FOUND" as const };
      if (bank.account_type !== "asset" || !["cash", "bank"].includes(bank.account_subtype ?? "")) {
        return { error: "INVALID_BANK_ACCOUNT" as const };
      }

      const entryDate = input.paymentDate ?? new Date().toISOString().slice(0, 10);
      const memo = input.memo
        ? `WHT remittance · ${input.memo}`
        : input.reference
          ? `WHT remittance · ${input.reference}`
          : "WHT remittance to IRD";

      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate,
        memo,
        sourceType: "wht_remit",
        postedByUserId: ctx.userId,
        lines: [
          {
            accountId: wht.id,
            drCents: input.amountCents,
            description: `WHT payable cleared · ${input.reference ?? ""}`.trim(),
          },
          {
            accountId: bank.id,
            crCents: input.amountCents,
            description: `WHT remitted · ${input.reference ?? ""}`.trim(),
          },
        ],
      });

      return { ok: true as const, entryId, entryNumber };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NO_WHT_ACCOUNT: "No WHT payable account configured.",
        BANK_NOT_FOUND: "Bank account not found.",
        INVALID_BANK_ACCOUNT: "That account isn't a bank/cash account.",
      };
      const code = result.error as string;
      return reply.status(400).send({
        error: { code, message: msgs[code] ?? code },
      });
    }
    return reply.send(result);
  });
};
