import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, type Database } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { computeBill } from "./bills.js";

// -----------------------------------------------------------------------------
// Recurring bills — AP symmetry of sell/recurring-invoices.ts.
//
// Template lives in `recurring_bills` + `recurring_bill_lines`. The hourly
// worker cron (apps/api/src/worker.ts) calls `runDueRecurringBills` to find
// due templates across every tenant and generate a draft bill for each.
//
// Why draft (not posted): bills come with a supplier invoice number that
// usually only shows up when the physical invoice arrives. Dropping the
// draft in AP's inbox lets them eyeball it, paste the supplier's actual
// number into `supplierBillNumber`, and post. This is the same model AP is
// already used to for manually-entered bills.
// -----------------------------------------------------------------------------

const LineSchema = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unitPriceCents: z.number().int().min(0),
  discountPctBps: z.number().int().min(0).max(10000).default(0),
  taxCodeId: z.string().uuid().optional(),
  expenseAccountId: z.string().uuid().optional(),
});

const CreateSchema = z.object({
  supplierId: z.string().uuid(),
  scheduleName: z.string().min(1).max(200),
  frequency: z.enum(["monthly"]).default("monthly"),
  dayOfMonth: z.number().int().min(1).max(28).default(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDays: z.number().int().min(0).max(365).default(30),
  currency: z.string().length(3).default("LKR"),
  supplierBillNumberTemplate: z.string().max(128).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  lines: z.array(LineSchema).min(1),
});

const UpdateSchema = CreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// -----------------------------------------------------------------------------
// Date math — same rules as recurring-invoices.ts. Day-of-month is clamped to
// 1..28 on the schema so February edge cases don't bite: picking the 30th
// would quietly skip to March 2 in a non-leap February.
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
// Supplier bill number templating
// -----------------------------------------------------------------------------
// Tokens:
//   {YYYY} → 4-digit year of the run date
//   {YY}   → 2-digit year
//   {MM}   → zero-padded month (01..12)
//   {SEQ}  → generated_count + 1 zero-padded to 2 digits (01, 02, …)
//
// Why not just the next_document_number infra? Because this is the
// *supplier's* invoice number shape — their own serial, not ours. Common SL
// landlord pattern: "RENT-{YYYY}{MM}" so a tenant doesn't have to think
// about what to type. We still allocate our own `internal_reference` at post
// time; the supplier number is strictly a hint.
function renderSupplierBillNumber(
  template: string | null,
  generatedCount: number,
  today: string,
): string | null {
  if (!template) return null;
  const d = new Date(`${today}T00:00:00Z`);
  const yyyy = d.getUTCFullYear().toString();
  const yy = yyyy.slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const seq = String(generatedCount + 1).padStart(2, "0");
  return template
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yy)
    .replace(/\{MM\}/g, mm)
    .replace(/\{SEQ\}/g, seq);
}

// -----------------------------------------------------------------------------
// Core generator — shared by the worker cron and the manual "generate now"
// route. Runs inside an existing transaction; caller wraps in withTenant.
// Never posts the bill (posting is AP's responsibility — they verify the
// supplier invoice first).
// -----------------------------------------------------------------------------

