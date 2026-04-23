import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { postJournal } from "../accounting/journal-posting.js";
import {
  computePayrollFromComponents,
  type ResolvedComponent,
} from "./sl-tax.js";
import { loadTenantSettings } from "../settings/routes.js";
import {
  createApprovalRequest,
  resolveApplicablePolicy,
} from "../admin/approval-engine.js";

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

export type PostBonusRunError =
  | "NOT_FOUND"
  | "BAD_STATUS"
  | "EMPTY"
  | "SCHEME_NOT_FOUND"
  | "NO_SALARY_EXPENSE_ACCOUNT"
  | "NO_SALARIES_PAYABLE_ACCOUNT"
  | "NO_EPF_ACCOUNTS"
  | "NO_ETF_ACCOUNTS"
  | "NO_PAYE_ACCOUNT";

/**
 * Shared core for flipping a bonus run draft → posted (roadmap #43d).
 * Used by both the immediate /post path and by the approval-engine
 * finaliser. `allowStatuses` is the only guard against double-posting:
 * immediate passes `["draft"]`, the engine finaliser passes
 * `["pending_approval"]`.
 */
export async function postBonusRunCore(
  tx: Tx,
  input: {
    tenantId: string;
    bonusRunId: string;
    postedByUserId: string;
    allowStatuses: readonly string[];
  },
): Promise<{ ok: true; runNumber: string } | { error: PostBonusRunError }> {
  const { tenantId, bonusRunId, postedByUserId } = input;
  const runs = await tx
    .select()
    .from(schema.bonusRuns)
    .where(
      and(
        eq(schema.bonusRuns.tenantId, tenantId),
        eq(schema.bonusRuns.id, bonusRunId),
        isNull(schema.bonusRuns.deletedAt),
      ),
    )
    .limit(1);
  const run = runs[0];
  if (!run) return { error: "NOT_FOUND" };
  if (!input.allowStatuses.includes(run.status)) return { error: "BAD_STATUS" };
  if (run.employeeCount === 0 || run.grossCents === 0) return { error: "EMPTY" };

  const schemes = await tx
    .select()
    .from(schema.bonusSchemes)
    .where(
      and(
        eq(schema.bonusSchemes.tenantId, tenantId),
        eq(schema.bonusSchemes.id, run.schemeId),
      ),
    )
    .limit(1);
  const scheme = schemes[0];
  if (!scheme) return { error: "SCHEME_NOT_FOUND" };

  const coaRows = await tx
    .select()
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        isNull(schema.chartOfAccounts.deletedAt),
      ),
    );
  const bySub = new Map(coaRows.map((r) => [`${r.accountType}:${r.accountSubtype}`, r]));
  const defaultExpense = bySub.get("expense:payroll");
  const epfExpense = bySub.get("expense:payroll_epf");
  const etfExpense = bySub.get("expense:payroll_etf");
  const epfPayable = bySub.get("liability:epf");
  const etfPayable = bySub.get("liability:etf");
  const payePayable = bySub.get("liability:paye");
  const salariesPayable = bySub.get("liability:salaries");

  if (!defaultExpense) return { error: "NO_SALARY_EXPENSE_ACCOUNT" };
  if (!salariesPayable) return { error: "NO_SALARIES_PAYABLE_ACCOUNT" };
  if (run.epfEmployeeCents + run.epfEmployerCents > 0 && (!epfPayable || !epfExpense)) {
    return { error: "NO_EPF_ACCOUNTS" };
  }
  if (run.etfEmployerCents > 0 && (!etfPayable || !etfExpense)) {
    return { error: "NO_ETF_ACCOUNTS" };
  }
  if (run.payeCents > 0 && !payePayable) return { error: "NO_PAYE_ACCOUNT" };

  let expenseAccountId = defaultExpense.id;
  if (scheme.expenseAccountId) {
    const override = coaRows.find((r) => r.id === scheme.expenseAccountId);
    if (override && !override.deletedAt) expenseAccountId = override.id;
  }

  const runNumber = run.runNumber ?? run.id.slice(0, 8);
  const lines: Parameters<typeof postJournal>[1]["lines"] = [
    {
      accountId: expenseAccountId,
      drCents: run.grossCents,
      description: `Bonus ${runNumber} · ${scheme.name}`,
    },
  ];
  if (run.epfEmployerCents > 0 && epfExpense) {
    lines.push({
      accountId: epfExpense.id,
      drCents: run.epfEmployerCents,
      description: `Bonus ${runNumber} · EPF employer`,
    });
  }
  if (run.etfEmployerCents > 0 && etfExpense) {
    lines.push({
      accountId: etfExpense.id,
      drCents: run.etfEmployerCents,
      description: `Bonus ${runNumber} · ETF employer`,
    });
  }
  const epfTotal = run.epfEmployeeCents + run.epfEmployerCents;
  if (epfTotal > 0 && epfPayable) {
    lines.push({
      accountId: epfPayable.id,
      crCents: epfTotal,
      description: `EPF payable · ${runNumber}`,
    });
  }
  if (run.etfEmployerCents > 0 && etfPayable) {
    lines.push({
      accountId: etfPayable.id,
      crCents: run.etfEmployerCents,
      description: `ETF payable · ${runNumber}`,
    });
  }
  if (run.payeCents > 0 && payePayable) {
    lines.push({
      accountId: payePayable.id,
      crCents: run.payeCents,
      description: `PAYE payable · ${runNumber}`,
    });
  }
  lines.push({
    accountId: salariesPayable.id,
    crCents: run.netPayCents,
    description: `Net bonus · ${runNumber}`,
  });

  const { entryId } = await postJournal(tx, {
    tenantId,
    entryDate: run.payDate,
    memo: `Bonus ${runNumber} · ${scheme.name} · ${run.label}`,
    sourceType: "bonus_run",
    sourceId: run.id,
    postedByUserId,
    lines,
  });

  await tx
    .update(schema.bonusRuns)
    .set({
      status: "posted",
      journalEntryId: entryId,
      postedAt: new Date(),
      postedByUserId,
      approvalRequestId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bonusRuns.tenantId, tenantId),
        eq(schema.bonusRuns.id, run.id),
      ),
    );

  return { ok: true, runNumber };
}

