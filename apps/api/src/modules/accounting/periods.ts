import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "./journal-posting.js";
import { emitNotification } from "../notifications/emit.js";

export type PeriodStatus = "open" | "soft_closed" | "closed";

interface PeriodRow {
  id: string;
  fiscalYear: number;
  periodNo: number;
  startsOn: string;
  endsOn: string;
  status: PeriodStatus;
  closedAt: string | null;
  closedByUserId: string | null;
  lastReason: string | null;
  reopenedCount: number;
  closingJournalEntryId: string | null;
  entryCount: number;
}

const ReasonBody = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(500),
});

const CloseYearBody = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  reason: z.string().trim().min(1).max(500),
  retainedEarningsAccountId: z.string().uuid(),
});

// Ensure a ±12-month window of periods exists for the tenant. Idempotent.
// Called from the list endpoint so navigating to the page after time has
// passed naturally materializes fresh months.
async function ensurePeriodWindow(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO fiscal_periods (tenant_id, fiscal_year, period_no, starts_on, ends_on, status)
    SELECT
      ${tenantId}::uuid,
      EXTRACT(year FROM d)::smallint,
      EXTRACT(month FROM d)::smallint,
      date_trunc('month', d)::date,
      (date_trunc('month', d) + interval '1 month' - interval '1 day')::date,
      'open'
    FROM generate_series(
      date_trunc('month', CURRENT_DATE - interval '12 months'),
      date_trunc('month', CURRENT_DATE + interval '12 months'),
      interval '1 month'
    ) AS d
    ON CONFLICT (tenant_id, fiscal_year, period_no) DO NOTHING
  `);
}

function monthName(n: number): string {
  return [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][n - 1] ?? `Month ${n}`;
}

export const periodsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /periods — list all periods, newest first, with entry counts so the
  // UI can show "23 journals this month".
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      await ensurePeriodWindow(tx, ctx.tenantId);

      const rows = (await tx.execute(sql`
        SELECT p.id,
               p.fiscal_year,
               p.period_no,
               p.starts_on::text AS starts_on,
               p.ends_on::text   AS ends_on,
               p.status,
               p.closed_at,
               p.closed_by_user_id,
               p.last_reason,
               p.reopened_count,
               p.closing_journal_entry_id,
               (SELECT COUNT(*)::int FROM journal_entries je
                 WHERE je.tenant_id = p.tenant_id
                   AND je.fiscal_period_id = p.id) AS entry_count
          FROM fiscal_periods p
         WHERE p.tenant_id = current_tenant_id()
         ORDER BY p.starts_on DESC
      `)) as unknown as Array<{
        id: string;
        fiscal_year: number;
        period_no: number;
        starts_on: string;
        ends_on: string;
        status: PeriodStatus;
        closed_at: string | null;
        closed_by_user_id: string | null;
        last_reason: string | null;
        reopened_count: number;
        closing_journal_entry_id: string | null;
        entry_count: number;
      }>;

      const periods: PeriodRow[] = rows.map((r) => ({
        id: r.id,
        fiscalYear: r.fiscal_year,
        periodNo: r.period_no,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        status: r.status,
        closedAt: r.closed_at,
        closedByUserId: r.closed_by_user_id,
        lastReason: r.last_reason,
        reopenedCount: r.reopened_count,
        closingJournalEntryId: r.closing_journal_entry_id,
        entryCount: r.entry_count,
      }));
      return { periods };
    });
    return reply.send(data);
  });

  // POST /periods/:id/soft-close — month-end lock, low-friction reopen.
  fastify.post<{ Params: { id: string } }>("/:id/soft-close", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const parsed = ReasonBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const rows = (await tx.execute(sql`
        UPDATE fiscal_periods
           SET status = 'soft_closed',
               closed_at = now(),
               closed_by_user_id = ${ctx.userId}::uuid,
               last_reason = ${parsed.data.reason},
               updated_at = now()
         WHERE id = ${req.params.id}::uuid
           AND tenant_id = current_tenant_id()
           AND status = 'open'
        RETURNING id, fiscal_year, period_no
      `)) as unknown as Array<{ id: string; fiscal_year: number; period_no: number }>;
      if (rows.length === 0) {
        return { error: "NOT_OPEN" as const };
      }

      const p = rows[0]!;
      await emitNotification(tx, {
        tenantId: ctx.tenantId,
        kind: "period_closed",
        title: `Period soft-closed: ${monthName(p.period_no)} ${p.fiscal_year}`,
        body: parsed.data.reason,
        refType: "fiscal_period",
        refId: p.id,
      });
      return { ok: true };
    });

    if ("error" in result) {
      return reply
        .status(400)
        .send({ error: { code: result.error, message: "Period isn't open — nothing to soft-close." } });
    }
    return reply.send(result);
  });

  // POST /periods/:id/reopen — unlock back to 'open'. Works for both soft
  // and hard closed periods; hard closures increment reopened_count so
  // repeated reopens are visible in audit.
  fastify.post<{ Params: { id: string } }>("/:id/reopen", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const parsed = ReasonBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const rows = (await tx.execute(sql`
        UPDATE fiscal_periods
           SET status = 'open',
               closed_at = NULL,
               closed_by_user_id = NULL,
               last_reason = ${parsed.data.reason},
               reopened_count = CASE WHEN status = 'closed' THEN reopened_count + 1 ELSE reopened_count END,
               updated_at = now()
         WHERE id = ${req.params.id}::uuid
           AND tenant_id = current_tenant_id()
           AND status IN ('soft_closed', 'closed')
        RETURNING id, fiscal_year, period_no, status
      `)) as unknown as Array<{ id: string; fiscal_year: number; period_no: number; status: string }>;
      if (rows.length === 0) {
        return { error: "NOT_CLOSED" as const };
      }

      const p = rows[0]!;
      await emitNotification(tx, {
        tenantId: ctx.tenantId,
        kind: "period_reopened",
        title: `Period reopened: ${monthName(p.period_no)} ${p.fiscal_year}`,
        body: parsed.data.reason,
        refType: "fiscal_period",
        refId: p.id,
      });
      return { ok: true };
    });

    if ("error" in result) {
      return reply
        .status(400)
        .send({ error: { code: result.error, message: "Period isn't closed — nothing to reopen." } });
    }
    return reply.send(result);
  });

  // POST /periods/close-year — ceremonial year-end close. Posts a P&L-to-
  // retained-earnings transfer JE dated the last day of the fiscal year,
  // then hard-closes all 12 periods for that year. Requires retained
  // earnings account (caller picks from Equity subtype).
  fastify.post("/close-year", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const parsed = CloseYearBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { fiscalYear, reason, retainedEarningsAccountId } = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Verify all 12 periods exist for the year.
      const periods = (await tx.execute(sql`
        SELECT id, period_no, starts_on::text AS starts_on, ends_on::text AS ends_on, status
          FROM fiscal_periods
         WHERE tenant_id = current_tenant_id()
           AND fiscal_year = ${fiscalYear}
         ORDER BY period_no ASC
      `)) as unknown as Array<{
        id: string;
        period_no: number;
        starts_on: string;
        ends_on: string;
        status: PeriodStatus;
      }>;
      if (periods.length !== 12) {
        return { error: "PERIODS_MISSING" as const };
      }
      if (periods.some((p) => p.status === "closed")) {
        return { error: "ALREADY_CLOSED" as const };
      }

      // Sum income & expense account balances from journals in this year.
      // Income has credit-normal balance; expense has debit-normal.
      const balances = (await tx.execute(sql`
        SELECT coa.id AS account_id,
               coa.code,
               coa.name,
               coa.account_type,
               coa.normal_side,
               COALESCE(SUM(jl.dr_cents), 0)::bigint AS dr_total,
               COALESCE(SUM(jl.cr_cents), 0)::bigint AS cr_total
          FROM chart_of_accounts coa
          LEFT JOIN journal_lines jl ON jl.account_id = coa.id
          LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE coa.tenant_id = current_tenant_id()
           AND coa.account_type IN ('income', 'expense')
           AND coa.deleted_at IS NULL
           AND je.entry_date >= ${periods[0]!.starts_on}::date
           AND je.entry_date <= ${periods[11]!.ends_on}::date
         GROUP BY coa.id, coa.code, coa.name, coa.account_type, coa.normal_side
        HAVING COALESCE(SUM(jl.dr_cents), 0) <> 0
            OR COALESCE(SUM(jl.cr_cents), 0) <> 0
      `)) as unknown as Array<{
        account_id: string;
        code: string;
        name: string;
        account_type: "income" | "expense";
        normal_side: "dr" | "cr";
        dr_total: number | string;
        cr_total: number | string;
      }>;

      // Build zero-out lines: for each income account, DR to zero it (against
      // retained earnings CR). For each expense, CR to zero it (against
      // retained earnings DR). Net of both = YTD profit posted to RE.
      const lines: Array<{
        accountId: string;
        drCents?: number;
        crCents?: number;
        description?: string;
      }> = [];
      let incomeTotal = 0;
      let expenseTotal = 0;
      for (const b of balances) {
        const dr = Number(b.dr_total);
        const cr = Number(b.cr_total);
        const balance = cr - dr; // positive = credit balance (income); negative = debit balance (expense)
        if (b.account_type === "income") {
          // Credit balance → DR to close.
          if (balance > 0) {
            lines.push({
              accountId: b.account_id,
              drCents: balance,
              description: `Year-end close · ${b.code} ${b.name}`,
            });
            incomeTotal += balance;
          }
        } else {
          // account_type === 'expense'. Debit balance → CR to close.
          const expenseBalance = dr - cr;
          if (expenseBalance > 0) {
            lines.push({
              accountId: b.account_id,
              crCents: expenseBalance,
              description: `Year-end close · ${b.code} ${b.name}`,
            });
            expenseTotal += expenseBalance;
          }
        }
      }

      const netProfit = incomeTotal - expenseTotal;
      if (netProfit !== 0) {
        // Offset to retained earnings. Profit → CR retained earnings; loss → DR.
        if (netProfit > 0) {
          lines.push({
            accountId: retainedEarningsAccountId,
            crCents: netProfit,
            description: `Retained earnings · FY${fiscalYear} net profit`,
          });
        } else {
          lines.push({
            accountId: retainedEarningsAccountId,
            drCents: -netProfit,
            description: `Retained earnings · FY${fiscalYear} net loss`,
          });
        }
      }

      let closingEntryId: string | null = null;
      let closingEntryNumber: string | null = null;
      if (lines.length > 0) {
        // Post against the last day of the fiscal year so the entry lands in
        // December (still 'open' at this point).
        const entry = await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: periods[11]!.ends_on,
          memo: `Year-end close FY${fiscalYear} · ${reason}`,
          sourceType: "year_close",
          postedByUserId: ctx.userId,
          lines,
        });
        closingEntryId = entry.entryId;
        closingEntryNumber = entry.entryNumber;
      }

      // Hard-close every period in the year.
      await tx.execute(sql`
        UPDATE fiscal_periods
           SET status = 'closed',
               closed_at = now(),
               closed_by_user_id = ${ctx.userId}::uuid,
               last_reason = ${reason},
               closing_journal_entry_id = CASE
                 WHEN period_no = 12 THEN ${closingEntryId}::uuid
                 ELSE closing_journal_entry_id
               END,
               updated_at = now()
         WHERE tenant_id = current_tenant_id()
           AND fiscal_year = ${fiscalYear}
      `);

      await emitNotification(tx, {
        tenantId: ctx.tenantId,
        kind: "year_closed",
        title: `Year-end close: FY${fiscalYear}`,
        body: closingEntryNumber
          ? `Closing entry ${closingEntryNumber} posted. Net ${netProfit >= 0 ? "profit" : "loss"}: ${Math.abs(netProfit / 100).toFixed(2)}`
          : "No P&L activity to close. Periods locked.",
        refType: "fiscal_year",
      });

      return {
        ok: true as const,
        closingEntryId,
        closingEntryNumber,
        incomeClosedCents: incomeTotal,
        expenseClosedCents: expenseTotal,
        netProfitCents: netProfit,
      };
    });

    if ("error" in result) {
      const code = result.error as string;
      const msgs: Record<string, string> = {
        PERIODS_MISSING: "Not all 12 months exist for that fiscal year.",
        ALREADY_CLOSED: "One or more months are already hard-closed. Reopen first.",
      };
      return reply.status(400).send({
        error: { code, message: msgs[code] ?? code },
      });
    }
    return reply.send(result);
  });
};