export async function generateBillFromTemplate(
  tx: Database,
  tenantId: string,
  templateId: string,
  userId: string | null,
): Promise<{ billId: string } | { error: string }> {
  const [tmpl] = await tx
    .select()
    .from(schema.recurringBills)
    .where(
      and(
        eq(schema.recurringBills.tenantId, tenantId),
        eq(schema.recurringBills.id, templateId),
        isNull(schema.recurringBills.deletedAt),
      ),
    )
    .limit(1);
  if (!tmpl) return { error: "NOT_FOUND" };
  if (!tmpl.isActive) return { error: "NOT_ACTIVE" };

  const tmplLines = await tx
    .select()
    .from(schema.recurringBillLines)
    .where(eq(schema.recurringBillLines.recurringBillId, tmpl.id))
    .orderBy(asc(schema.recurringBillLines.lineNo));
  if (tmplLines.length === 0) return { error: "NO_LINES" };

  // Supplier snapshot — we mainly care about the currency + payment terms
  // (for dueDate fallback). The supplier is ON DELETE RESTRICT on the
  // template so it shouldn't vanish mid-cycle.
  const [supplier] = await tx
    .select()
    .from(schema.suppliers)
    .where(
      and(
        eq(schema.suppliers.tenantId, tenantId),
        eq(schema.suppliers.id, tmpl.supplierId),
        isNull(schema.suppliers.deletedAt),
      ),
    )
    .limit(1);
  if (!supplier) return { error: "SUPPLIER_NOT_FOUND" };

  const today = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(new Date(today).getTime() + tmpl.dueDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const lineInputs = tmplLines.map((l) => ({
    itemId: l.itemId ?? undefined,
    description: l.description,
    quantity: Number(l.quantity),
    unitPriceCents: l.unitPriceCents,
    discountPctBps: l.discountPctBps,
    taxCodeId: l.taxCodeId ?? undefined,
    expenseAccountId: l.expenseAccountId ?? undefined,
  }));

  const { lines, subtotalCents, discountCents, taxCents, totalCents } =
    await computeBill(tx, tenantId, lineInputs);

  const supplierBillNumber = renderSupplierBillNumber(
    tmpl.supplierBillNumberTemplate,
    tmpl.generatedCount,
    today,
  );

  const autoNote = `Auto-generated from "${tmpl.scheduleName}"`;
  const notes = tmpl.notes ? `${tmpl.notes}\n\n(${autoNote})` : autoNote;

  const [bill] = await tx
    .insert(schema.bills)
    .values({
      tenantId,
      supplierId: tmpl.supplierId,
      supplierBillNumber,
      branchId: tmpl.branchId,
      status: "draft",
      billDate: today,
      dueDate,
      currency: tmpl.currency,
      subtotalCents,
      discountCents,
      taxCents,
      totalCents,
      balanceDueCents: totalCents,
      notes,
      createdByUserId: userId,
    })
    .returning();
  if (!bill) return { error: "INSERT_FAILED" };

  await tx.insert(schema.billLines).values(
    lines.map((l) => ({
      tenantId,
      billId: bill.id,
      lineNo: l.lineNo,
      itemId: l.itemId,
      description: l.description,
      quantity: l.quantity.toString(),
      unitPriceCents: l.unitPriceCents,
      lineSubtotalCents: l.lineSubtotalCents,
      discountPctBps: l.discountPctBps,
      discountCents: l.discountCents,
      taxCodeId: l.taxCodeId,
      taxRateBps: l.taxRateBps,
      taxCents: l.taxCents,
      lineTotalCents: l.lineTotalCents,
      expenseAccountId: l.expenseAccountId,
    })),
  );

  // Advance the schedule — push next_run_date forward one cycle from its
  // current value, not from today. Same reasoning as recurring-invoices:
  // keeps a force-generate from drifting the cycle.
  const newNextRun = computeNextRunDate(tmpl.nextRunDate, "monthly", tmpl.dayOfMonth);

  await tx
    .update(schema.recurringBills)
    .set({
      lastRunDate: today,
      nextRunDate: newNextRun,
      generatedCount: tmpl.generatedCount + 1,
      lastGeneratedBillId: bill.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.recurringBills.id, tmpl.id));

  return { billId: bill.id };
}

// -----------------------------------------------------------------------------
// Worker entrypoint — called by BullMQ's hourly scheduled job. Pulls due rows
// via the SECURITY DEFINER helper (no tenant context needed) and processes
// each inside its own withTenant tx so RLS is honored for the actual work.
// One bad template can't poison siblings.
// -----------------------------------------------------------------------------

export async function runDueRecurringBills(
  db: Database,
  log: {
    info: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  },
): Promise<{ generated: number; errors: number }> {
  const today = new Date().toISOString().slice(0, 10);

  const dueRows = (await db.execute(sql`
    SELECT id, tenant_id FROM list_due_recurring_bills(${today}::date)
  `)) as unknown as Array<{ id: string; tenant_id: string }>;

  let generated = 0;
  let errors = 0;
  for (const row of dueRows) {
    try {
      const result = await withTenant(row.tenant_id, (tx) =>
        generateBillFromTemplate(tx, row.tenant_id, row.id, null),
      );
      if ("error" in result) {
        errors++;
        log.error(
          { templateId: row.id, tenantId: row.tenant_id, error: result.error },
          "recurring bill skipped",
        );
      } else {
        generated++;
        log.info(
          { templateId: row.id, tenantId: row.tenant_id, billId: result.billId },
          "recurring bill generated",
        );
      }
    } catch (err) {
      errors++;
      log.error(
        { templateId: row.id, tenantId: row.tenant_id, err },
        "recurring bill failed",
      );
    }
  }
  return { generated, errors };
}

// -----------------------------------------------------------------------------
// REST routes
// -----------------------------------------------------------------------------

export const recurringBillsRoutes: FastifyPluginAsync = async (fastify) => {
  // List
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.recurringBills.id,
          scheduleName: schema.recurringBills.scheduleName,
          supplierId: schema.recurringBills.supplierId,
          supplierName: schema.suppliers.name,
          frequency: schema.recurringBills.frequency,
          dayOfMonth: schema.recurringBills.dayOfMonth,
          startDate: schema.recurringBills.startDate,
          endDate: schema.recurringBills.endDate,
          nextRunDate: schema.recurringBills.nextRunDate,
          lastRunDate: schema.recurringBills.lastRunDate,
          isActive: schema.recurringBills.isActive,
          pausedAt: schema.recurringBills.pausedAt,
          generatedCount: schema.recurringBills.generatedCount,
          lastGeneratedBillId: schema.recurringBills.lastGeneratedBillId,
          currency: schema.recurringBills.currency,
          createdAt: schema.recurringBills.createdAt,
        })
        .from(schema.recurringBills)
        .innerJoin(
          schema.suppliers,
          eq(schema.suppliers.id, schema.recurringBills.supplierId),
        )
        .where(
          and(
            eq(schema.recurringBills.tenantId, ctx.tenantId),
            isNull(schema.recurringBills.deletedAt),
          ),
        )
        .orderBy(asc(schema.recurringBills.nextRunDate))
        .limit(200),
    );
    return reply.send({ recurringBills: rows });
  });

  // Detail (header + lines + supplier)
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [tmpl] = await tx
        .select()
        .from(schema.recurringBills)
        .where(
          and(
            eq(schema.recurringBills.tenantId, ctx.tenantId),
            eq(schema.recurringBills.id, req.params.id),
            isNull(schema.recurringBills.deletedAt),
          ),
        )
        .limit(1);
      if (!tmpl) return null;
      const lines = await tx
        .select()
        .from(schema.recurringBillLines)
        .where(eq(schema.recurringBillLines.recurringBillId, tmpl.id))
        .orderBy(asc(schema.recurringBillLines.lineNo));
      const [supplier] = await tx
        .select()
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, tmpl.supplierId))
        .limit(1);
      return { recurringBill: tmpl, lines, supplier: supplier ?? null };
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

    const tmpl = await withTenant(ctx.tenantId, async (tx) => {
      // Validate supplier belongs to tenant.
      const [supplier] = await tx
        .select({ id: schema.suppliers.id })
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, input.supplierId),
            isNull(schema.suppliers.deletedAt),
          ),
        )
        .limit(1);
      if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");

      const nextRunDate = computeFirstRunDate(input.startDate, input.dayOfMonth);

      const [row] = await tx
        .insert(schema.recurringBills)
        .values({
          tenantId: ctx.tenantId,
          supplierId: input.supplierId,
          scheduleName: input.scheduleName,
          frequency: input.frequency,
          dayOfMonth: input.dayOfMonth,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          nextRunDate,
          dueDays: input.dueDays,
          currency: input.currency,
          supplierBillNumberTemplate:
            input.supplierBillNumberTemplate && input.supplierBillNumberTemplate.trim()
              ? input.supplierBillNumberTemplate.trim()
              : null,
          notes: input.notes && input.notes.trim() ? input.notes.trim() : null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!row) throw new Error("INSERT_FAILED");

      await tx.insert(schema.recurringBillLines).values(
        input.lines.map((l, idx) => ({
          tenantId: ctx.tenantId,
          recurringBillId: row.id,
          lineNo: idx + 1,
          itemId: l.itemId ?? null,
          description: l.description,
          quantity: l.quantity.toString(),
          unitPriceCents: l.unitPriceCents,
          discountPctBps: l.discountPctBps,
          taxCodeId: l.taxCodeId ?? null,
          expenseAccountId: l.expenseAccountId ?? null,
        })),
      );
      return row;
    }).catch((err: Error) => {
      if (err.message === "SUPPLIER_NOT_FOUND") {
        reply.status(400).send({ error: { code: "SUPPLIER_NOT_FOUND" } });
        return null;
      }
      throw err;
    });

    if (!tmpl) return;
    return reply.status(201).send({ recurringBill: tmpl });
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

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.recurringBills)
        .where(
          and(
            eq(schema.recurringBills.tenantId, ctx.tenantId),
            eq(schema.recurringBills.id, req.params.id),
            isNull(schema.recurringBills.deletedAt),
          ),
        )
        .limit(1);
      if (!existing) return { error: "NOT_FOUND" as const };

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.scheduleName !== undefined) updates.scheduleName = input.scheduleName;
      if (input.dayOfMonth !== undefined) updates.dayOfMonth = input.dayOfMonth;
      if (input.startDate !== undefined) updates.startDate = input.startDate;
      if (input.endDate !== undefined) updates.endDate = input.endDate || null;
      if (input.dueDays !== undefined) updates.dueDays = input.dueDays;
      if (input.currency !== undefined) updates.currency = input.currency;
      if (input.supplierBillNumberTemplate !== undefined) {
        updates.supplierBillNumberTemplate =
          input.supplierBillNumberTemplate && input.supplierBillNumberTemplate.trim()
            ? input.supplierBillNumberTemplate.trim()
            : null;
      }
      if (input.notes !== undefined)
        updates.notes = input.notes && input.notes.trim() ? input.notes.trim() : null;
      if (input.isActive !== undefined) updates.isActive = input.isActive;

      await tx
        .update(schema.recurringBills)
        .set(updates)
        .where(eq(schema.recurringBills.id, existing.id));

      if (input.lines) {
        await tx
          .delete(schema.recurringBillLines)
          .where(eq(schema.recurringBillLines.recurringBillId, existing.id));
        await tx.insert(schema.recurringBillLines).values(
          input.lines.map((l, idx) => ({
            tenantId: ctx.tenantId,
            recurringBillId: existing.id,
            lineNo: idx + 1,
            itemId: l.itemId ?? null,
            description: l.description,
            quantity: l.quantity.toString(),
            unitPriceCents: l.unitPriceCents,
            discountPctBps: l.discountPctBps,
            taxCodeId: l.taxCodeId ?? null,
            expenseAccountId: l.expenseAccountId ?? null,
          })),
        );
      }
      return { ok: true };
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
        .update(schema.recurringBills)
        .set({ isActive: false, pausedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.recurringBills.tenantId, ctx.tenantId),
            eq(schema.recurringBills.id, req.params.id),
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
        .update(schema.recurringBills)
        .set({ isActive: true, pausedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.recurringBills.tenantId, ctx.tenantId),
            eq(schema.recurringBills.id, req.params.id),
          ),
        );
    });
    return reply.send({ ok: true });
  });

  // Generate now — manual trigger ahead of the scheduled cycle. Useful for
  // testing and for AP who wants the draft pre-populated the moment they
  // know the supplier invoice is coming.
  fastify.post<{ Params: { id: string } }>("/:id/generate-now", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, (tx) =>
      generateBillFromTemplate(tx, ctx.tenantId, req.params.id, ctx.userId),
    );
    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Recurring bill not found.",
        NOT_ACTIVE: "Can't generate from a paused template. Resume it first.",
        NO_LINES: "Template has no line items.",
        SUPPLIER_NOT_FOUND: "Linked supplier has been removed.",
        INSERT_FAILED: "Couldn't create the bill.",
      };
      const code = result.error;
      return reply
        .status(code === "NOT_FOUND" ? 404 : 400)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true, billId: result.billId });
  });

  // Soft delete
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    await withTenant(ctx.tenantId, async (tx) => {
      await tx
        .update(schema.recurringBills)
        .set({ deletedAt: new Date(), isActive: false })
        .where(
          and(
            eq(schema.recurringBills.tenantId, ctx.tenantId),
            eq(schema.recurringBills.id, req.params.id),
          ),
        );
    });
    return reply.send({ ok: true });
  });
};