/**
 * Bonus schemes + off-cycle bonus runs (payroll-module-spec §7).
 *
 * Schemes are the library — Avurudu, Christmas, 13th-month, performance —
 * configured with a formula, eligibility, and tax flags. A run is one
 * execution ("Avurudu 2026"): draft → posted → void. Compute seeds
 * per-employee amounts from the formula, HR can adjust before post,
 * and post books the journal.
 *
 * Journal template (post):
 *   DR Salaries & wages            total gross
 *   DR EPF employer expense        epf_employer
 *   DR ETF employer expense        etf_employer
 *     CR EPF payable               epf_employee + epf_employer
 *     CR ETF payable               etf_employer
 *     CR PAYE payable              paye
 *     CR Salaries payable          net
 *
 * v1 simplifications:
 *   · PAYE, when applied, treats the bonus as period income using the
 *     existing monthly progressive table. Over-taxes vs annualized
 *     allocation; tenants can toggle paye off per scheme if they would
 *     rather handle withholding at year-end or fold it into regular payroll.
 *   · EPF/ETF-bearing bonuses are uncommon in SL but supported via the
 *     scheme flags — the computation reuses the same sl-tax engine as
 *     regular payroll, so 8%/12%/3% land correctly when enabled.
 *   · No attendance integration; no long-service auto-triggers.
 */

// ─── Schemas ───────────────────────────────────────────────────────────

const FORMULA_TYPES = ["flat_amount", "percent_of_basic", "days_of_basic", "manual"] as const;

