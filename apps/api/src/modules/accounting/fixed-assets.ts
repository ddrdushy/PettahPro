import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
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

const CreateSchema = z.object({
  code: z.string().trim().max(32).optional().or(z.literal("")),
  name: z.string().trim().min(1).max(255),
  category: CategoryEnum.optional().default("equipment"),
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  depreciationStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  costCents: z.number().int().positive(),
  salvageCents: z.number().int().min(0).optional().default(0),
  usefulLifeMonths: z.number().int().positive().max(600),
  assetAccountId: z.string().uuid().optional(),
  accumulatedDepreciationAccountId: z.string().uuid().optional(),
  depreciationExpenseAccountId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  billId: z.string().uuid().optional(),
  notes: z.string().optional().or(z.literal("")),
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

// Months elapsed between two YYYY-MM-DD dates (floor to whole months,
// clamped at >= 0). Used to decide how many months of depreciation an
// asset owes when it's brought into service partway through a period
// and the user runs depreciation the first time later.
function monthsBetween(startISO: string, endISO: string): number {
  const [sy, sm] = startISO.split("-").map(Number);
  const [ey, em] = endISO.split("-").map(Number);
  const diff = (ey! - sy!) * 12 + (em! - sm!);
  return Math.max(0, diff);
}

export const fixedAssetsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /fixed-assets — list with current NBV
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
    }));

    return reply.send({
      assets,
      totals: {
        costCents: assets.reduce((s, a) => s + a.costCents, 0),
        accumulatedCents: assets.reduce((s, a) => s + a.accumulatedDepreciationCents, 0),
        netBookValueCents: assets.reduce((s, a) => s + a.netBookValueCents, 0),
        count: assets.length,
      },
    });
  });

  // GET /fixed-assets/:id — detail with depreciation history
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

      return { asset, history };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({
      asset: {
        ...data.asset,
        netBookValueCents: data.asset.costCents - data.asset.accumulatedDepreciationCents,
      },
      history: data.history,
    });
  });

  // POST /fixed-assets — register a new asset
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

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // If the caller didn't pin specific GL accounts, resolve sensible
      // defaults from the chart: a fixed-asset subtype for the asset side,
      // and an accumulated-depreciation contra account. If neither exists
      // we still save — the user can wire them later before running
      // depreciation.
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
          depreciationMethod: "straight_line",
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

  // POST /fixed-assets/run-depreciation — run for a given month across all active assets
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
    const runDate = monthEndISO(year, month);

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Pull every active asset; skip ones without the GL accounts wired.
      const assets = await tx
        .select()
        .from(schema.fixedAssets)
        .where(
          and(
            eq(schema.fixedAssets.tenantId, ctx.tenantId),
            eq(schema.fixedAssets.status, "active"),
            isNull(schema.fixedAssets.deletedAt),
          ),
        );

      // Existing entries for this period — we skip assets already depreciated
      // in (year,month) so re-running is idempotent.
      const existing = await tx
        .select({ assetId: schema.fixedAssetDepreciationEntries.fixedAssetId })
        .from(schema.fixedAssetDepreciationEntries)
        .where(
          and(
            eq(schema.fixedAssetDepreciationEntries.tenantId, ctx.tenantId),
            eq(schema.fixedAssetDepreciationEntries.periodYear, year),
            eq(schema.fixedAssetDepreciationEntries.periodMonth, month),
          ),
        );
      const alreadyRun = new Set(existing.map((r) => r.assetId));

      // Compute monthly depreciation per asset, build JE lines grouped by
      // (expense, accumulated) account pair so multiple assets sharing the
      // same account config condense into fewer journal rows.
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
        // Don't depreciate before the start date (e.g. asset acquired mid-year
        // and the user clicks a prior month by accident).
        if (runDate < a.depreciationStartDate) {
          skipped.push({ id: a.id, name: a.name, reason: "before_start_date" });
          continue;
        }

        const depreciable = a.costCents - a.salvageCents;
        if (depreciable <= 0) continue;
        const monthly = Math.round(depreciable / a.usefulLifeMonths);

        // Cap at remaining depreciable amount so we never cross salvage.
        const remaining = depreciable - a.accumulatedDepreciationCents;
        if (remaining <= 0) {
          skipped.push({ id: a.id, name: a.name, reason: "fully_depreciated" });
          continue;
        }
        const amount = Math.min(monthly, remaining);
        if (amount <= 0) continue;

        perAsset.push({
          assetId: a.id,
          amount,
          newAccumulated: a.accumulatedDepreciationCents + amount,
          expenseAccountId: a.depreciationExpenseAccountId,
          accumAccountId: a.accumulatedDepreciationAccountId,
        });
      }

      if (perAsset.length === 0) {
        return { processed: 0, skipped, totalDepreciationCents: 0 };
      }

      // Post one consolidated journal entry for the whole run.
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
        tenantId: ctx.tenantId,
        entryDate: runDate,
        memo: `Depreciation run ${year}-${String(month).padStart(2, "0")}`,
        sourceType: "depreciation_run",
        postedByUserId: ctx.userId,
        lines: journalLines,
      });

      // Per-asset history rows + update accumulated totals
      const totalCents = perAsset.reduce((s, p) => s + p.amount, 0);
      await tx.insert(schema.fixedAssetDepreciationEntries).values(
        perAsset.map((p) => ({
          tenantId: ctx.tenantId,
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
    });

    return reply.send({ ok: true, ...result });
  });
};
