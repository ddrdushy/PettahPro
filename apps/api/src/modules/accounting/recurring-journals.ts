import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, type Database } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "./journal-posting.js";

// -----------------------------------------------------------------------------
// Recurring journal templates — accrual / amortization automation. Completes
// the recurring trio (invoices → AR, bills → AP, journals → GL).
//
// See 48-recurring-journals.sql for schema rationale. Two paths when due:
//   auto_post = true  → postJournal() immediately, entry lands in GL
//   auto_post = false → dropped in journal_entry_drafts, shows up in the
//                       existing /app/journals/approvals queue
//
// Memo templating: the template's memo_template runs through renderMemo at
// generate time so "{MMM} {YYYY} rent accrual" becomes "Aug 2026 rent
// accrual" on the posted entry. Saves tenants re-typing the month.
// -----------------------------------------------------------------------------

const LineSchema = z
  .object({
    accountId: z.string().uuid(),
    drCents: z.number().int().min(0).default(0),
    crCents: z.number().int().min(0).default(0),
    description: z.string().trim().max(500).optional().or(z.literal("")),
    customerId: z.string().uuid().optional(),
    supplierId: z.string().uuid().optional(),
  })
  .refine((l) => (l.drCents ?? 0) > 0 || (l.crCents ?? 0) > 0, {
    message: "Each line must have a debit or credit amount",
  })
  .refine((l) => !((l.drCents ?? 0) > 0 && (l.crCents ?? 0) > 0), {
    message: "A line can't have both a debit and a credit",
  });