const SchemeCreateSchema = z
  .object({
    code: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(128),
    description: z.string().optional().or(z.literal("")),
    formulaType: z.enum(FORMULA_TYPES),
    // Units depend on formulaType:
    //   flat_amount      → cents
    //   percent_of_basic → bps (e.g. 5000 = 50%)
    //   days_of_basic    → days (e.g. 15 = half-month)
    //   manual           → must be null
    formulaValue: z.number().int().min(0).nullable().optional(),
    eligibilityMinTenureDays: z.number().int().min(0).max(365 * 50).default(0),
    eligibilityEmploymentTypes: z.array(z.string().min(1).max(16)).default(["permanent"]),
    eligibilityStatuses: z.array(z.string().min(1).max(24)).default(["active", "confirmed", "on_probation"]),
    countsForEpf: z.boolean().default(false),
    countsForEtf: z.boolean().default(false),
    countsForPaye: z.boolean().default(true),
    expenseAccountId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine(
    (d) =>
      (d.formulaType === "manual" && (d.formulaValue === null || d.formulaValue === undefined)) ||
      (d.formulaType !== "manual" && typeof d.formulaValue === "number"),
    { message: "formulaValue must be provided for non-manual formulas and null for manual" },
  );

const SchemePatchSchema = SchemeCreateSchema._def.schema.partial();

const RunCreateSchema = z.object({
  schemeId: z.string().uuid(),
  label: z.string().trim().min(1).max(128),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional().or(z.literal("")),
});

const LineAdjustSchema = z.object({
  bonusGrossCents: z.number().int().min(0),
  notes: z.string().max(500).optional().or(z.literal("")),
});

const VoidSchema = z.object({
  reason: z.string().min(1).max(500),
});

// ─── Helpers ───────────────────────────────────────────────────────────

function seedAmountCents(
  scheme: { formulaType: string; formulaValue: number | null },
  basicCents: number,
  salaryDaysPerMonth: number,
): number {
  if (scheme.formulaValue === null) return 0;
  switch (scheme.formulaType) {
    case "flat_amount":
      return scheme.formulaValue;
    case "percent_of_basic":
      return Math.round((basicCents * scheme.formulaValue) / 10_000);
    case "days_of_basic":
      return Math.round((basicCents * scheme.formulaValue) / salaryDaysPerMonth);
    case "manual":
    default:
      return 0;
  }
}

function daysBetween(start: string, end: string): number {
  const s = Date.UTC(
    Number(start.slice(0, 4)),
    Number(start.slice(5, 7)) - 1,
    Number(start.slice(8, 10)),
  );
  const e = Date.UTC(
    Number(end.slice(0, 4)),
    Number(end.slice(5, 7)) - 1,
    Number(end.slice(8, 10)),
  );
  return Math.max(0, Math.round((e - s) / 86_400_000));
}

function computeLineEconomics(input: {
  bonusGrossCents: number;
  scheme: {
    countsForEpf: boolean;
    countsForEtf: boolean;
    countsForPaye: boolean;
  };
  employee: {
    epfEligible: boolean;
    etfEligible: boolean;
    payeApplicable: boolean;
  };
}): {
  bonusGrossCents: number;
  epfEmployeeCents: number;
  epfEmployerCents: number;
  etfEmployerCents: number;
  payeCents: number;
  netPayCents: number;
  wasEpfApplied: boolean;
  wasEtfApplied: boolean;
  wasPayeApplied: boolean;
} {
  const { bonusGrossCents, scheme, employee } = input;
  const wasEpfApplied = scheme.countsForEpf && employee.epfEligible;
  const wasEtfApplied = scheme.countsForEtf && employee.etfEligible;
  const wasPayeApplied = scheme.countsForPaye && employee.payeApplicable;

  const components: ResolvedComponent[] = [
    {
      code: "BONUS",
      name: "Bonus",
      kind: "earning",
      amountCents: bonusGrossCents,
      countsForEpf: scheme.countsForEpf,
      countsForEtf: scheme.countsForEtf,
      countsForPaye: scheme.countsForPaye,
      sortOrder: 50,
    },
  ];

  const c = computePayrollFromComponents({
    components,
    epfEligible: employee.epfEligible,
    etfEligible: employee.etfEligible,
    payeApplicable: employee.payeApplicable,
  });

  return {
    bonusGrossCents,
    epfEmployeeCents: c.epfEmployeeCents,
    epfEmployerCents: c.epfEmployerCents,
    etfEmployerCents: c.etfEmployerCents,
    payeCents: c.payeCents,
    netPayCents: c.netPayCents,
    wasEpfApplied,
    wasEtfApplied,
    wasPayeApplied,
  };
}

// Refresh the run's rollup totals by summing lines. Call after create
// and after any line adjust so the detail page always matches.
async function refreshRunTotals(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  runId: string,
): Promise<void> {
  const lines = await tx
    .select()
    .from(schema.bonusRunLines)
    .where(eq(schema.bonusRunLines.runId, runId));

  const gross = lines.reduce((s, l) => s + l.bonusGrossCents, 0);
  const epfEmp = lines.reduce((s, l) => s + l.epfEmployeeCents, 0);
  const epfEr = lines.reduce((s, l) => s + l.epfEmployerCents, 0);
  const etfEr = lines.reduce((s, l) => s + l.etfEmployerCents, 0);
  const paye = lines.reduce((s, l) => s + l.payeCents, 0);
  const net = lines.reduce((s, l) => s + l.netPayCents, 0);

  await tx
    .update(schema.bonusRuns)
    .set({
      employeeCount: lines.length,
      grossCents: gross,
      epfEmployeeCents: epfEmp,
      epfEmployerCents: epfEr,
      etfEmployerCents: etfEr,
      payeCents: paye,
      netPayCents: net,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bonusRuns.tenantId, tenantId),
        eq(schema.bonusRuns.id, runId),
      ),
    );
}

// ─── Bonus schemes routes ──────────────────────────────────────────────

export const bonusSchemesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /bonus-schemes
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.bonusSchemes)
        .where(
          and(
            eq(schema.bonusSchemes.tenantId, ctx.tenantId),
            isNull(schema.bonusSchemes.deletedAt),
          ),
        )
        .orderBy(asc(schema.bonusSchemes.name)),
    );
    return reply.send({ schemes: rows });
  });

  // POST /bonus-schemes
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = SchemeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    try {
      const rows = await withTenant(ctx.tenantId, async (tx) =>
        tx
          .insert(schema.bonusSchemes)
          .values({
            tenantId: ctx.tenantId,
            code: d.code,
            name: d.name,
            description: d.description || null,
            formulaType: d.formulaType,
            formulaValue: d.formulaType === "manual" ? null : d.formulaValue ?? null,
            eligibilityMinTenureDays: d.eligibilityMinTenureDays,
            eligibilityEmploymentTypes: d.eligibilityEmploymentTypes,
            eligibilityStatuses: d.eligibilityStatuses,
            countsForEpf: d.countsForEpf,
            countsForEtf: d.countsForEtf,
            countsForPaye: d.countsForPaye,
            expenseAccountId: d.expenseAccountId ?? null,
            isActive: d.isActive,
            createdByUserId: ctx.userId,
          })
          .returning(),
      );
      return reply.send({ scheme: rows[0] });
    } catch (err) {
      // unique (tenant_id, code) collision
      if ((err as { code?: string }).code === "23505") {
        return reply.status(409).send({
          error: { code: "CODE_TAKEN", message: "A bonus scheme with this code already exists." },
        });
      }
      throw err;
    }
  });

  // PATCH /bonus-schemes/:id
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = SchemePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    const updated = await withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx
        .select()
        .from(schema.bonusSchemes)
        .where(
          and(
            eq(schema.bonusSchemes.tenantId, ctx.tenantId),
            eq(schema.bonusSchemes.id, req.params.id),
            isNull(schema.bonusSchemes.deletedAt),
          ),
        )
        .limit(1);
      if (!existing[0]) return null;

      // Enforce formula-type ↔ formula-value coherence if one side changed.
      const nextType = d.formulaType ?? existing[0].formulaType;
      const nextValue =
        d.formulaValue !== undefined ? d.formulaValue : existing[0].formulaValue;
      if (nextType === "manual" && nextValue !== null) {
        throw new Error("MANUAL_MUST_HAVE_NULL_VALUE");
      }
      if (nextType !== "manual" && (nextValue === null || nextValue === undefined)) {
        throw new Error("FORMULA_VALUE_REQUIRED");
      }

      const patchFields: Partial<typeof schema.bonusSchemes.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (d.code !== undefined) patchFields.code = d.code;
      if (d.name !== undefined) patchFields.name = d.name;
      if (d.description !== undefined) patchFields.description = d.description || null;
      if (d.formulaType !== undefined) patchFields.formulaType = d.formulaType;
      if (d.formulaValue !== undefined) patchFields.formulaValue = d.formulaValue;
      if (d.eligibilityMinTenureDays !== undefined)
        patchFields.eligibilityMinTenureDays = d.eligibilityMinTenureDays;
      if (d.eligibilityEmploymentTypes !== undefined)
        patchFields.eligibilityEmploymentTypes = d.eligibilityEmploymentTypes;
      if (d.eligibilityStatuses !== undefined)
        patchFields.eligibilityStatuses = d.eligibilityStatuses;
      if (d.countsForEpf !== undefined) patchFields.countsForEpf = d.countsForEpf;
      if (d.countsForEtf !== undefined) patchFields.countsForEtf = d.countsForEtf;
      if (d.countsForPaye !== undefined) patchFields.countsForPaye = d.countsForPaye;
      if (d.expenseAccountId !== undefined)
        patchFields.expenseAccountId = d.expenseAccountId ?? null;
      if (d.isActive !== undefined) patchFields.isActive = d.isActive;

      const rows = await tx
        .update(schema.bonusSchemes)
        .set(patchFields)
        .where(
          and(
            eq(schema.bonusSchemes.tenantId, ctx.tenantId),
            eq(schema.bonusSchemes.id, req.params.id),
          ),
        )
        .returning();
      return rows[0] ?? null;
    });

    if (!updated) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ scheme: updated });
  });
};

