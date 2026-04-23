import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, type Database } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "./journal-posting.js";

const CategoryEnum = z.enum([
  "vehicle",
  "equipment",
  "furniture",
  "building",
  "it_hardware",
  "software",
  "land",
  "other",
]);

const MethodEnum = z.enum(["straight_line", "wdv", "sum_of_years_digits"]);
type Method = z.infer<typeof MethodEnum>;

const CreateSchema = z.object({
  code: z.string().trim().max(32).optional().or(z.literal("")),
  name: z.string().trim().min(1).max(255),
  category: CategoryEnum.optional().default("equipment"),
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  depreciationStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  costCents: z.number().int().positive(),
  salvageCents: z.number().int().min(0).optional().default(0),
  usefulLifeMonths: z.number().int().positive().max(600),
  depreciationMethod: MethodEnum.optional().default("straight_line"),
  assetAccountId: z.string().uuid().optional(),
  accumulatedDepreciationAccountId: z.string().uuid().optional(),
  depreciationExpenseAccountId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  billId: z.string().uuid().optional(),
  notes: z.string().optional().or(z.literal("")),
  // Tax schedule (dual depreciation, #40). Optional — defaults to the
  // book values at insert time so the tenant only fills in tax when it
  // diverges from book.
  taxDepreciationMethod: MethodEnum.optional(),
  taxUsefulLifeMonths: z.number().int().positive().max(600).optional(),
  taxSalvageCents: z.number().int().min(0).optional(),
  taxAnnualRateBps: z.number().int().min(0).max(100000).optional(),
  taxDepreciationStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  code: z.string().trim().max(32).optional().or(z.literal("")),
  category: CategoryEnum.optional(),
  notes: z.string().optional().or(z.literal("")),
  // Tax-schedule fields — the common edit surface for #40 (book-schedule
  // edits after posting are intentionally NOT supported — restating book
  // depreciation retroactively is a prior-period adjustment, not a casual edit).
  taxDepreciationMethod: MethodEnum.optional(),
  taxUsefulLifeMonths: z.number().int().positive().max(600).optional(),
  taxSalvageCents: z.number().int().min(0).optional(),
  taxAnnualRateBps: z.number().int().min(0).max(100000).nullable().optional(),
  taxDepreciationStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const RunSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

// Last day of the given (year, month) — so the run_date and entry_date
// land on a month-end that's unambiguous across time zones.
function monthEndISO(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, "0")}-${String(last.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Compute a single month's depreciation charge for an asset under a given
 * method. Returns 0 when nothing is due (fully depreciated, before start,
 * non-depreciable category). Works for both BOOK and TAX schedules — the
 * caller passes the right (life, salvage, accumulated, rate, method) tuple.
 *
 * SLM:  (cost − salvage) / usefulLifeMonths, capped at remaining
 * WDV:  NBV × (annualRateBps / 10000 / 12), capped at remaining
 *       (If rate is null we fall back to 1/usefulLifeMonths × 12 — the
 *       declining-balance equivalent of the SLM rate, which keeps the
 *       compute well-defined even when the CA hasn't wired an IRD rate.)
 * SOYD: annualised by useful-life-in-years, monthly = yearDigit/sumDigits
 *       × depreciable / 12, where yearDigit decreases each year. Capped.
 */
function computeMonthlyDepreciation(input: {
  method: Method;
  costCents: number;
  salvageCents: number;
  usefulLifeMonths: number;
  accumulatedCents: number;
  annualRateBps: number | null;
  monthsSinceStart: number; // 0-indexed month offset from depreciation-start
}): number {
  const { method, costCents, salvageCents, usefulLifeMonths, accumulatedCents } = input;
  const depreciable = costCents - salvageCents;
  if (depreciable <= 0 || usefulLifeMonths <= 0) return 0;
  const remaining = depreciable - accumulatedCents;
  if (remaining <= 0) return 0;

  if (method === "straight_line") {
    const monthly = Math.round(depreciable / usefulLifeMonths);
    return Math.min(monthly, remaining);
  }

  if (method === "wdv") {
    // Use supplied annual rate, else derive from useful life.
    const rateBps =
      input.annualRateBps && input.annualRateBps > 0
        ? input.annualRateBps
        : Math.round((12 / usefulLifeMonths) * 10_000);
    const nbv = costCents - accumulatedCents;
    const monthly = Math.round((nbv * rateBps) / 10_000 / 12);
    return Math.min(monthly, remaining);
  }

  // SOYD
  const years = Math.max(1, Math.ceil(usefulLifeMonths / 12));
  const sum = (years * (years + 1)) / 2;
  const yearIndex = Math.min(years - 1, Math.floor(input.monthsSinceStart / 12));
  const yearDigit = years - yearIndex;
  const annual = Math.round((depreciable * yearDigit) / sum);
  const monthly = Math.round(annual / 12);
  return Math.min(monthly, remaining);
}

export const fixedAssetsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /fixed-assets — list with current NBV on both schedules.
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.fixedAssets)
        .where(
          and(
            eq(schema.fixedAssets.tenantId, ctx.tenantId),
            isNull(schema.fixedAssets.deletedAt),
          ),
        )
        .orderBy(desc(schema.fixedAssets.acquisitionDate)),
    );

    const assets = rows.map((a) => ({
      ...a,
      netBookValueCents: a.costCents - a.accumulatedDepreciationCents,
      taxNetBookValueCents: a.costCents - a.taxAccumulatedDepreciationCents,
    }));

    return reply.send({
      assets,
      totals: {
        costCents: assets.reduce((s, a) => s + a.costCents, 0),
        accumulatedCents: assets.reduce((s, a) => s + a.accumulatedDepreciationCents, 0),
        netBookValueCents: assets.reduce((s, a) => s + a.netBookValueCents, 0),
        taxAccumulatedCents: assets.reduce((s, a) => s + a.taxAccumulatedDepreciationCents, 0),
        taxNetBookValueCents: assets.reduce((s, a) => s + a.taxNetBookValueCents, 0),
        count: assets.length,
      },
    });
  });

  // GET /fixed-assets/:id — detail with both book + tax depreciation histories.
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [asset] = await tx
        .select()
        .from(schema.fixedAssets)
        .where(
          and(
            eq(schema.fixedAssets.tenantId, ctx.tenantId),
            eq(schema.fixedAssets.id, req.params.id),
            isNull(schema.fixedAssets.deletedAt),
          ),
        )
        .limit(1);
      if (!asset) return null;

      const history = await tx
        .select()
        .from(schema.fixedAssetDepreciationEntries)
        .where(
          and(
            eq(schema.fixedAssetDepreciationEntries.tenantId, ctx.tenantId),
            eq(schema.fixedAssetDepreciationEntries.fixedAssetId, asset.id),
          ),
        )
        .orderBy(desc(schema.fixedAssetDepreciationEntries.runDate));

      const taxHistory = await tx
        .select()
        .from(schema.fixedAssetTaxDepreciationEntries)
        .where(
          and(
            eq(schema.fixedAssetTaxDepreciationEntries.tenantId, ctx.tenantId),
            eq(schema.fixedAssetTaxDepreciationEntries.fixedAssetId, asset.id),
          ),
        )
        .orderBy(desc(schema.fixedAssetTaxDepreciationEntries.runDate));

      return { asset, history, taxHistory };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({
      asset: {
        ...data.asset,
        netBookValueCents: data.asset.costCents - data.asset.accumulatedDepreciationCents,
        taxNetBookValueCents: data.asset.costCents - data.asset.taxAccumulatedDepreciationCents,
      },
      history: data.history,
      taxHistory: data.taxHistory,
    });
  });

  // POST /fixed-assets — register a new asset (book + tax schedules).
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const body = parsed.data;

    const depreciationStartDate = body.depreciationStartDate ?? body.acquisitionDate;
    const taxStartDate = body.taxDepreciationStartDate ?? depreciationStartDate;
    const taxMethod = body.taxDepreciationMethod ?? body.depreciationMethod;
    const taxLife = body.taxUsefulLifeMonths ?? body.usefulLifeMonths;
    const taxSalvage = body.taxSalvageCents ?? body.salvageCents ?? 0;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      let assetAccountId = body.assetAccountId ?? null;
      let accumAccountId = body.accumulatedDepreciationAccountId ?? null;
      let expAccountId = body.depreciationExpenseAccountId ?? null;

      if (!assetAccountId || !accumAccountId || !expAccountId) {
        const coaRows = await tx
          .select()
          .from(schema.chartOfAccounts)
          .where(
            and(
              eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
              isNull(schema.chartOfAccounts.deletedAt),
            ),
          );
        if (!assetAccountId) {
          assetAccountId =
            coaRows.find((a) => a.accountSubtype === "fixed_asset" && a.accountType === "asset")?.id ??
            null;
        }
        if (!accumAccountId) {
          accumAccountId =
            coaRows.find((a) => a.accountSubtype === "accumulated_depreciation")?.id ?? null;
        }
        if (!expAccountId) {
          expAccountId =
            coaRows.find((a) => a.accountSubtype === "depreciation_expense")?.id ??
            coaRows.find((a) => a.accountType === "expense" && /deprec/i.test(a.name))?.id ??
            null;
        }
      }

      const [asset] = await tx
        .insert(schema.fixedAssets)
        .values({
          tenantId: ctx.tenantId,
          code: body.code && body.code.trim() ? body.code.trim() : null,
          name: body.name,
          category: body.category,
          assetAccountId,
          accumulatedDepreciationAccountId: accumAccountId,
          depreciationExpenseAccountId: expAccountId,
          acquisitionDate: body.acquisitionDate,
          depreciationStartDate,
          costCents: body.costCents,
          salvageCents: body.salvageCents ?? 0,
          usefulLifeMonths: body.usefulLifeMonths,
          depreciationMethod: body.depreciationMethod,
          taxDepreciationMethod: taxMethod,
          taxUsefulLifeMonths: taxLife,
          taxSalvageCents: taxSalvage,
          taxAnnualRateBps: body.taxAnnualRateBps ?? null,
          taxDepreciationStartDate: taxStartDate,
          supplierId: body.supplierId ?? null,
          billId: body.billId ?? null,
          notes: body.notes && body.notes.trim() ? body.notes.trim() : null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!asset) return { error: "INSERT_FAILED" as const };
      return { asset };
    });

    if ("error" in result) {
      return reply.status(500).send({ error: { code: result.error } });
    }
    return reply.status(201).send({ asset: result.asset });
  });

  // PATCH /fixed-assets/:id — edit tax schedule / notes / name / code.
  // Intentionally excludes book cost / life / salvage: retrospectively
  // restating book depreciation is a prior-period adjustment, not a casual edit.
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const body = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.fixedAssets)
        .where(
          and(
            eq(schema.fixedAssets.tenantId, ctx.tenantId),
            eq(schema.fixedAssets.id, req.params.id),
            isNull(schema.fixedAssets.deletedAt),
          ),
        )
        .limit(1);
      if (!existing) return { error: "NOT_FOUND" as const };

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) patch.name = body.name;
      if (body.code !== undefined) patch.code = body.code.trim() || null;
      if (body.category !== undefined) patch.category = body.category;
      if (body.notes !== undefined) patch.notes = (body.notes || "").trim() || null;
      if (body.taxDepreciationMethod !== undefined) patch.taxDepreciationMethod = body.taxDepreciationMethod;
      if (body.taxUsefulLifeMonths !== undefined) patch.taxUsefulLifeMonths = body.taxUsefulLifeMonths;
      if (body.taxSalvageCents !== undefined) {
        if (body.taxSalvageCents > existing.costCents) {
          return { error: "INVALID_INPUT" as const, message: "tax salvage cannot exceed cost" };
        }
        patch.taxSalvageCents = body.taxSalvageCents;
      }
      if (body.taxAnnualRateBps !== undefined) patch.taxAnnualRateBps = body.taxAnnualRateBps;
      if (body.taxDepreciationStartDate !== undefined) patch.taxDepreciationStartDate = body.taxDepreciationStartDate;

      const [updated] = await tx
        .update(schema.fixedAssets)
        .set(patch)
        .where(eq(schema.fixedAssets.id, existing.id))
        .returning();
      return { asset: updated };
    });

    if ("error" in result) {
      if (result.error === "NOT_FOUND") {
        return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      }
      return reply
        .status(400)
        .send({ error: { code: result.error, message: (result as { message?: string }).message } });
    }
    return reply.send({ asset: result.asset });
  });

  // POST /fixed-assets/run-depreciation — book schedule for the given month.
  // Posts a consolidated JE and writes per-asset entries (unchanged behaviour).
  fastify.post("/run-depreciation", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = RunSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { year, month } = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) =>
      runDepreciationForTenantTx(tx, {
        tenantId: ctx.tenantId,
        year,
        month,
        postedByUserId: ctx.userId,
      }),
    );

    return reply.send({ ok: true, ...result });
  });

  // POST /fixed-assets/run-tax-depreciation — tax schedule for the given
  // month. Memo-only: no JE, no GL impact. Idempotent on (asset, year, month).
  fastify.post("/run-tax-depreciation", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = RunSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { year, month } = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) =>
      runTaxDepreciationForTenantTx(tx, { tenantId: ctx.tenantId, year, month }),
    );

    return reply.send({ ok: true, ...result });
  });

  // GET /fixed-assets/schedule?year=YYYY — per-asset book-vs-tax comparison
  // for the calendar year. Shows yearly totals + closing balances side-by-side
  // so the CA can see the tax-vs-book divergence at a glance.
  fastify.get<{ Querystring: { year?: string } }>("/schedule", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const year = Number(req.query.year ?? new Date().getUTCFullYear());
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "bad year" } });
    }

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const assets = await tx
        .select()
        .from(schema.fixedAssets)
        .where(
          and(
            eq(schema.fixedAssets.tenantId, ctx.tenantId),
            isNull(schema.fixedAssets.deletedAt),
          ),
        )
        .orderBy(desc(schema.fixedAssets.acquisitionDate));

      const bookYear = await tx.execute(sql`
        SELECT fixed_asset_id, SUM(depreciation_cents)::bigint AS total
        FROM fixed_asset_depreciation_entries
        WHERE tenant_id = ${ctx.tenantId} AND period_year = ${year}
        GROUP BY fixed_asset_id
      `);
      const taxYear = await tx.execute(sql`
        SELECT fixed_asset_id, SUM(depreciation_cents)::bigint AS total
        FROM fixed_asset_tax_depreciation_entries
        WHERE tenant_id = ${ctx.tenantId} AND period_year = ${year}
        GROUP BY fixed_asset_id
      `);
      const bookMap = new Map<string, number>(
        (bookYear as unknown as Array<{ fixed_asset_id: string; total: string | number }>).map(
          (r) => [r.fixed_asset_id, Number(r.total)],
        ),
      );
      const taxMap = new Map<string, number>(
        (taxYear as unknown as Array<{ fixed_asset_id: string; total: string | number }>).map(
          (r) => [r.fixed_asset_id, Number(r.total)],
        ),
      );

      return assets.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        category: a.category,
        costCents: a.costCents,
        bookMethod: a.depreciationMethod,
        bookLifeMonths: a.usefulLifeMonths,
        bookYearCents: bookMap.get(a.id) ?? 0,
        bookAccumulatedCents: a.accumulatedDepreciationCents,
        bookNbvCents: a.costCents - a.accumulatedDepreciationCents,
        taxMethod: a.taxDepreciationMethod,
        taxLifeMonths: a.taxUsefulLifeMonths,
        taxAnnualRateBps: a.taxAnnualRateBps,
        taxYearCents: taxMap.get(a.id) ?? 0,
        taxAccumulatedCents: a.taxAccumulatedDepreciationCents,
        taxNbvCents: a.costCents - a.taxAccumulatedDepreciationCents,
      }));
    });

    return reply.send({
      year,
      rows,
      totals: {
        costCents: rows.reduce((s, r) => s + r.costCents, 0),
        bookYearCents: rows.reduce((s, r) => s + r.bookYearCents, 0),
        bookAccumulatedCents: rows.reduce((s, r) => s + r.bookAccumulatedCents, 0),
        bookNbvCents: rows.reduce((s, r) => s + r.bookNbvCents, 0),
        taxYearCents: rows.reduce((s, r) => s + r.taxYearCents, 0),
        taxAccumulatedCents: rows.reduce((s, r) => s + r.taxAccumulatedCents, 0),
        taxNbvCents: rows.reduce((s, r) => s + r.taxNbvCents, 0),
      },
    });
  });
};