const CreateSchema = z
  .object({
    scheduleName: z.string().min(1).max(200),
    frequency: z.enum(["monthly"]).default("monthly"),
    dayOfMonth: z.number().int().min(1).max(28).default(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    autoPost: z.boolean().default(false),
    memoTemplate: z.string().max(500).optional().or(z.literal("")),
    notes: z.string().optional().or(z.literal("")),
    lines: z.array(LineSchema).min(2),
  })
  .refine(
    (v) => {
      const dr = v.lines.reduce((s, l) => s + (l.drCents ?? 0), 0);
      const cr = v.lines.reduce((s, l) => s + (l.crCents ?? 0), 0);
      return dr > 0 && dr === cr;
    },
    { message: "Template must balance (DR total = CR total, both > 0)", path: ["lines"] },
  );

const UpdateSchema = CreateSchema._def.schema
  .partial()
  .extend({ isActive: z.boolean().optional() });

// -----------------------------------------------------------------------------
// Date math — same rules as recurring-invoices / recurring-bills. Day-of-month
// is clamped to 1..28 on the schema so February edge cases don't bite.
// -----------------------------------------------------------------------------

export function computeNextRunDate(
  fromDate: string,
  frequency: "monthly",
  dayOfMonth: number,
): string {
  const d = new Date(`${fromDate}T00:00:00Z`);
  if (frequency === "monthly") {
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(Math.min(dayOfMonth, 28));
  }
  return d.toISOString().slice(0, 10);
}

function computeFirstRunDate(startDate: string, dayOfMonth: number): string {
  const d = new Date(`${startDate}T00:00:00Z`);
  const startDay = d.getUTCDate();
  if (startDay > dayOfMonth) {
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  d.setUTCDate(Math.min(dayOfMonth, 28));
  return d.toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// Memo templating
// -----------------------------------------------------------------------------
// Tokens:
//   {YYYY} → 4-digit year of the run date
//   {YY}   → 2-digit year
//   {MM}   → zero-padded month number (01..12)
//   {MMM}  → short English month name (Jan, Feb, …)
//   {MONTH}→ full English month name (January, February, …)
//
// Deliberately English-only in v1. A SL SME needing Sinhala/Tamil memos can
// still type the literal memo on the template — the tokens are a convenience
// for the common case.
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function renderMemo(template: string | null, runDate: string): string | null {
  if (!template) return null;
  const d = new Date(`${runDate}T00:00:00Z`);
  const yyyy = d.getUTCFullYear().toString();
  const yy = yyyy.slice(-2);
  const mIdx = d.getUTCMonth();
  const mm = String(mIdx + 1).padStart(2, "0");
  return template
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yy)
    .replace(/\{MM\}/g, mm)
    .replace(/\{MMM\}/g, MONTH_SHORT[mIdx] ?? "")
    .replace(/\{MONTH\}/g, MONTH_FULL[mIdx] ?? "");
}

// -----------------------------------------------------------------------------
// Core generator — shared by worker cron and manual "generate now". Runs
// inside an existing transaction; caller wraps in withTenant.
//
// auto_post = true  → posts immediately via the journal-posting choke point
//                     (period lock, balance check, sequence allocation all
//                     honored). Returns { entryId }.
// auto_post = false → inserts into journal_entry_drafts with status
//                     'pending_approval'. The existing approval UI handles
//                     the rest. Returns { draftId }.
//
// In both paths the template's generated_count, last_run_date and
// next_run_date are advanced.
// -----------------------------------------------------------------------------

export async function generateJournalFromTemplate(
  tx: Database,
  tenantId: string,
  templateId: string,
  userId: string | null,
): Promise<
  | { entryId: string; entryNumber: string }
  | { draftId: string }
  | { error: string }
> {
  const [tmpl] = await tx
    .select()
    .from(schema.recurringJournals)
    .where(
      and(
        eq(schema.recurringJournals.tenantId, tenantId),
        eq(schema.recurringJournals.id, templateId),
        isNull(schema.recurringJournals.deletedAt),
      ),
    )
    .limit(1);
  if (!tmpl) return { error: "NOT_FOUND" };
  if (!tmpl.isActive) return { error: "NOT_ACTIVE" };

  const tmplLines = await tx
    .select()
    .from(schema.recurringJournalLines)
    .where(eq(schema.recurringJournalLines.recurringJournalId, tmpl.id))
    .orderBy(asc(schema.recurringJournalLines.lineNo));
  if (tmplLines.length < 2) return { error: "NO_LINES" };

  // Balance-check in-memory before we hit the ledger. postJournal will
  // re-check; this is a friendlier error before we allocate resources.
  const drTotal = tmplLines.reduce((s, l) => s + l.drCents, 0);
  const crTotal = tmplLines.reduce((s, l) => s + l.crCents, 0);
  if (drTotal === 0 || drTotal !== crTotal) return { error: "UNBALANCED" };

  const today = new Date().toISOString().slice(0, 10);
  const memo = renderMemo(tmpl.memoTemplate, today);

  // Validate accounts belong to this tenant (RLS should guard but an explicit
  // check makes the error message kinder than "PERMISSION DENIED").
  const acctIds = Array.from(new Set(tmplLines.map((l) => l.accountId)));
  const acctRows = await tx
    .select({ id: schema.chartOfAccounts.id })
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        isNull(schema.chartOfAccounts.deletedAt),
      ),
    );
  const validAcctIds = new Set(acctRows.map((a) => a.id));
  for (const id of acctIds) {
    if (!validAcctIds.has(id)) return { error: "ACCOUNT_MISSING" };
  }

  const postingLines = tmplLines.map((l) => ({
    accountId: l.accountId,
    drCents: l.drCents,
    crCents: l.crCents,
    description: l.description ?? undefined,
    customerId: l.customerId ?? null,
    supplierId: l.supplierId ?? null,
  }));

  if (tmpl.autoPost) {
    // Auto-post path — goes straight through the journal-posting choke point.
    // If the period is soft_closed or closed, postJournal throws PERIOD_LOCKED
    // and this run errors out. That's intentional: we don't want a cron to
    // silently overwrite a closed period's books.
    try {
      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId,
        entryDate: today,
        memo: memo ?? undefined,
        sourceType: "recurring_journal",
        sourceId: tmpl.id,
        postedByUserId: userId ?? undefined,
        lines: postingLines,
      });

      const newNextRun = computeNextRunDate(tmpl.nextRunDate, "monthly", tmpl.dayOfMonth);
      await tx
        .update(schema.recurringJournals)
        .set({
          lastRunDate: today,
          nextRunDate: newNextRun,
          generatedCount: tmpl.generatedCount + 1,
          lastGeneratedEntryId: entryId,
          updatedAt: new Date(),
        })
        .where(eq(schema.recurringJournals.id, tmpl.id));

      return { entryId, entryNumber };
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "PERIOD_LOCKED") return { error: "PERIOD_LOCKED" };
      throw err;
    }
  } else {
    // Review-queue path — pile into journal_entry_drafts. Payload mirrors
    // what the existing approval-flow /journal-entries/drafts/:id/approve
    // route consumes (lines as plain objects under a `lines` key).
    const payload = {
      lines: postingLines.map((l) => ({
        accountId: l.accountId,
        drCents: l.drCents,
        crCents: l.crCents,
        description: l.description ?? null,
        customerId: l.customerId ?? null,
        supplierId: l.supplierId ?? null,
      })),
      source: {
        kind: "recurring_journal",
        templateId: tmpl.id,
        scheduleName: tmpl.scheduleName,
      },
    };

    const [draft] = await tx
      .insert(schema.journalEntryDrafts)
      .values({
        tenantId,
        entryDate: today,
        memo,
        totalCents: drTotal,
        payload,
        status: "pending_approval",
        createdByUserId: userId,
      })
      .returning({ id: schema.journalEntryDrafts.id });
    if (!draft) return { error: "DRAFT_INSERT_FAILED" };

    const newNextRun = computeNextRunDate(tmpl.nextRunDate, "monthly", tmpl.dayOfMonth);
    await tx
      .update(schema.recurringJournals)
      .set({
        lastRunDate: today,
        nextRunDate: newNextRun,
        generatedCount: tmpl.generatedCount + 1,
        lastGeneratedDraftId: draft.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.recurringJournals.id, tmpl.id));

    return { draftId: draft.id };
  }
}

