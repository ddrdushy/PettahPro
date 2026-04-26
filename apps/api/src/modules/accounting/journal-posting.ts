import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { schema, nextDocumentNumber } from "@pettahpro/db";

export interface PostingLine {
  accountId: string;
  drCents?: number;
  crCents?: number;
  description?: string;
  customerId?: string | null;
  supplierId?: string | null;
  itemId?: string | null;
  // Cost center dimension (#129 / gaps B1). Stamped onto journal_lines
  // for cost-center-filtered reporting. Optional — null lines roll up
  // under "Unassigned" in the P&L cost-center filter.
  costCenterId?: string | null;
}

export interface PostJournalInput {
  tenantId: string;
  entryDate: string;              // ISO date
  memo?: string;
  sourceType?: string;
  sourceId?: string;
  postedByUserId?: string;
  lines: PostingLine[];
}

/**
 * Core ledger primitive. Call from within a transaction that has already
 * SET LOCAL app.tenant_id. Allocates a journal number, resolves the
 * fiscal period for the date, inserts entry + lines, and relies on the
 * deferred balance-check trigger to reject unbalanced postings.
 */
export async function postJournal(
  tx: PostgresJsDatabase<typeof schema>,
  input: PostJournalInput,
): Promise<{ entryId: string; entryNumber: string }> {
  if (input.lines.length < 2) {
    throw new Error("Journal entry needs at least 2 lines");
  }

  const drTotal = input.lines.reduce((s, l) => s + (l.drCents ?? 0), 0);
  const crTotal = input.lines.reduce((s, l) => s + (l.crCents ?? 0), 0);
  if (drTotal === 0) throw new Error("Journal entry has no debit amounts");
  if (drTotal !== crTotal) {
    throw new Error(`Journal unbalanced: dr=${drTotal} cr=${crTotal}`);
  }

  // Allocate entry number via sequence
  const entryNumber = await nextDocumentNumber(tx, "journal");

  // Resolve fiscal period and enforce lock. Lazily creates a fresh 'open'
  // period if none exists for this date (tenants don't pre-seed beyond a
  // ±12 month window). Both 'soft_closed' and 'closed' block new postings —
  // caller must unlock the period first.
  const fiscalPeriodId = await resolveAndCheckPeriod(tx, input.tenantId, input.entryDate);

  const [entry] = await tx
    .insert(schema.journalEntries)
    .values({
      tenantId: input.tenantId,
      entryNumber,
      entryDate: input.entryDate,
      fiscalPeriodId,
      memo: input.memo ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      postedByUserId: input.postedByUserId ?? null,
    })
    .returning({ id: schema.journalEntries.id });
  if (!entry) throw new Error("Journal entry insert failed");

  await tx.insert(schema.journalLines).values(
    input.lines.map((l, idx) => ({
      tenantId: input.tenantId,
      journalEntryId: entry.id,
      lineNo: (idx + 1) as number,
      accountId: l.accountId,
      drCents: l.drCents ?? 0,
      crCents: l.crCents ?? 0,
      description: l.description ?? null,
      customerId: l.customerId ?? null,
      supplierId: l.supplierId ?? null,
      itemId: l.itemId ?? null,
      costCenterId: l.costCenterId ?? null,
    })),
  );

  return { entryId: entry.id, entryNumber };
}

/**
 * Looks up the fiscal period for a posting date; auto-creates it as 'open'
 * if none exists. Throws PERIOD_LOCKED (with details) if the period is
 * soft_closed or closed — callers should unlock the period before posting.
 *
 * Exposed for the rare case a module needs to pre-flight a date (e.g. to
 * show a friendlier error before the user fills out a whole invoice).
 */
export async function resolveAndCheckPeriod(
  tx: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  entryDate: string,
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT id, status FROM fiscal_periods
     WHERE tenant_id = ${tenantId}::uuid
       AND starts_on <= ${entryDate}::date
       AND ends_on   >= ${entryDate}::date
     LIMIT 1
  `)) as unknown as Array<{ id: string; status: string }>;

  let row = rows[0];
  if (!row) {
    // Lazy create: open period covering this calendar month.
    const created = (await tx.execute(sql`
      INSERT INTO fiscal_periods (tenant_id, fiscal_year, period_no, starts_on, ends_on, status)
      VALUES (
        ${tenantId}::uuid,
        EXTRACT(year FROM ${entryDate}::date)::smallint,
        EXTRACT(month FROM ${entryDate}::date)::smallint,
        date_trunc('month', ${entryDate}::date)::date,
        (date_trunc('month', ${entryDate}::date) + interval '1 month' - interval '1 day')::date,
        'open'
      )
      ON CONFLICT (tenant_id, fiscal_year, period_no) DO UPDATE
        SET updated_at = now()
      RETURNING id, status
    `)) as unknown as Array<{ id: string; status: string }>;
    row = created[0]!;
  }

  if (row.status !== "open") {
    const err = new Error(
      `PERIOD_LOCKED: the fiscal period containing ${entryDate} is ${row.status}. Unlock the period to post here.`,
    ) as Error & { code?: string; periodStatus?: string };
    err.code = "PERIOD_LOCKED";
    err.periodStatus = row.status;
    throw err;
  }
  return row.id;
}
