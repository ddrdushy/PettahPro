import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, type Database } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { computeInvoice } from "./invoices.js";

const LineSchema = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unitPriceCents: z.number().int().min(0),
  discountPctBps: z.number().int().min(0).max(10000).default(0),
  taxCodeId: z.string().uuid().optional(),
});

const CreateSchema = z.object({
  customerId: z.string().uuid(),
  scheduleName: z.string().min(1).max(200),
  frequency: z.enum(["monthly"]).default("monthly"),
  dayOfMonth: z.number().int().min(1).max(28).default(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDays: z.number().int().min(0).max(365).default(30),
  currency: z.string().length(3).default("LKR"),
  reference: z.string().max(64).optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lines: z.array(LineSchema).min(1),
});

const UpdateSchema = CreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// Compute the next run date from a given anchor + frequency/dayOfMonth.
// Monthly: add one calendar month, then clamp day-of-month to the requested
// value (using the 1-28 range from the schema avoids month-end edge cases).
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

// Compute the initial next_run_date from start_date + dayOfMonth. If
// startDate.day >= dayOfMonth, the first run is next month's dayOfMonth,
// otherwise it's this month's dayOfMonth.
function computeFirstRunDate(startDate: string, dayOfMonth: number): string {
  const d = new Date(`${startDate}T00:00:00Z`);
  const startDay = d.getUTCDate();
  if (startDay > dayOfMonth) {
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  d.setUTCDate(Math.min(dayOfMonth, 28));
  return d.toISOString().slice(0, 10);
}

// Core logic: generate a draft invoice for one recurring template. Used by
// both POST /:id/generate-now (manual) and the worker cron. Runs inside an
// existing transaction; no commit/rollback here.
// Returns { invoiceId, invoiceNumber: null } — invoice is draft, not posted.
export async function generateInvoiceFromTemplate(
  tx: Database,
  tenantId: string,
  templateId: string,
  userId: string | null,
): Promise<{ invoiceId: string } | { error: string }> {
  const [tmpl] = await tx
    .select()
    .from(schema.recurringInvoices)
    .where(
      and(
        eq(schema.recurringInvoices.tenantId, tenantId),
        eq(schema.recurringInvoices.id, templateId),
        isNull(schema.recurringInvoices.deletedAt),
      ),
    )
    .limit(1);
  if (!tmpl) return { error: "NOT_FOUND" };
  if (!tmpl.isActive) return { error: "NOT_ACTIVE" };

  const tmplLines = await tx
    .select()
    .from(schema.recurringInvoiceLines)
    .where(eq(schema.recurringInvoiceLines.recurringInvoiceId, tmpl.id))
    .orderBy(asc(schema.recurringInvoiceLines.lineNo));
  if (tmplLines.length === 0) return { error: "NO_LINES" };

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
  }));

  const { lines, subtotalCents, discountCents, taxCents, totalCents } =
    await computeInvoice(tx, tenantId, lineInputs);

  const [inv] = await tx
    .insert(schema.invoices)
    .values({
      tenantId,
      customerId: tmpl.customerId,
      branchId: tmpl.branchId,
      status: "draft",
      issueDate: today,
      dueDate,
      currency: tmpl.currency,
      subtotalCents,
      discountCents,
      taxCents,
      totalCents,
      balanceDueCents: totalCents,
      reference: tmpl.reference,
      notes: tmpl.notes ? `${tmpl.notes}\n\n(Auto-generated from "${tmpl.scheduleName}")` : `Auto-generated from "${tmpl.scheduleName}"`,
      terms: tmpl.terms,
      createdByUserId: userId,
    })
    .returning();
  if (!inv) return { error: "INSERT_FAILED" };

  await tx.insert(schema.invoiceLines).values(
    lines.map((l) => ({
      tenantId,
      invoiceId: inv.id,
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
      incomeAccountId: l.incomeAccountId,
    })),
  );

  // Advance the schedule: push next_run_date forward one cycle from its
  // current value (not from today) so cycles stay aligned to the chosen
  // day-of-month. A force-generate just shifts the whole schedule forward
  // by one cycle rather than "generating twice on the same day" forever.
  const newNextRun = computeNextRunDate(tmpl.nextRunDate, "monthly", tmpl.dayOfMonth);

  await tx
    .update(schema.recurringInvoices)
    .set({
      lastRunDate: today,
      nextRunDate: newNextRun,
      generatedCount: tmpl.generatedCount + 1,
      lastGeneratedInvoiceId: inv.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.recurringInvoices.id, tmpl.id));

  return { invoiceId: inv.id };
}