// --- depreciation engine (also used by the monthly cron) -------------------

type DepreciationResult = {
  processed: number;
  skipped: Array<{ id: string; name: string; reason: string }>;
  totalDepreciationCents: number;
  entryNumber?: string;
  runDate: string;
};

// Months elapsed between two YYYY-MM-DD dates. Used for SOYD to pick the
// right year digit from the depreciation start.
function monthsBetween(startISO: string, endISO: string): number {
  const [sy, sm] = startISO.split("-").map(Number);
  const [ey, em] = endISO.split("-").map(Number);
  const diff = (ey! - sy!) * 12 + (em! - sm!);
  return Math.max(0, diff);
}

// Book schedule — posts a JE. Idempotent via the (tenant, asset, year, month)
// unique index on fixed_asset_depreciation_entries.
export async function runDepreciationForTenantTx(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  input: {
    tenantId: string;
    year: number;
    month: number;
    postedByUserId: string | null;
  },
): Promise<DepreciationResult> {
  const { tenantId, year, month } = input;
  const runDate = monthEndISO(year, month);

  const assets = await tx
    .select()
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.tenantId, tenantId),
        eq(schema.fixedAssets.status, "active"),
        isNull(schema.fixedAssets.deletedAt),
      ),
    );

  const existing = await tx
    .select({ assetId: schema.fixedAssetDepreciationEntries.fixedAssetId })
    .from(schema.fixedAssetDepreciationEntries)
    .where(
      and(
        eq(schema.fixedAssetDepreciationEntries.tenantId, tenantId),
        eq(schema.fixedAssetDepreciationEntries.periodYear, year),
        eq(schema.fixedAssetDepreciationEntries.periodMonth, month),
      ),
    );
  const alreadyRun = new Set(existing.map((r) => r.assetId));

  interface PerAsset {
    assetId: string;
    amount: number;
    newAccumulated: number;
    expenseAccountId: string;
    accumAccountId: string;
  }
  const perAsset: PerAsset[] = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];

  for (const a of assets) {
    if (alreadyRun.has(a.id)) {
      skipped.push({ id: a.id, name: a.name, reason: "already_run_for_period" });
      continue;
    }
    if (!a.depreciationExpenseAccountId || !a.accumulatedDepreciationAccountId) {
      skipped.push({ id: a.id, name: a.name, reason: "missing_gl_accounts" });
      continue;
    }
    if (runDate < a.depreciationStartDate) {
      skipped.push({ id: a.id, name: a.name, reason: "before_start_date" });
      continue;
    }

    const monthsSinceStart = monthsBetween(a.depreciationStartDate, runDate);
    const amount = computeMonthlyDepreciation({
      method: a.depreciationMethod as Method,
      costCents: a.costCents,
      salvageCents: a.salvageCents,
      usefulLifeMonths: a.usefulLifeMonths,
      accumulatedCents: a.accumulatedDepreciationCents,
      annualRateBps: null, // book never uses an IRD rate
      monthsSinceStart,
    });
    if (amount <= 0) {
      skipped.push({ id: a.id, name: a.name, reason: "fully_depreciated" });
      continue;
    }

    perAsset.push({
      assetId: a.id,
      amount,
      newAccumulated: a.accumulatedDepreciationCents + amount,
      expenseAccountId: a.depreciationExpenseAccountId,
      accumAccountId: a.accumulatedDepreciationAccountId,
    });
  }

  if (perAsset.length === 0) {
    return { processed: 0, skipped, totalDepreciationCents: 0, runDate };
  }

  const drByAccount = new Map<string, number>();
  const crByAccount = new Map<string, number>();
  for (const p of perAsset) {
    drByAccount.set(
      p.expenseAccountId,
      (drByAccount.get(p.expenseAccountId) ?? 0) + p.amount,
    );
    crByAccount.set(
      p.accumAccountId,
      (crByAccount.get(p.accumAccountId) ?? 0) + p.amount,
    );
  }

  const journalLines: Parameters<typeof postJournal>[1]["lines"] = [];
  for (const [accountId, amount] of drByAccount) {
    journalLines.push({
      accountId,
      drCents: amount,
      description: `Depreciation ${year}-${String(month).padStart(2, "0")}`,
    });
  }
  for (const [accountId, amount] of crByAccount) {
    journalLines.push({
      accountId,
      crCents: amount,
      description: `Accumulated depreciation ${year}-${String(month).padStart(2, "0")}`,
    });
  }

  const { entryId, entryNumber } = await postJournal(tx, {
    tenantId,
    entryDate: runDate,
    memo: `Depreciation run ${year}-${String(month).padStart(2, "0")}`,
    sourceType: "depreciation_run",
    postedByUserId: input.postedByUserId ?? undefined,
    lines: journalLines,
  });

  const totalCents = perAsset.reduce((s, p) => s + p.amount, 0);
  await tx.insert(schema.fixedAssetDepreciationEntries).values(
    perAsset.map((p) => ({
      tenantId,
      fixedAssetId: p.assetId,
      runDate,
      periodYear: year,
      periodMonth: month,
      depreciationCents: p.amount,
      accumulatedAfterCents: p.newAccumulated,
      journalEntryId: entryId,
    })),
  );
  for (const p of perAsset) {
    await tx
      .update(schema.fixedAssets)
      .set({
        accumulatedDepreciationCents: p.newAccumulated,
        lastDepreciationRunDate: runDate,
        updatedAt: new Date(),
      })
      .where(eq(schema.fixedAssets.id, p.assetId));
  }

  return {
    processed: perAsset.length,
    skipped,
    totalDepreciationCents: totalCents,
    entryNumber,
    runDate,
  };
}