// -----------------------------------------------------------------------------
// Worker entrypoint. Same shape as runDueRecurringBills — iterate due rows
// via the SECURITY DEFINER helper, process each in its own withTenant tx so
// one bad template can't poison siblings.
// -----------------------------------------------------------------------------

export async function runDueRecurringJournals(
  db: Database,
  log: {
    info: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  },
): Promise<{ posted: number; queued: number; errors: number }> {
  const today = new Date().toISOString().slice(0, 10);

  const dueRows = (await db.execute(sql`
    SELECT id, tenant_id FROM list_due_recurring_journals(${today}::date)
  `)) as unknown as Array<{ id: string; tenant_id: string }>;

  let posted = 0;
  let queued = 0;
  let errors = 0;
  for (const row of dueRows) {
    try {
      const result = await withTenant(row.tenant_id, (tx) =>
        generateJournalFromTemplate(tx, row.tenant_id, row.id, null),
      );
      if ("error" in result) {
        errors++;
        log.error(
          { templateId: row.id, tenantId: row.tenant_id, error: result.error },
          "recurring journal skipped",
        );
      } else if ("entryId" in result) {
        posted++;
        log.info(
          { templateId: row.id, tenantId: row.tenant_id, entryId: result.entryId },
          "recurring journal posted",
        );
      } else {
        queued++;
        log.info(
          { templateId: row.id, tenantId: row.tenant_id, draftId: result.draftId },
          "recurring journal queued for approval",
        );
      }
    } catch (err) {
      errors++;
      log.error(
        { templateId: row.id, tenantId: row.tenant_id, err },
        "recurring journal failed",
      );
    }
  }
  return { posted, queued, errors };
}

// -----------------------------------------------------------------------------
// REST routes
// -----------------------------------------------------------------------------