// Used by the worker: find all active templates whose next_run_date <= today
// across every tenant, and generate invoices for each. Runs one call per
// template (each inside its own withTenant transaction) so one bad template
// doesn't poison siblings.
export async function runDueRecurringInvoices(db: Database, log: {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}): Promise<{ generated: number; errors: number }> {
  const today = new Date().toISOString().slice(0, 10);

  // Pull due rows via a SECURITY DEFINER SQL function (see
  // docker/postgres/init/32-recurring-invoices.sql) so we can see every
  // tenant's templates without tenant context. Each row is then processed
  // inside its own withTenant tx so RLS is honored for the actual work.
  const dueRows = (await db.execute(sql`
    SELECT id, tenant_id FROM list_due_recurring_invoices(${today}::date)
  `)) as unknown as Array<{ id: string; tenant_id: string }>;

  let generated = 0;
  let errors = 0;
  for (const row of dueRows) {
    try {
      const result = await withTenant(row.tenant_id, (tx) =>
        generateInvoiceFromTemplate(tx, row.tenant_id, row.id, null),
      );
      if ("error" in result) {
        errors++;
        log.error({ templateId: row.id, tenantId: row.tenant_id, error: result.error }, "recurring invoice skipped");
      } else {
        generated++;
        log.info({ templateId: row.id, tenantId: row.tenant_id, invoiceId: result.invoiceId }, "recurring invoice generated");
      }
    } catch (err) {
      errors++;
      log.error({ templateId: row.id, tenantId: row.tenant_id, err }, "recurring invoice failed");
    }
  }
  return { generated, errors };
}

