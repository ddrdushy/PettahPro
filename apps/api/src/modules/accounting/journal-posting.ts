import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { schema } from "@pettahpro/db";

export interface PostingLine {
  accountId: string;
  drCents?: number;
  crCents?: number;
  description?: string;
  customerId?: string | null;
  supplierId?: string | null;
  itemId?: string | null;
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
  const [{ entry_number: entryNumber }] = (await tx.execute(
    sql`SELECT next_document_number('journal') AS entry_number`,
  )) as unknown as Array<{ entry_number: string }>;

  // Resolve fiscal period
  const periods = await tx
    .select({ id: schema.fiscalPeriods.id })
    .from(schema.fiscalPeriods)
    .where(
      and(
        eq(schema.fiscalPeriods.tenantId, input.tenantId),
        sql`${schema.fiscalPeriods.startsOn} <= ${input.entryDate}::date`,
        sql`${schema.fiscalPeriods.endsOn} >= ${input.entryDate}::date`,
      ),
    )
    .limit(1);
  const fiscalPeriodId = periods[0]?.id ?? null;

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
    })),
  );

  return { entryId: entry.id, entryNumber };
}