// Tax schedule — memo-only, no JE, no GL. Idempotent via the (tenant, asset,
// year, month) unique index on fixed_asset_tax_depreciation_entries.
export async function runTaxDepreciationForTenantTx(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  input: { tenantId: string; year: number; month: number },
): Promise<{
  processed: number;
  skipped: Array<{ id: string; name: string; reason: string }>;
  totalDepreciationCents: number;
  runDate: string;
}> {
  const { tenantId, year, month } = input;
  const runDate = monthEndISO(year, month);

  const assets = await tx
    .select()
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.tenantId, tenantId),
        eq(schema.fixedAssets.status, "active"),
        isNull(schema.fixedAssets.deletedAt),
      ),
    );

  const existing = await tx
    .select({ assetId: schema.fixedAssetTaxDepreciationEntries.fixedAssetId })
    .from(schema.fixedAssetTaxDepreciationEntries)
    .where(
      and(
        eq(schema.fixedAssetTaxDepreciationEntries.tenantId, tenantId),
        eq(schema.fixedAssetTaxDepreciationEntries.periodYear, year),
        eq(schema.fixedAssetTaxDepreciationEntries.periodMonth, month),
      ),
    );
  const alreadyRun = new Set(existing.map((r) => r.assetId));

  interface PerAsset {
    assetId: string;
    amount: number;
    newAccumulated: number;
  }
  const perAsset: PerAsset[] = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];

  for (const a of assets) {
    if (alreadyRun.has(a.id)) {
      skipped.push({ id: a.id, name: a.name, reason: "already_run_for_period" });
      continue;
    }
    if (runDate < a.taxDepreciationStartDate) {
      skipped.push({ id: a.id, name: a.name, reason: "before_start_date" });
      continue;
    }

    const monthsSinceStart = monthsBetween(a.taxDepreciationStartDate, runDate);
    const amount = computeMonthlyDepreciation({
      method: a.taxDepreciationMethod as Method,
      costCents: a.costCents,
      salvageCents: a.taxSalvageCents,
      usefulLifeMonths: a.taxUsefulLifeMonths,
      accumulatedCents: a.taxAccumulatedDepreciationCents,
      annualRateBps: a.taxAnnualRateBps,
      monthsSinceStart,
    });
    if (amount <= 0) {
      skipped.push({ id: a.id, name: a.name, reason: "fully_depreciated" });
      continue;
    }

    perAsset.push({
      assetId: a.id,
      amount,
      newAccumulated: a.taxAccumulatedDepreciationCents + amount,
    });
  }

  if (perAsset.length === 0) {
    return { processed: 0, skipped, totalDepreciationCents: 0, runDate };
  }

  const totalCents = perAsset.reduce((s, p) => s + p.amount, 0);
  await tx.insert(schema.fixedAssetTaxDepreciationEntries).values(
    perAsset.map((p) => ({
      tenantId,
      fixedAssetId: p.assetId,
      runDate,
      periodYear: year,
      periodMonth: month,
      depreciationCents: p.amount,
      accumulatedAfterCents: p.newAccumulated,
    })),
  );
  for (const p of perAsset) {
    await tx
      .update(schema.fixedAssets)
      .set({
        taxAccumulatedDepreciationCents: p.newAccumulated,
        taxLastDepreciationRunDate: runDate,
        updatedAt: new Date(),
      })
      .where(eq(schema.fixedAssets.id, p.assetId));
  }

  return {
    processed: perAsset.length,
    skipped,
    totalDepreciationCents: totalCents,
    runDate,
  };
}