export const recurringJournalsRoutes: FastifyPluginAsync = async (fastify) => {
  // List
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.recurringJournals)
        .where(
          and(
            eq(schema.recurringJournals.tenantId, ctx.tenantId),
            isNull(schema.recurringJournals.deletedAt),
          ),
        )
        .orderBy(asc(schema.recurringJournals.nextRunDate))
        .limit(200),
    );

    // Attach a DR-total per row so the list can show the amount without a
    // separate request per row. Cheap join on the (tenant, recurring_journal)
    // composite index.
    const totalsRaw = rows.length
      ? ((await withTenant(ctx.tenantId, async (tx) =>
          tx.execute(sql`
            SELECT recurring_journal_id::text AS id,
                   SUM(dr_cents)::bigint AS total_cents
              FROM recurring_journal_lines
             WHERE tenant_id = ${ctx.tenantId}::uuid
             GROUP BY recurring_journal_id
          `),
        )) as unknown as Array<{ id: string; total_cents: number | string }>)
      : [];
    const totalById = new Map(totalsRaw.map((r) => [r.id, Number(r.total_cents)]));

    return reply.send({
      recurringJournals: rows.map((r) => ({
        id: r.id,
        scheduleName: r.scheduleName,
        frequency: r.frequency,
        dayOfMonth: r.dayOfMonth,
        startDate: r.startDate,
        endDate: r.endDate,
        nextRunDate: r.nextRunDate,
        lastRunDate: r.lastRunDate,
        autoPost: r.autoPost,
        memoTemplate: r.memoTemplate,
        isActive: r.isActive,
        pausedAt: r.pausedAt ? r.pausedAt.toISOString() : null,
        generatedCount: r.generatedCount,
        lastGeneratedEntryId: r.lastGeneratedEntryId,
        lastGeneratedDraftId: r.lastGeneratedDraftId,
        totalCents: totalById.get(r.id) ?? 0,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  // Detail
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [tmpl] = await tx
        .select()
        .from(schema.recurringJournals)
        .where(
          and(
            eq(schema.recurringJournals.tenantId, ctx.tenantId),
            eq(schema.recurringJournals.id, req.params.id),
            isNull(schema.recurringJournals.deletedAt),
          ),
        )
        .limit(1);
      if (!tmpl) return null;
      const lines = await tx
        .select()
        .from(schema.recurringJournalLines)
        .where(eq(schema.recurringJournalLines.recurringJournalId, tmpl.id))
        .orderBy(asc(schema.recurringJournalLines.lineNo));
      return { recurringJournal: tmpl, lines };
    });
    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // Create
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Validate all account ids belong to this tenant (kinder error than RLS).
      const acctIds = Array.from(new Set(input.lines.map((l) => l.accountId)));
      const acctRows = await tx
        .select({ id: schema.chartOfAccounts.id })
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        );
      const valid = new Set(acctRows.map((a) => a.id));
      for (const id of acctIds) {
        if (!valid.has(id)) return { error: "ACCOUNT_MISSING" as const };
      }

      const nextRunDate = computeFirstRunDate(input.startDate, input.dayOfMonth);

      const [row] = await tx
        .insert(schema.recurringJournals)
        .values({
          tenantId: ctx.tenantId,
          scheduleName: input.scheduleName,
          frequency: input.frequency,
          dayOfMonth: input.dayOfMonth,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          nextRunDate,
          autoPost: input.autoPost,
          memoTemplate:
            input.memoTemplate && input.memoTemplate.trim()
              ? input.memoTemplate.trim()
              : null,
          notes: input.notes && input.notes.trim() ? input.notes.trim() : null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!row) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.recurringJournalLines).values(
        input.lines.map((l, idx) => ({
          tenantId: ctx.tenantId,
          recurringJournalId: row.id,
          lineNo: idx + 1,
          accountId: l.accountId,
          drCents: l.drCents ?? 0,
          crCents: l.crCents ?? 0,
          description:
            l.description && l.description.trim() ? l.description.trim() : null,
          customerId: l.customerId ?? null,
          supplierId: l.supplierId ?? null,
        })),
      );
      return { recurringJournal: row };
    });

    if ("error" in result) {
      const code = result.error;
      return reply.status(400).send({ error: { code } });
    }
    return reply.status(201).send(result);
  });

  // Update
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    // If lines are provided they must still balance.
    if (input.lines) {
      const dr = input.lines.reduce((s, l) => s + (l.drCents ?? 0), 0);
      const cr = input.lines.reduce((s, l) => s + (l.crCents ?? 0), 0);
      if (dr === 0 || dr !== cr) {
        return reply.status(400).send({ error: { code: "UNBALANCED" } });
      }
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.recurringJournals)
        .where(
          and(
            eq(schema.recurringJournals.tenantId, ctx.tenantId),
            eq(schema.recurringJournals.id, req.params.id),
            isNull(schema.recurringJournals.deletedAt),
          ),
        )
        .limit(1);
      if (!existing) return { error: "NOT_FOUND" as const };

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.scheduleName !== undefined) updates.scheduleName = input.scheduleName;
      if (input.dayOfMonth !== undefined) updates.dayOfMonth = input.dayOfMonth;
      if (input.startDate !== undefined) updates.startDate = input.startDate;
      if (input.endDate !== undefined) updates.endDate = input.endDate || null;
      if (input.autoPost !== undefined) updates.autoPost = input.autoPost;
      if (input.memoTemplate !== undefined) {
        updates.memoTemplate =
          input.memoTemplate && input.memoTemplate.trim()
            ? input.memoTemplate.trim()
            : null;
      }
      if (input.notes !== undefined) {
        updates.notes = input.notes && input.notes.trim() ? input.notes.trim() : null;
      }
      if (input.isActive !== undefined) updates.isActive = input.isActive;

      await tx
        .update(schema.recurringJournals)
        .set(updates)
        .where(eq(schema.recurringJournals.id, existing.id));

      if (input.lines) {
        await tx
          .delete(schema.recurringJournalLines)
          .where(eq(schema.recurringJournalLines.recurringJournalId, existing.id));
        await tx.insert(schema.recurringJournalLines).values(
          input.lines.map((l, idx) => ({
            tenantId: ctx.tenantId,
            recurringJournalId: existing.id,
            lineNo: idx + 1,
            accountId: l.accountId,
            drCents: l.drCents ?? 0,
            crCents: l.crCents ?? 0,
            description:
              l.description && l.description.trim() ? l.description.trim() : null,
            customerId: l.customerId ?? null,
            supplierId: l.supplierId ?? null,
          })),
        );
      }
      return { ok: true as const };
    });

    if ("error" in result) {
      return reply.status(404).send({ error: { code: result.error } });
    }
    return reply.send(result);
  });

  // Pause
  fastify.post<{ Params: { id: string } }>("/:id/pause", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    await withTenant(ctx.tenantId, async (tx) => {
      await tx
        .update(schema.recurringJournals)
        .set({ isActive: false, pausedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.recurringJournals.tenantId, ctx.tenantId),
            eq(schema.recurringJournals.id, req.params.id),
          ),
        );
    });
    return reply.send({ ok: true });
  });

  // Resume
  fastify.post<{ Params: { id: string } }>("/:id/resume", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    await withTenant(ctx.tenantId, async (tx) => {
      await tx
        .update(schema.recurringJournals)
        .set({ isActive: true, pausedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.recurringJournals.tenantId, ctx.tenantId),
            eq(schema.recurringJournals.id, req.params.id),
          ),
        );
    });
    return reply.send({ ok: true });
  });

  // Generate now — manual trigger ahead of the scheduled tick. Returns
  // entryId (auto-post path) or draftId (review-queue path) so the UI can
  // deep-link to the right destination.
  fastify.post<{ Params: { id: string } }>("/:id/generate-now", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, (tx) =>
      generateJournalFromTemplate(tx, ctx.tenantId, req.params.id, ctx.userId),
    );
    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Recurring journal not found.",
        NOT_ACTIVE: "Can't generate from a paused template. Resume it first.",
        NO_LINES: "Template has fewer than 2 lines.",
        UNBALANCED: "Template is unbalanced — DR total must equal CR total.",
        ACCOUNT_MISSING: "One of the accounts on this template has been deleted.",
        PERIOD_LOCKED: "Today's period is closed. Unlock it or post back-dated.",
        DRAFT_INSERT_FAILED: "Couldn't queue the draft for approval.",
      };
      const code = result.error;
      const status = code === "NOT_FOUND" ? 404 : 400;
      return reply
        .status(status)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    if ("entryId" in result) {
      return reply.send({ ok: true, entryId: result.entryId, entryNumber: result.entryNumber });
    }
    return reply.send({ ok: true, draftId: result.draftId });
  });

  // Soft delete
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    await withTenant(ctx.tenantId, async (tx) => {
      await tx
        .update(schema.recurringJournals)
        .set({ deletedAt: new Date(), isActive: false })
        .where(
          and(
            eq(schema.recurringJournals.tenantId, ctx.tenantId),
            eq(schema.recurringJournals.id, req.params.id),
          ),
        );
    });
    return reply.send({ ok: true });
  });
};