export const recurringInvoicesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /recurring-invoices
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.recurringInvoices.id,
          scheduleName: schema.recurringInvoices.scheduleName,
          customerId: schema.recurringInvoices.customerId,
          customerName: schema.customers.name,
          frequency: schema.recurringInvoices.frequency,
          dayOfMonth: schema.recurringInvoices.dayOfMonth,
          startDate: schema.recurringInvoices.startDate,
          endDate: schema.recurringInvoices.endDate,
          nextRunDate: schema.recurringInvoices.nextRunDate,
          lastRunDate: schema.recurringInvoices.lastRunDate,
          isActive: schema.recurringInvoices.isActive,
          pausedAt: schema.recurringInvoices.pausedAt,
          generatedCount: schema.recurringInvoices.generatedCount,
          lastGeneratedInvoiceId: schema.recurringInvoices.lastGeneratedInvoiceId,
          currency: schema.recurringInvoices.currency,
          createdAt: schema.recurringInvoices.createdAt,
        })
        .from(schema.recurringInvoices)
        .innerJoin(
          schema.customers,
          eq(schema.customers.id, schema.recurringInvoices.customerId),
        )
        .where(
          and(
            eq(schema.recurringInvoices.tenantId, ctx.tenantId),
            isNull(schema.recurringInvoices.deletedAt),
          ),
        )
        .orderBy(asc(schema.recurringInvoices.nextRunDate))
        .limit(200),
    );
    return reply.send({ recurringInvoices: rows });
  });

  // GET /recurring-invoices/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [tmpl] = await tx
        .select()
        .from(schema.recurringInvoices)
        .where(
          and(
            eq(schema.recurringInvoices.tenantId, ctx.tenantId),
            eq(schema.recurringInvoices.id, req.params.id),
            isNull(schema.recurringInvoices.deletedAt),
          ),
        )
        .limit(1);
      if (!tmpl) return null;
      const lines = await tx
        .select()
        .from(schema.recurringInvoiceLines)
        .where(eq(schema.recurringInvoiceLines.recurringInvoiceId, tmpl.id))
        .orderBy(asc(schema.recurringInvoiceLines.lineNo));
      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, tmpl.customerId))
        .limit(1);
      return { recurringInvoice: tmpl, lines, customer: customer ?? null };
    });
    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /recurring-invoices
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const tmpl = await withTenant(ctx.tenantId, async (tx) => {
      const nextRunDate = computeFirstRunDate(input.startDate, input.dayOfMonth);

      const [row] = await tx
        .insert(schema.recurringInvoices)
        .values({
          tenantId: ctx.tenantId,
          customerId: input.customerId,
          scheduleName: input.scheduleName,
          frequency: input.frequency,
          dayOfMonth: input.dayOfMonth,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          nextRunDate,
          dueDays: input.dueDays,
          currency: input.currency,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          terms: input.terms ?? null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!row) throw new Error("INSERT_FAILED");

      await tx.insert(schema.recurringInvoiceLines).values(
        input.lines.map((l, idx) => ({
          tenantId: ctx.tenantId,
          recurringInvoiceId: row.id,
          lineNo: idx + 1,
          itemId: l.itemId ?? null,
          description: l.description,
          quantity: l.quantity.toString(),
          unitPriceCents: l.unitPriceCents,
          discountPctBps: l.discountPctBps,
          taxCodeId: l.taxCodeId ?? null,
        })),
      );
      return row;
    });
    return reply.status(201).send({ recurringInvoice: tmpl });
  });

  // PATCH /recurring-invoices/:id
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.recurringInvoices)
        .where(
          and(
            eq(schema.recurringInvoices.tenantId, ctx.tenantId),
            eq(schema.recurringInvoices.id, req.params.id),
            isNull(schema.recurringInvoices.deletedAt),
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
      if (input.reference !== undefined) updates.reference = input.reference || null;
      if (input.notes !== undefined) updates.notes = input.notes || null;
      if (input.terms !== undefined) updates.terms = input.terms || null;
      if (input.isActive !== undefined) updates.isActive = input.isActive;

      await tx
        .update(schema.recurringInvoices)
        .set(updates)
        .where(eq(schema.recurringInvoices.id, existing.id));

      if (input.lines) {
        await tx
          .delete(schema.recurringInvoiceLines)
          .where(eq(schema.recurringInvoiceLines.recurringInvoiceId, existing.id));
        await tx.insert(schema.recurringInvoiceLines).values(
          input.lines.map((l, idx) => ({
            tenantId: ctx.tenantId,
            recurringInvoiceId: existing.id,
            lineNo: idx + 1,
            itemId: l.itemId ?? null,
            description: l.description,
            quantity: l.quantity.toString(),
            unitPriceCents: l.unitPriceCents,
            discountPctBps: l.discountPctBps,
            taxCodeId: l.taxCodeId ?? null,
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

  // POST /recurring-invoices/:id/pause
  fastify.post<{ Params: { id: string } }>("/:id/pause", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    await withTenant(ctx.tenantId, async (tx) => {
      await tx
        .update(schema.recurringInvoices)
        .set({ isActive: false, pausedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.recurringInvoices.tenantId, ctx.tenantId),
            eq(schema.recurringInvoices.id, req.params.id),
          ),
        );
    });
    return reply.send({ ok: true });
  });

  // POST /recurring-invoices/:id/resume
  fastify.post<{ Params: { id: string } }>("/:id/resume", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    await withTenant(ctx.tenantId, async (tx) => {
      await tx
        .update(schema.recurringInvoices)
        .set({ isActive: true, pausedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.recurringInvoices.tenantId, ctx.tenantId),
            eq(schema.recurringInvoices.id, req.params.id),
          ),
        );
    });
    return reply.send({ ok: true });
  });

  // POST /recurring-invoices/:id/generate-now — manually trigger generation
  // ahead of the scheduled next_run_date. Useful for testing and for ad-hoc
  // regeneration after an edit.
  fastify.post<{ Params: { id: string } }>("/:id/generate-now", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, (tx) =>
      generateInvoiceFromTemplate(tx, ctx.tenantId, req.params.id, ctx.userId),
    );
    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Recurring invoice not found.",
        NOT_ACTIVE: "Can't generate from a paused template. Resume it first.",
        NO_LINES: "Template has no line items.",
        INSERT_FAILED: "Couldn't create the invoice.",
      };
      return reply
        .status(result.error === "NOT_FOUND" ? 404 : 400)
        .send({ error: { code: result.error, message: msgs[result.error] ?? result.error } });
    }
    return reply.send({ ok: true, invoiceId: result.invoiceId });
  });

  // DELETE /recurring-invoices/:id — soft-delete
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    await withTenant(ctx.tenantId, async (tx) => {
      await tx
        .update(schema.recurringInvoices)
        .set({ deletedAt: new Date(), isActive: false })
        .where(
          and(
            eq(schema.recurringInvoices.tenantId, ctx.tenantId),
            eq(schema.recurringInvoices.id, req.params.id),
          ),
        );
    });
    return reply.send({ ok: true });
  });
};