/**
 * Monthly depreciation dispatcher — fired from the BullMQ scheduled queue
 * once a day. Only does work when today is the 1st of the month: runs the
 * prior month's depreciation for every tenant across BOTH schedules (book +
 * tax). Fully idempotent via the unique indexes; re-firing is a no-op.
 */
export async function runMonthlyDepreciationForAllTenants(
  dbClient: Database,
  log: {
    info: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  },
): Promise<{ tenantsProcessed: number; entriesPosted: number; taxEntriesPosted: number }> {
  const today = new Date();
  if (today.getUTCDate() !== 1) {
    log.info({ date: today.toISOString() }, "depreciation cron: not 1st, skipping");
    return { tenantsProcessed: 0, entriesPosted: 0, taxEntriesPosted: 0 };
  }
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const priorYear = m === 0 ? y - 1 : y;
  const priorMonth = m === 0 ? 12 : m;

  const tenantRows = (await dbClient.execute(sql`
    SELECT id FROM tenants WHERE deleted_at IS NULL
  `)) as unknown as Array<{ id: string }>;

  let entriesPosted = 0;
  let taxEntriesPosted = 0;
  for (const t of tenantRows) {
    try {
      const result = await withTenant(t.id, async (tx) =>
        runDepreciationForTenantTx(tx, {
          tenantId: t.id,
          year: priorYear,
          month: priorMonth,
          postedByUserId: null,
        }),
      );
      entriesPosted += result.processed;

      const taxResult = await withTenant(t.id, async (tx) =>
        runTaxDepreciationForTenantTx(tx, {
          tenantId: t.id,
          year: priorYear,
          month: priorMonth,
        }),
      );
      taxEntriesPosted += taxResult.processed;

      log.info(
        {
          tenantId: t.id,
          year: priorYear,
          month: priorMonth,
          processed: result.processed,
          totalCents: result.totalDepreciationCents,
          taxProcessed: taxResult.processed,
          taxTotalCents: taxResult.totalDepreciationCents,
        },
        "depreciation cron: tenant complete",
      );
    } catch (err) {
      log.error({ tenantId: t.id, err }, "depreciation cron: tenant failed");
    }
  }

  return { tenantsProcessed: tenantRows.length, entriesPosted, taxEntriesPosted };
}
