import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "../accounting/journal-posting.js";

const STATUTORY_KINDS = ["epf", "etf", "paye"] as const;

const kindLabels: Record<(typeof STATUTORY_KINDS)[number], string> = {
  epf: "EPF",
  etf: "ETF",
  paye: "PAYE",
};

const RemitSchema = z.object({
  which: z.enum(STATUTORY_KINDS),
  bankAccountId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference: z.string().max(64).optional().or(z.literal("")),
  memo: z.string().optional().or(z.literal("")),
});

export const statutoryRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /payroll/statutory-summary — outstanding balance of each payable
  fastify.get("/statutory-summary", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx.execute(sql`
        SELECT
          coa.id                            AS account_id,
          coa.code,
          coa.name,
          coa.account_subtype,
          COALESCE(SUM(jl.cr_cents - jl.dr_cents), 0)::bigint AS balance_cents
        FROM chart_of_accounts coa
        LEFT JOIN journal_lines jl
          ON jl.account_id = coa.id AND jl.tenant_id = coa.tenant_id
        WHERE coa.tenant_id = current_tenant_id()
          AND coa.deleted_at IS NULL
          AND coa.account_subtype IN ('epf','etf','paye')
        GROUP BY coa.id, coa.code, coa.name, coa.account_subtype
        ORDER BY coa.code
      `),
    );

    const list = (rows as unknown as Array<{
      account_id: string;
      code: string;
      name: string;
      account_subtype: "epf" | "etf" | "paye";
      balance_cents: number | string;
    }>).map((r) => ({
      accountId: r.account_id,
      accountCode: r.code,
      accountName: r.name,
      kind: r.account_subtype,
      balanceCents: Number(r.balance_cents),
    }));

    return reply.send({ statutory: list });
  });

  // POST /payroll/remit — DR selected payable, CR Bank
  fastify.post("/remit", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = RemitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Resolve bank account
      const bankRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.id, input.bankAccountId),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      const bank = bankRows[0];
      if (!bank) return { error: "BANK_NOT_FOUND" as const };
      if (bank.accountType !== "asset" || !["cash", "bank"].includes(bank.accountSubtype ?? "")) {
        return { error: "INVALID_BANK_ACCOUNT" as const };
      }

      // Resolve payable account
      const payableRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.accountSubtype, input.which),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      const payable = payableRows[0];
      if (!payable) return { error: "NO_PAYABLE_ACCOUNT" as const };

      // Compute current balance to make sure we're not over-remitting
      const [bal] = (await tx.execute(sql`
        SELECT COALESCE(SUM(cr_cents - dr_cents), 0)::bigint AS balance
        FROM journal_lines
        WHERE tenant_id = current_tenant_id()
          AND account_id = ${payable.id}
      `)) as unknown as Array<{ balance: number | string }>;
      const balance = Number(bal?.balance ?? 0);
      if (input.amountCents > balance) {
        return { error: "EXCEEDS_BALANCE" as const, balance };
      }

      const payDate = input.paymentDate ?? new Date().toISOString().slice(0, 10);
      const label = kindLabels[input.which];
      const refSuffix = input.reference ? ` · ${input.reference}` : "";

      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: payDate,
        memo: `${label} remittance${refSuffix}`,
        sourceType: `statutory_remit_${input.which}`,
        postedByUserId: ctx.userId,
        lines: [
          {
            accountId: payable.id,
            drCents: input.amountCents,
            description: `${label} remitted${refSuffix}`,
          },
          {
            accountId: bank.id,
            crCents: input.amountCents,
            description: `${label} payment via bank${refSuffix}`,
          },
        ],
      });

      return { ok: true as const, entryId, entryNumber };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        BANK_NOT_FOUND: 400,
        INVALID_BANK_ACCOUNT: 400,
        NO_PAYABLE_ACCOUNT: 500,
        EXCEEDS_BALANCE: 409,
      };
      const messages: Record<string, string> = {
        INVALID_BANK_ACCOUNT: "Pick a bank or cash account.",
        EXCEEDS_BALANCE: "Amount exceeds the outstanding balance for that payable.",
      };
      return reply.status(map[result.error] ?? 500).send({
        error: {
          code: result.error,
          message: messages[result.error],
          balance: "balance" in result ? result.balance : undefined,
        },
      });
    }
    return reply.status(201).send(result);
  });
};