// ─── Bonus runs routes ─────────────────────────────────────────────────

export const bonusRunsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /bonus-runs
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const runs = await tx
        .select({
          run: schema.bonusRuns,
          schemeName: schema.bonusSchemes.name,
          schemeCode: schema.bonusSchemes.code,
        })
        .from(schema.bonusRuns)
        .leftJoin(
          schema.bonusSchemes,
          eq(schema.bonusSchemes.id, schema.bonusRuns.schemeId),
        )
        .where(
          and(
            eq(schema.bonusRuns.tenantId, ctx.tenantId),
            isNull(schema.bonusRuns.deletedAt),
          ),
        )
        .orderBy(desc(schema.bonusRuns.payDate))
        .limit(120);
      return runs.map((r) => ({ ...r.run, schemeName: r.schemeName, schemeCode: r.schemeCode }));
    });
    return reply.send({ runs: rows });
  });

  // GET /bonus-runs/:id  (with lines)
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx
        .select({
          run: schema.bonusRuns,
          schemeName: schema.bonusSchemes.name,
          schemeCode: schema.bonusSchemes.code,
        })
        .from(schema.bonusRuns)
        .leftJoin(
          schema.bonusSchemes,
          eq(schema.bonusSchemes.id, schema.bonusRuns.schemeId),
        )
        .where(
          and(
            eq(schema.bonusRuns.tenantId, ctx.tenantId),
            eq(schema.bonusRuns.id, req.params.id),
            isNull(schema.bonusRuns.deletedAt),
          ),
        )
        .limit(1);
      const r = rows[0];
      if (!r) return null;

      const lines = await tx
        .select()
        .from(schema.bonusRunLines)
        .where(eq(schema.bonusRunLines.runId, r.run.id))
        .orderBy(asc(schema.bonusRunLines.employeeFullName));

      return {
        run: { ...r.run, schemeName: r.schemeName, schemeCode: r.schemeCode },
        lines,
      };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /bonus-runs  — create draft and compute lines
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = RunCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const settings = await loadTenantSettings(tx);
      const salaryDaysPerMonth =
        typeof settings.salaryDaysPerMonth === "number" && settings.salaryDaysPerMonth > 0
          ? settings.salaryDaysPerMonth
          : 30;

      // Load scheme
      const schemes = await tx
        .select()
        .from(schema.bonusSchemes)
        .where(
          and(
            eq(schema.bonusSchemes.tenantId, ctx.tenantId),
            eq(schema.bonusSchemes.id, input.schemeId),
            isNull(schema.bonusSchemes.deletedAt),
          ),
        )
        .limit(1);
      const scheme = schemes[0];
      if (!scheme) return { error: "SCHEME_NOT_FOUND" as const };
      if (!scheme.isActive) return { error: "SCHEME_INACTIVE" as const };

      // Select eligible employees
      const emps = await tx
        .select()
        .from(schema.employees)
        .where(
          and(
            eq(schema.employees.tenantId, ctx.tenantId),
            isNull(schema.employees.deletedAt),
          ),
        );

      const eligible = emps.filter((e) => {
        if (e.basicSalaryCents <= 0 && scheme.formulaType !== "manual") return false;
        if (!scheme.eligibilityStatuses.includes(e.status)) return false;
        if (!scheme.eligibilityEmploymentTypes.includes(e.employmentType)) return false;
        if (scheme.eligibilityMinTenureDays > 0) {
          const tenure = daysBetween(e.hireDate, input.payDate);
          if (tenure < scheme.eligibilityMinTenureDays) return false;
        }
        return true;
      });

      if (eligible.length === 0) return { error: "NO_ELIGIBLE_EMPLOYEES" as const };

      // Allocate run number via shared sequence
      const numberRows = (await tx.execute(
        sql`SELECT next_document_number('bonus_run') AS number`,
      )) as unknown as Array<{ number: string }>;
      const runNumber = numberRows[0]?.number ?? null;

      const inserted = await tx
        .insert(schema.bonusRuns)
        .values({
          tenantId: ctx.tenantId,
          schemeId: scheme.id,
          runNumber,
          label: input.label,
          payDate: input.payDate,
          status: "draft",
          employeeCount: 0,
          notes: input.notes || null,
          createdByUserId: ctx.userId,
        })
        .returning();
      const run = inserted[0];
      if (!run) throw new Error("Run insert failed");

      // Compute and insert lines
      for (const e of eligible) {
        const gross = seedAmountCents(
          { formulaType: scheme.formulaType, formulaValue: scheme.formulaValue },
          e.basicSalaryCents,
          salaryDaysPerMonth,
        );
        const econ = computeLineEconomics({
          bonusGrossCents: gross,
          scheme: {
            countsForEpf: scheme.countsForEpf,
            countsForEtf: scheme.countsForEtf,
            countsForPaye: scheme.countsForPaye,
          },
          employee: {
            epfEligible: e.epfEligible,
            etfEligible: e.etfEligible,
            payeApplicable: e.payeApplicable,
          },
        });

        await tx.insert(schema.bonusRunLines).values({
          tenantId: ctx.tenantId,
          runId: run.id,
          employeeId: e.id,
          employeeFullName: e.fullName ?? `${e.firstName} ${e.lastName}`,
          employeeCode: e.employeeCode,
          nic: e.nic,
          epfNumber: e.epfNumber,
          etfNumber: e.etfNumber,
          designation: e.designation,
          department: e.department,
          basicAtRunCents: e.basicSalaryCents,
          bonusGrossCents: econ.bonusGrossCents,
          epfEmployeeCents: econ.epfEmployeeCents,
          epfEmployerCents: econ.epfEmployerCents,
          etfEmployerCents: econ.etfEmployerCents,
          payeCents: econ.payeCents,
          netPayCents: econ.netPayCents,
          wasEpfApplied: econ.wasEpfApplied,
          wasEtfApplied: econ.wasEtfApplied,
          wasPayeApplied: econ.wasPayeApplied,
          bankName: e.bankName,
          bankAccountNo: e.bankAccountNo,
          bankBranch: e.bankBranch,
        });
      }

      await refreshRunTotals(tx, ctx.tenantId, run.id);

      return { runId: run.id };
    });

    if ("error" in result) {
      const http =
        result.error === "SCHEME_NOT_FOUND"
          ? 404
          : result.error === "SCHEME_INACTIVE" || result.error === "NO_ELIGIBLE_EMPLOYEES"
            ? 409
            : 400;
      return reply.status(http).send({ error: { code: result.error } });
    }
    return reply.send({ runId: result.runId });
  });

  // PATCH /bonus-runs/:id/lines/:lineId  — adjust per-employee amount
  fastify.patch<{ Params: { id: string; lineId: string } }>(
    "/:id/lines/:lineId",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const parsed = LineAdjustSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }
      const d = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const runs = await tx
          .select()
          .from(schema.bonusRuns)
          .where(
            and(
              eq(schema.bonusRuns.tenantId, ctx.tenantId),
              eq(schema.bonusRuns.id, req.params.id),
              isNull(schema.bonusRuns.deletedAt),
            ),
          )
          .limit(1);
        const run = runs[0];
        if (!run) return { error: "NOT_FOUND" as const };
        if (run.status !== "draft") return { error: "NOT_DRAFT" as const };

        const lines = await tx
          .select()
          .from(schema.bonusRunLines)
          .where(
            and(
              eq(schema.bonusRunLines.runId, run.id),
              eq(schema.bonusRunLines.id, req.params.lineId),
            ),
          )
          .limit(1);
        const line = lines[0];
        if (!line) return { error: "LINE_NOT_FOUND" as const };

        const emps = await tx
          .select()
          .from(schema.employees)
          .where(
            and(
              eq(schema.employees.tenantId, ctx.tenantId),
              eq(schema.employees.id, line.employeeId),
            ),
          )
          .limit(1);
        const employee = emps[0];
        if (!employee) return { error: "EMPLOYEE_NOT_FOUND" as const };

        const schemes = await tx
          .select()
          .from(schema.bonusSchemes)
          .where(
            and(
              eq(schema.bonusSchemes.tenantId, ctx.tenantId),
              eq(schema.bonusSchemes.id, run.schemeId),
            ),
          )
          .limit(1);
        const scheme = schemes[0];
        if (!scheme) return { error: "SCHEME_NOT_FOUND" as const };

        const econ = computeLineEconomics({
          bonusGrossCents: d.bonusGrossCents,
          scheme: {
            countsForEpf: scheme.countsForEpf,
            countsForEtf: scheme.countsForEtf,
            countsForPaye: scheme.countsForPaye,
          },
          employee: {
            epfEligible: employee.epfEligible,
            etfEligible: employee.etfEligible,
            payeApplicable: employee.payeApplicable,
          },
        });

        await tx
          .update(schema.bonusRunLines)
          .set({
            bonusGrossCents: econ.bonusGrossCents,
            epfEmployeeCents: econ.epfEmployeeCents,
            epfEmployerCents: econ.epfEmployerCents,
            etfEmployerCents: econ.etfEmployerCents,
            payeCents: econ.payeCents,
            netPayCents: econ.netPayCents,
            wasEpfApplied: econ.wasEpfApplied,
            wasEtfApplied: econ.wasEtfApplied,
            wasPayeApplied: econ.wasPayeApplied,
            wasManuallyAdjusted: true,
            notes: d.notes || line.notes,
            updatedAt: new Date(),
          })
          .where(eq(schema.bonusRunLines.id, line.id));

        await refreshRunTotals(tx, ctx.tenantId, run.id);
        return { ok: true as const };
      });

      if ("error" in result) {
        const http =
          result.error === "NOT_FOUND" || result.error === "LINE_NOT_FOUND" ? 404 : 409;
        return reply.status(http).send({ error: { code: result.error } });
      }
      return reply.send({ ok: true });
    },
  );

  // POST /bonus-runs/:id/post — book JE, mark posted.
  //
  // Roadmap #43d — consults resolveApplicablePolicy("bonus_run", …)
  // first. A matching policy parks the run in `pending_approval` and
  // the /approvals queue drives the actual flip to `posted` via
  // finaliseApprovedDocument → postBonusRunCore. No policy → immediate
  // `draft → posted` via the same helper (legacy flow preserved).
  fastify.post<{ Params: { id: string } }>("/:id/post", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "payroll.manage");
    if (!ctx) return;

    const outcome = await withTenant(ctx.tenantId, async (tx) => {
      const runs = await tx
        .select()
        .from(schema.bonusRuns)
        .where(
          and(
            eq(schema.bonusRuns.tenantId, ctx.tenantId),
            eq(schema.bonusRuns.id, req.params.id),
            isNull(schema.bonusRuns.deletedAt),
          ),
        )
        .limit(1);
      const run = runs[0];
      if (!run) return { error: "NOT_FOUND" as const };
      if (run.approvalRequestId) return { error: "ENGINE_OWNED" as const };
      if (run.status !== "draft") return { error: "NOT_DRAFT" as const };
      if (run.employeeCount === 0 || run.grossCents === 0) {
        return { error: "EMPTY" as const };
      }

      const policy = await resolveApplicablePolicy(tx, {
        documentType: "bonus_run",
        amountCents: run.grossCents,
        submitterUserId: ctx.userId,
      });

      if (policy) {
        const request = await createApprovalRequest(tx, {
          tenantId: ctx.tenantId,
          documentType: "bonus_run",
          documentId: run.id,
          amountCents: run.grossCents,
          policyId: policy.policyId,
          steps: policy.steps,
          submitterUserId: ctx.userId,
        });
        await tx
          .update(schema.bonusRuns)
          .set({
            status: "pending_approval",
            approvalRequestId: request.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.bonusRuns.id, run.id));
        return { parked: true as const, requestId: request.id };
      }

      const posted = await postBonusRunCore(tx, {
        tenantId: ctx.tenantId,
        bonusRunId: run.id,
        postedByUserId: ctx.userId,
        allowStatuses: ["draft"],
      });
      if ("error" in posted) return { error: posted.error };
      return { parked: false as const, runNumber: posted.runNumber };
    });

    if ("error" in outcome) {
      const code = outcome.error;
      let http = 409;
      if (code === "NOT_FOUND") http = 404;
      else if (code === "ENGINE_OWNED") http = 409;
      else if (
        code === "NO_SALARY_EXPENSE_ACCOUNT" ||
        code === "NO_SALARIES_PAYABLE_ACCOUNT" ||
        code === "NO_EPF_ACCOUNTS" ||
        code === "NO_ETF_ACCOUNTS" ||
        code === "NO_PAYE_ACCOUNT"
      ) {
        http = 400;
      }
      const message =
        code === "ENGINE_OWNED"
          ? "This run is managed by the approval engine. Decide it from the Approvals queue."
          : undefined;
      return reply.status(http).send({ error: message ? { code, message } : { code } });
    }
    if (outcome.parked) {
      return reply.send({ ok: true, parked: true, approvalRequestId: outcome.requestId });
    }
    return reply.send({ ok: true, runNumber: outcome.runNumber });
  });

  fastify.post<{ Params: { id: string } }>("/:id/void", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "payroll.manage");
    if (!ctx) return;

    const parsed = VoidSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const runs = await tx
        .select()
        .from(schema.bonusRuns)
        .where(
          and(
            eq(schema.bonusRuns.tenantId, ctx.tenantId),
            eq(schema.bonusRuns.id, req.params.id),
            isNull(schema.bonusRuns.deletedAt),
          ),
        )
        .limit(1);
      const run = runs[0];
      if (!run) return { error: "NOT_FOUND" as const };
      if (run.status === "void") return { error: "ALREADY_VOID" as const };
      if (run.status !== "posted") return { error: "NOT_POSTED" as const };

      // Reverse the original journal entry: same accounts, flipped sides.
      if (run.journalEntryId) {
        const originalLines = await tx
          .select()
          .from(schema.journalLines)
          .where(eq(schema.journalLines.journalEntryId, run.journalEntryId));
        const runNumber = run.runNumber ?? run.id.slice(0, 8);
        const reversal: Parameters<typeof postJournal>[1]["lines"] = originalLines.map((l) => ({
          accountId: l.accountId,
          drCents: l.crCents,
          crCents: l.drCents,
          description: `Reversal · bonus ${runNumber}`,
        }));
        await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: new Date().toISOString().slice(0, 10),
          memo: `Void bonus ${runNumber} · ${parsed.data.reason}`,
          sourceType: "bonus_run_void",
          sourceId: run.id,
          postedByUserId: ctx.userId,
          lines: reversal,
        });
      }

      await tx
        .update(schema.bonusRuns)
        .set({
          status: "void",
          voidReason: parsed.data.reason,
          voidAt: new Date(),
          voidByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.bonusRuns.tenantId, ctx.tenantId),
            eq(schema.bonusRuns.id, run.id),
          ),
        );

      return { ok: true as const };
    });

    if ("error" in result) {
      const http = result.error === "NOT_FOUND" ? 404 : 409;
      return reply.status(http).send({ error: { code: result.error } });
    }
    return reply.send({ ok: true });
  });

  // DELETE /bonus-runs/:id  — soft delete a draft
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const runs = await tx
        .select()
        .from(schema.bonusRuns)
        .where(
          and(
            eq(schema.bonusRuns.tenantId, ctx.tenantId),
            eq(schema.bonusRuns.id, req.params.id),
            isNull(schema.bonusRuns.deletedAt),
          ),
        )
        .limit(1);
      const run = runs[0];
      if (!run) return { error: "NOT_FOUND" as const };
      if (run.status !== "draft") return { error: "NOT_DRAFT" as const };

      await tx
        .update(schema.bonusRuns)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.bonusRuns.tenantId, ctx.tenantId),
            eq(schema.bonusRuns.id, run.id),
          ),
        );
      return { ok: true as const };
    });

    if ("error" in result) {
      const http = result.error === "NOT_FOUND" ? 404 : 409;
      return reply.status(http).send({ error: { code: result.error } });
    }
    return reply.send({ ok: true });
  });
};
