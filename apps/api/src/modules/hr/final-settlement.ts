import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { withTenant, schema, nextDocumentNumber } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { recordAuditEvent } from "../../lib/audit.js";
import { postJournal } from "../accounting/journal-posting.js";
import { loadTenantSettings } from "../settings/routes.js";
import {
  computePayrollFromComponents,
  type ResolvedComponent,
} from "./sl-tax.js";
// FinalSettlementLine lives in the schema namespace (re-exported via the
// `schema.*` drizzle bundle). It's just a shape for the snapshot JSON.
type FinalSettlementLine = {
  code: string;
  name: string;
  kind: "earning" | "deduction" | "statutory";
  amountCents: number;
  meta?: Record<string, unknown>;
};

type Tx = PostgresJsDatabase<typeof schema>;

// ──────────────────────────────────────────────────────────────────────────────
// Compute: turn an exiting employee into a gross-to-net worksheet.
//
// Structure (spec §9):
//   Earnings:
//     · Pro-rata salary for days worked in settlement month
//     · Unused paid-leave encashment (basic × days ÷ 30)
//     · Gratuity (≥5 years; 14 days basic × completed years)
//     · Notice pay-in-lieu (if terminated without serving notice)
//     · Other earnings (freeform, default 0)
//   Deductions:
//     · Loan recovery in full (outstanding principal + accrued interest)
//     · Notice shortfall (if resigning mid-notice)
//     · Other deductions (freeform)
//   Statutory on eligible portion:
//     · EPF employee (8%) — on pro-rata salary + notice pay + leave encash
//     · PAYE — on taxable portion (gratuity excluded per v1 simplification)
//     · EPF employer (12%) + ETF employer (3%) — same basis
//
// All component-counts-for-statutory flags are explicit here so the
// settlement's tax treatment matches payroll's. Gratuity deliberately
// doesn't count for EPF/ETF/PAYE — it's a terminal benefit, not ongoing
// wages. HR can override via the `overrides` block if a tenant's tax
// position differs.
// ──────────────────────────────────────────────────────────────────────────────

interface ComputeOverrides {
  leaveEncashmentDays?: number;
  gratuityCents?: number;
  noticePayInLieuCents?: number;
  noticeShortfallCents?: number;
  otherEarningsCents?: number;
  otherDeductionsCents?: number;
}

export interface FinalSettlementCompute {
  employeeId: string;
  employeeFullName: string;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  hireDate: string;
  exitDate: string;
  lastWorkingDay: string;
  statusAfter: string;
  basicSalaryCents: number;
  currency: string;

  yearsOfService: number;
  gratuityYearsCompleted: number;

  proRataSalaryCents: number;
  proRataDaysWorked: number;
  proRataDaysInPeriod: number;

  leaveEncashmentDays: number;
  leaveEncashmentCents: number;
  gratuityCents: number;
  noticePayInLieuCents: number;
  noticeShortfallCents: number;
  loanPrincipalRecoveryCents: number;
  loanInterestRecoveryCents: number;
  otherEarningsCents: number;
  otherDeductionsCents: number;

  epfEmployeeCents: number;
  epfEmployerCents: number;
  etfEmployerCents: number;
  payeCents: number;

  grossCents: number;
  totalDeductionsCents: number;
  netPayableCents: number;

  lines: FinalSettlementLine[];
}

function daysBetween(a: string, b: string): number {
  // inclusive on both ends
  const ms =
    Date.UTC(
      Number(b.slice(0, 4)),
      Number(b.slice(5, 7)) - 1,
      Number(b.slice(8, 10)),
    ) -
    Date.UTC(
      Number(a.slice(0, 4)),
      Number(a.slice(5, 7)) - 1,
      Number(a.slice(8, 10)),
    );
  return Math.round(ms / 86_400_000) + 1;
}

function monthBoundsFor(dateISO: string): { start: string; end: string } {
  const y = Number(dateISO.slice(0, 4));
  const m = Number(dateISO.slice(5, 7));
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last of this
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

export async function computeFinalSettlement(
  tx: Tx,
  tenantId: string,
  employeeId: string,
  overrides: ComputeOverrides = {},
): Promise<FinalSettlementCompute> {
  // 1. Load employee ----------------------------------------------------------
  const [emp] = await tx
    .select()
    .from(schema.employees)
    .where(
      and(
        eq(schema.employees.tenantId, tenantId),
        eq(schema.employees.id, employeeId),
        isNull(schema.employees.deletedAt),
      ),
    )
    .limit(1);
  if (!emp) throw new Error("EMPLOYEE_NOT_FOUND");
  if (!emp.exitDate || !emp.lastWorkingDay) {
    throw new Error("NOT_EXITED");
  }
  if (emp.basicSalaryCents <= 0) {
    throw new Error("NO_BASIC_SALARY");
  }

  const exitDate = emp.exitDate;
  const lwd = emp.lastWorkingDay;
  const basic = emp.basicSalaryCents;
  const settings = await loadTenantSettings(tx);
  const salaryDays = settings.salaryDaysPerMonth; // typically 30

  // 2. Pro-rata salary for LWD's month ---------------------------------------
  //
  // Mirrors the worked-days scaling in payroll-runs.ts §14.2. If the next
  // payroll run already picked this month up, this settlement row could
  // double-book; operator guidance is to run settlement AFTER the final
  // payroll run (spec §9). The worksheet is editable so HR can zero this
  // row if payroll already paid it.
  const { start: monthStart, end: monthEnd } = monthBoundsFor(lwd);
  const workedStart = emp.hireDate > monthStart ? emp.hireDate : monthStart;
  const workedEnd = lwd < monthEnd ? lwd : monthEnd;
  const daysWorked =
    workedEnd >= workedStart ? daysBetween(workedStart, workedEnd) : 0;
  const daysInPeriod = daysBetween(monthStart, monthEnd);
  const proRataSalaryCents = Math.round((basic * daysWorked) / daysInPeriod);

  // 3. Tenure ----------------------------------------------------------------
  const tenureDays = daysBetween(emp.hireDate, lwd);
  const yearsOfService = Math.max(0, (tenureDays - 1) / 365.25);
  const gratuityYearsCompleted = Math.max(0, Math.floor(yearsOfService));

  // 4. Leave encashment ------------------------------------------------------
  //
  // Sum available paid-leave balances across all types for the exit year.
  // availableDays = allocated + carried - used. Encashment value =
  // availableDays × basic ÷ salaryDaysPerMonth.
  const exitYear = Number(exitDate.slice(0, 4));
  let autoLeaveDays = 0;
  if (overrides.leaveEncashmentDays === undefined) {
    const balanceRows = (await tx.execute(sql`
      SELECT
        lt.is_paid,
        COALESCE(la.allocated_days, 0)       AS allocated_days,
        COALESCE(la.carried_forward_days, 0) AS carried_forward_days,
        COALESCE(la.used_days, 0)            AS used_days
      FROM leave_types lt
      LEFT JOIN leave_allocations la
        ON la.leave_type_id = lt.id
       AND la.tenant_id     = lt.tenant_id
       AND la.employee_id   = ${employeeId}::uuid
       AND la.period_year   = ${exitYear}::smallint
      WHERE lt.tenant_id = ${tenantId}::uuid
        AND lt.deleted_at IS NULL
        AND lt.is_active = true
        AND lt.is_paid   = true
    `)) as unknown as Array<{
      is_paid: boolean;
      allocated_days: string | number;
      carried_forward_days: string | number;
      used_days: string | number;
    }>;
    for (const r of balanceRows) {
      const avail =
        Number(r.allocated_days) +
        Number(r.carried_forward_days) -
        Number(r.used_days);
      if (avail > 0) autoLeaveDays += avail;
    }
  }
  const leaveEncashmentDays =
    overrides.leaveEncashmentDays ?? Number(autoLeaveDays.toFixed(2));
  const leaveEncashmentCents = Math.round(
    (basic * leaveEncashmentDays) / salaryDays,
  );

  // 5. Gratuity --------------------------------------------------------------
  //
  // SL Payment of Gratuity Act: 14 days' basic salary per completed year,
  // min 5 years service. monthly basic ÷ 30 × 14 × years.
  const autoGratuityCents =
    gratuityYearsCompleted >= 5
      ? Math.round((basic / 30) * 14 * gratuityYearsCompleted)
      : 0;
  const gratuityCents = overrides.gratuityCents ?? autoGratuityCents;

  // 6. Notice settlement -----------------------------------------------------
  //
  // noticePeriodDays from the employee row (default 30). If statusAfter is
  // 'terminated', employer owes pay-in-lieu of unused notice. If 'resigned'
  // with LWD < (exit_date + noticePeriodDays), there's a shortfall the
  // employee owes. We compute both and let HR zero the irrelevant one.
  //
  // Simplification: we use (exit_date - last_working_day) as the served
  // notice. Positive shortfall = noticePeriodDays - served.
  const servedNoticeDays = Math.max(0, daysBetween(lwd, exitDate) - 1);
  const noticeShortDays = Math.max(
    0,
    emp.noticePeriodDays - servedNoticeDays,
  );
  const noticeDailyCents = Math.round(basic / salaryDays);

  let autoNoticeInLieu = 0;
  let autoNoticeShort = 0;
  if (emp.status === "terminated" && noticeShortDays > 0) {
    autoNoticeInLieu = noticeDailyCents * noticeShortDays;
  } else if (emp.status === "resigned" && noticeShortDays > 0) {
    autoNoticeShort = noticeDailyCents * noticeShortDays;
  }
  const noticePayInLieuCents =
    overrides.noticePayInLieuCents ?? autoNoticeInLieu;
  const noticeShortfallCents =
    overrides.noticeShortfallCents ?? autoNoticeShort;

  // 7. Outstanding staff-loan recovery --------------------------------------
  //
  // Full outstanding principal + accrued interest on every *disbursed* loan.
  // At post time we'll claim every pending schedule row (mark as paid and
  // stamp a fake applied_in_run_id? no — we carry payment_journal_id in
  // the loan header). Actually simpler: we just CR the receivable for the
  // outstanding at post time, and mark the schedule rows 'waived' with
  // reason "final settlement" so they don't roll into the next payroll
  // run. Pay step clears the payable.
  const loanRows = (await tx.execute(sql`
    SELECT id,
           principal_outstanding_cents,
           interest_outstanding_cents
      FROM employee_loans
     WHERE tenant_id = ${tenantId}::uuid
       AND employee_id = ${employeeId}::uuid
       AND status = 'disbursed'
       AND deleted_at IS NULL
  `)) as unknown as Array<{
    id: string;
    principal_outstanding_cents: string | number;
    interest_outstanding_cents: string | number;
  }>;
  const loanPrincipalRecoveryCents = loanRows.reduce(
    (s, r) => s + Number(r.principal_outstanding_cents),
    0,
  );
  const loanInterestRecoveryCents = loanRows.reduce(
    (s, r) => s + Number(r.interest_outstanding_cents),
    0,
  );

  // 8. Other adjustments -----------------------------------------------------
  const otherEarningsCents = overrides.otherEarningsCents ?? 0;
  const otherDeductionsCents = overrides.otherDeductionsCents ?? 0;

  // 9. Statutory recompute via the component engine -------------------------
  //
  // Build a component list that mirrors the flat columns. Gratuity excluded
  // from every basis (terminal benefit). Loan recovery is pure post-tax.
  // Notice shortfall reduces take-home only (same treatment as loan
  // recovery — employee would have been paid net of notice if they'd
  // served it).
  const components: ResolvedComponent[] = [];
  if (proRataSalaryCents > 0) {
    components.push({
      code: "PRO-RATA",
      name: "Pro-rata salary",
      kind: "earning",
      amountCents: proRataSalaryCents,
      countsForEpf: true,
      countsForEtf: true,
      countsForPaye: true,
      sortOrder: 10,
    });
  }
  if (leaveEncashmentCents > 0) {
    components.push({
      code: "LEAVE-ENC",
      name: `Leave encashment (${leaveEncashmentDays.toFixed(2)}d)`,
      kind: "earning",
      amountCents: leaveEncashmentCents,
      // Encashment = deferred wages, so counts for EPF/ETF/PAYE.
      countsForEpf: true,
      countsForEtf: true,
      countsForPaye: true,
      sortOrder: 20,
    });
  }
  if (noticePayInLieuCents > 0) {
    components.push({
      code: "NOTICE-LIEU",
      name: "Notice pay in lieu",
      kind: "earning",
      amountCents: noticePayInLieuCents,
      // Pay-in-lieu of notice is remuneration for the notice period.
      countsForEpf: true,
      countsForEtf: true,
      countsForPaye: true,
      sortOrder: 30,
    });
  }
  if (gratuityCents > 0) {
    components.push({
      code: "GRATUITY",
      name: `Gratuity (${gratuityYearsCompleted}y × 14d)`,
      kind: "earning",
      amountCents: gratuityCents,
      // Terminal benefit; excluded from every basis per v1 rule above.
      countsForEpf: false,
      countsForEtf: false,
      countsForPaye: false,
      sortOrder: 40,
    });
  }
  if (otherEarningsCents > 0) {
    components.push({
      code: "OTHER-EARN",
      name: "Other earnings",
      kind: "earning",
      amountCents: otherEarningsCents,
      countsForEpf: true,
      countsForEtf: true,
      countsForPaye: true,
      sortOrder: 50,
    });
  }
  // Deductions ----
  if (noticeShortfallCents > 0) {
    components.push({
      code: "NOTICE-SHORT",
      name: "Notice shortfall",
      kind: "deduction",
      amountCents: noticeShortfallCents,
      countsForEpf: false,
      countsForEtf: false,
      countsForPaye: false,
      sortOrder: 80,
    });
  }
  const loanRecoveryTotal =
    loanPrincipalRecoveryCents + loanInterestRecoveryCents;
  if (loanRecoveryTotal > 0) {
    components.push({
      code: "LOAN-REC",
      name: "Outstanding loan recovery",
      kind: "deduction",
      amountCents: loanRecoveryTotal,
      countsForEpf: false,
      countsForEtf: false,
      countsForPaye: false,
      sortOrder: 90,
    });
  }
  if (otherDeductionsCents > 0) {
    components.push({
      code: "OTHER-DED",
      name: "Other deductions",
      kind: "deduction",
      amountCents: otherDeductionsCents,
      countsForEpf: false,
      countsForEtf: false,
      countsForPaye: false,
      sortOrder: 95,
    });
  }

  const c = computePayrollFromComponents({
    components,
    epfEligible: emp.epfEligible,
    etfEligible: emp.etfEligible,
    payeApplicable: emp.payeApplicable,
  });

  // 10. Shape the line snapshot for the worksheet UI ------------------------
  const lines: FinalSettlementLine[] = components.map((cp) => ({
    code: cp.code,
    name: cp.name,
    kind: cp.kind === "earning" ? "earning" : "deduction",
    amountCents: cp.amountCents,
  }));
  // Statutory lines appear separately so the UI can show them grouped.
  if (c.epfEmployeeCents > 0) {
    lines.push({
      code: "EPF-EMP",
      name: "EPF employee (8%)",
      kind: "statutory",
      amountCents: c.epfEmployeeCents,
    });
  }
  if (c.payeCents > 0) {
    lines.push({
      code: "PAYE",
      name: "PAYE",
      kind: "statutory",
      amountCents: c.payeCents,
    });
  }

  const grossCents = c.earningsCents;
  // Net = earnings − all deductions − EPF employee − PAYE. computePayrollFrom
  // Components already handled this; we trust `netPayCents`.
  const totalDeductionsCents = c.totalDeductionsCents;
  const netPayableCents = c.netPayCents;

  return {
    employeeId: emp.id,
    employeeFullName: emp.fullName ?? `${emp.firstName} ${emp.lastName}`,
    employeeCode: emp.employeeCode,
    designation: emp.designation,
    department: emp.department,
    hireDate: emp.hireDate,
    exitDate,
    lastWorkingDay: lwd,
    statusAfter: emp.status,
    basicSalaryCents: basic,
    currency: emp.currency,
    yearsOfService: Number(yearsOfService.toFixed(2)),
    gratuityYearsCompleted,
    proRataSalaryCents,
    proRataDaysWorked: daysWorked,
    proRataDaysInPeriod: daysInPeriod,
    leaveEncashmentDays,
    leaveEncashmentCents,
    gratuityCents,
    noticePayInLieuCents,
    noticeShortfallCents,
    loanPrincipalRecoveryCents,
    loanInterestRecoveryCents,
    otherEarningsCents,
    otherDeductionsCents,
    epfEmployeeCents: c.epfEmployeeCents,
    epfEmployerCents: c.epfEmployerCents,
    etfEmployerCents: c.etfEmployerCents,
    payeCents: c.payeCents,
    grossCents,
    totalDeductionsCents,
    netPayableCents,
    lines,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

const OverridesSchema = z
  .object({
    leaveEncashmentDays: z.number().min(0).max(366).optional(),
    gratuityCents: z.number().int().min(0).optional(),
    noticePayInLieuCents: z.number().int().min(0).optional(),
    noticeShortfallCents: z.number().int().min(0).optional(),
    otherEarningsCents: z.number().int().min(0).optional(),
    otherDeductionsCents: z.number().int().min(0).optional(),
  })
  .optional();

const SaveDraftSchema = z.object({
  overrides: OverridesSchema,
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export const finalSettlementRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /employees/:id/final-settlement/compute — preview only
  fastify.post<{ Params: { id: string } }>(
    "/:id/final-settlement/compute",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const parsed = SaveDraftSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }

      try {
        const result = await withTenant(ctx.tenantId, (tx) =>
          computeFinalSettlement(tx, ctx.tenantId, req.params.id, parsed.data.overrides),
        );
        return reply.send({ compute: result });
      } catch (err) {
        return mapComputeError(err, reply);
      }
    },
  );

  // POST /employees/:id/final-settlement — create draft from compute
  fastify.post<{ Params: { id: string } }>(
    "/:id/final-settlement",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const parsed = SaveDraftSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }

      try {
        const settlement = await withTenant(ctx.tenantId, async (tx) => {
          // Guard: one active settlement per employee (matches partial
          // unique index). Friendlier error than letting PG throw.
          const existing = await tx
            .select({ id: schema.finalSettlements.id, status: schema.finalSettlements.status })
            .from(schema.finalSettlements)
            .where(
              and(
                eq(schema.finalSettlements.tenantId, ctx.tenantId),
                eq(schema.finalSettlements.employeeId, req.params.id),
                sql`status <> 'cancelled'`,
              ),
            )
            .limit(1);
          if (existing[0]) {
            throw Object.assign(new Error("ACTIVE_EXISTS"), {
              code: "ACTIVE_EXISTS",
              existingId: existing[0].id,
            });
          }

          const c = await computeFinalSettlement(
            tx,
            ctx.tenantId,
            req.params.id,
            parsed.data.overrides,
          );
          const [row] = await tx
            .insert(schema.finalSettlements)
            .values({
              tenantId: ctx.tenantId,
              employeeId: c.employeeId,
              employeeCode: c.employeeCode,
              employeeFullName: c.employeeFullName,
              designation: c.designation,
              department: c.department,
              hireDate: c.hireDate,
              exitDate: c.exitDate,
              lastWorkingDay: c.lastWorkingDay,
              statusAfter: c.statusAfter,
              basicSalaryCents: c.basicSalaryCents,
              currency: c.currency,
              yearsOfService: c.yearsOfService.toFixed(2),
              gratuityYearsCompleted: c.gratuityYearsCompleted,
              proRataSalaryCents: c.proRataSalaryCents,
              leaveEncashmentDays: c.leaveEncashmentDays.toFixed(2),
              leaveEncashmentCents: c.leaveEncashmentCents,
              gratuityCents: c.gratuityCents,
              noticePayInLieuCents: c.noticePayInLieuCents,
              noticeShortfallCents: c.noticeShortfallCents,
              loanPrincipalRecoveryCents: c.loanPrincipalRecoveryCents,
              loanInterestRecoveryCents: c.loanInterestRecoveryCents,
              otherEarningsCents: c.otherEarningsCents,
              otherDeductionsCents: c.otherDeductionsCents,
              epfEmployeeCents: c.epfEmployeeCents,
              epfEmployerCents: c.epfEmployerCents,
              etfEmployerCents: c.etfEmployerCents,
              payeCents: c.payeCents,
              grossCents: c.grossCents,
              totalDeductionsCents: c.totalDeductionsCents,
              netPayableCents: c.netPayableCents,
              linesSnapshot: c.lines,
              status: "draft",
              notes: parsed.data.notes || null,
              createdByUserId: ctx.userId,
            })
            .returning();
          if (!row) throw new Error("Insert failed");

          await recordAuditEvent(tx, {
            kind: "final_settlement.created",
            summary: `Draft settlement for ${c.employeeFullName}`,
            refType: "final_settlement",
            refId: row.id,
            diff: {
              employeeId: c.employeeId,
              grossCents: c.grossCents,
              netPayableCents: c.netPayableCents,
            },
            actorUserId: ctx.userId,
            ipAddress: req.ip ?? null,
            userAgent: req.headers["user-agent"] ?? null,
          });

          return row;
        });

        return reply.status(201).send({ settlement });
      } catch (err) {
        const anyErr = err as { code?: string; existingId?: string };
        if (anyErr?.code === "ACTIVE_EXISTS") {
          return reply.status(409).send({
            error: {
              code: "ACTIVE_EXISTS",
              message:
                "This employee already has a non-cancelled settlement. Cancel it first to redo.",
              existingId: anyErr.existingId,
            },
          });
        }
        return mapComputeError(err, reply);
      }
    },
  );

  // GET /employees/:id/final-settlements — history for the employee
  fastify.get<{ Params: { id: string } }>(
    "/:id/final-settlements",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select()
          .from(schema.finalSettlements)
          .where(
            and(
              eq(schema.finalSettlements.tenantId, ctx.tenantId),
              eq(schema.finalSettlements.employeeId, req.params.id),
            ),
          )
          .orderBy(desc(schema.finalSettlements.createdAt))
          .limit(20),
      );
      return reply.send({ settlements: rows });
    },
  );
};

// Routes on /final-settlements — keyed by settlement id
const PatchSchema = z
  .object({
    leaveEncashmentDays: z.number().min(0).max(366).optional(),
    leaveEncashmentCents: z.number().int().min(0).optional(),
    gratuityCents: z.number().int().min(0).optional(),
    noticePayInLieuCents: z.number().int().min(0).optional(),
    noticeShortfallCents: z.number().int().min(0).optional(),
    otherEarningsCents: z.number().int().min(0).optional(),
    otherDeductionsCents: z.number().int().min(0).optional(),
    notes: z.string().max(2000).optional().or(z.literal("")),
  })
  .strict();

const CancelSchema = z.object({
  reason: z.string().max(500).optional().or(z.literal("")),
});

export const finalSettlementByIdRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /final-settlements — tenant-wide list, most recent first. Powers the
  // `/app/final-settlements` index page. No status filtering here; the UI
  // handles grouping (open vs. posted/cancelled).
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx
        .select()
        .from(schema.finalSettlements)
        .where(eq(schema.finalSettlements.tenantId, ctx.tenantId))
        .orderBy(desc(schema.finalSettlements.createdAt))
        .limit(200),
    );
    return reply.send({ settlements: rows });
  });

  // GET /final-settlements/:id — detail
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const [row] = await withTenant(ctx.tenantId, (tx) =>
      tx
        .select()
        .from(schema.finalSettlements)
        .where(
          and(
            eq(schema.finalSettlements.tenantId, ctx.tenantId),
            eq(schema.finalSettlements.id, req.params.id),
          ),
        )
        .limit(1),
    );
    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ settlement: row });
  });

  // PATCH /final-settlements/:id — edit draft lines. Only draft is editable;
  // approved/posted/paid/cancelled are immutable. We recompute statutory
  // (EPF/PAYE/ETF) and totals from the edited earnings/deductions so HR
  // can't leave the math inconsistent.
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = PatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const p = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [s] = await tx
        .select()
        .from(schema.finalSettlements)
        .where(
          and(
            eq(schema.finalSettlements.tenantId, ctx.tenantId),
            eq(schema.finalSettlements.id, req.params.id),
          ),
        )
        .limit(1);
      if (!s) return { error: "NOT_FOUND" as const };
      if (s.status !== "draft") return { error: "NOT_DRAFT" as const };

      // Re-derive statutory from the new component amounts. We re-use the
      // compute engine: build components from the (possibly overridden)
      // cents columns, run computePayrollFromComponents, and persist the
      // fresh statutory/total columns.
      const [emp] = await tx
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.id, s.employeeId))
        .limit(1);
      if (!emp) return { error: "EMPLOYEE_GONE" as const };

      const next = {
        leaveEncashmentDays:
          p.leaveEncashmentDays ?? Number(s.leaveEncashmentDays),
        leaveEncashmentCents:
          p.leaveEncashmentCents ?? s.leaveEncashmentCents,
        gratuityCents: p.gratuityCents ?? s.gratuityCents,
        noticePayInLieuCents:
          p.noticePayInLieuCents ?? s.noticePayInLieuCents,
        noticeShortfallCents:
          p.noticeShortfallCents ?? s.noticeShortfallCents,
        otherEarningsCents: p.otherEarningsCents ?? s.otherEarningsCents,
        otherDeductionsCents:
          p.otherDeductionsCents ?? s.otherDeductionsCents,
      };

      const components: ResolvedComponent[] = [];
      if (s.proRataSalaryCents > 0) {
        components.push({
          code: "PRO-RATA",
          name: "Pro-rata salary",
          kind: "earning",
          amountCents: s.proRataSalaryCents,
          countsForEpf: true,
          countsForEtf: true,
          countsForPaye: true,
          sortOrder: 10,
        });
      }
      if (next.leaveEncashmentCents > 0) {
        components.push({
          code: "LEAVE-ENC",
          name: `Leave encashment (${next.leaveEncashmentDays.toFixed(2)}d)`,
          kind: "earning",
          amountCents: next.leaveEncashmentCents,
          countsForEpf: true,
          countsForEtf: true,
          countsForPaye: true,
          sortOrder: 20,
        });
      }
      if (next.noticePayInLieuCents > 0) {
        components.push({
          code: "NOTICE-LIEU",
          name: "Notice pay in lieu",
          kind: "earning",
          amountCents: next.noticePayInLieuCents,
          countsForEpf: true,
          countsForEtf: true,
          countsForPaye: true,
          sortOrder: 30,
        });
      }
      if (next.gratuityCents > 0) {
        components.push({
          code: "GRATUITY",
          name: `Gratuity (${s.gratuityYearsCompleted}y × 14d)`,
          kind: "earning",
          amountCents: next.gratuityCents,
          countsForEpf: false,
          countsForEtf: false,
          countsForPaye: false,
          sortOrder: 40,
        });
      }
      if (next.otherEarningsCents > 0) {
        components.push({
          code: "OTHER-EARN",
          name: "Other earnings",
          kind: "earning",
          amountCents: next.otherEarningsCents,
          countsForEpf: true,
          countsForEtf: true,
          countsForPaye: true,
          sortOrder: 50,
        });
      }
      if (next.noticeShortfallCents > 0) {
        components.push({
          code: "NOTICE-SHORT",
          name: "Notice shortfall",
          kind: "deduction",
          amountCents: next.noticeShortfallCents,
          countsForEpf: false,
          countsForEtf: false,
          countsForPaye: false,
          sortOrder: 80,
        });
      }
      const loanTotal =
        s.loanPrincipalRecoveryCents + s.loanInterestRecoveryCents;
      if (loanTotal > 0) {
        components.push({
          code: "LOAN-REC",
          name: "Outstanding loan recovery",
          kind: "deduction",
          amountCents: loanTotal,
          countsForEpf: false,
          countsForEtf: false,
          countsForPaye: false,
          sortOrder: 90,
        });
      }
      if (next.otherDeductionsCents > 0) {
        components.push({
          code: "OTHER-DED",
          name: "Other deductions",
          kind: "deduction",
          amountCents: next.otherDeductionsCents,
          countsForEpf: false,
          countsForEtf: false,
          countsForPaye: false,
          sortOrder: 95,
        });
      }
      const c = computePayrollFromComponents({
        components,
        epfEligible: emp.epfEligible,
        etfEligible: emp.etfEligible,
        payeApplicable: emp.payeApplicable,
      });

      const lines: FinalSettlementLine[] = components.map((cp) => ({
        code: cp.code,
        name: cp.name,
        kind: cp.kind === "earning" ? "earning" : "deduction",
        amountCents: cp.amountCents,
      }));
      if (c.epfEmployeeCents > 0) {
        lines.push({
          code: "EPF-EMP",
          name: "EPF employee (8%)",
          kind: "statutory",
          amountCents: c.epfEmployeeCents,
        });
      }
      if (c.payeCents > 0) {
        lines.push({
          code: "PAYE",
          name: "PAYE",
          kind: "statutory",
          amountCents: c.payeCents,
        });
      }

      const [updated] = await tx
        .update(schema.finalSettlements)
        .set({
          leaveEncashmentDays: next.leaveEncashmentDays.toFixed(2),
          leaveEncashmentCents: next.leaveEncashmentCents,
          gratuityCents: next.gratuityCents,
          noticePayInLieuCents: next.noticePayInLieuCents,
          noticeShortfallCents: next.noticeShortfallCents,
          otherEarningsCents: next.otherEarningsCents,
          otherDeductionsCents: next.otherDeductionsCents,
          epfEmployeeCents: c.epfEmployeeCents,
          epfEmployerCents: c.epfEmployerCents,
          etfEmployerCents: c.etfEmployerCents,
          payeCents: c.payeCents,
          grossCents: c.earningsCents,
          totalDeductionsCents: c.totalDeductionsCents,
          netPayableCents: c.netPayCents,
          linesSnapshot: lines,
          notes: p.notes !== undefined ? p.notes || null : s.notes,
          updatedAt: new Date(),
        })
        .where(eq(schema.finalSettlements.id, s.id))
        .returning();

      return { ok: true as const, settlement: updated };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_DRAFT: 409,
        EMPLOYEE_GONE: 404,
      };
      return reply
        .status((result.error && map[result.error]) ?? 500)
        .send({ error: { code: result.error } });
    }
    return reply.send(result);
  });

  // POST /final-settlements/:id/approve — draft → approved (locks editing)
  fastify.post<{ Params: { id: string } }>("/:id/approve", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [s] = await tx
        .select()
        .from(schema.finalSettlements)
        .where(
          and(
            eq(schema.finalSettlements.tenantId, ctx.tenantId),
            eq(schema.finalSettlements.id, req.params.id),
          ),
        )
        .limit(1);
      if (!s) return { error: "NOT_FOUND" as const };
      if (s.status !== "draft") return { error: "NOT_DRAFT" as const };

      const [updated] = await tx
        .update(schema.finalSettlements)
        .set({
          status: "approved",
          approvedAt: new Date(),
          approvedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.finalSettlements.id, s.id))
        .returning();

      await recordAuditEvent(tx, {
        kind: "final_settlement.approved",
        summary: `Approved settlement for ${s.employeeFullName}`,
        refType: "final_settlement",
        refId: s.id,
        diff: { netPayableCents: s.netPayableCents },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { ok: true as const, settlement: updated };
    });

    if ("error" in result) {
      const map: Record<string, number> = { NOT_FOUND: 404, NOT_DRAFT: 409 };
      return reply
        .status((result.error && map[result.error]) ?? 500)
        .send({ error: { code: result.error } });
    }
    return reply.send(result);
  });

  // POST /final-settlements/:id/post — approved → posted. Allocates FS-xxxx
  // number, builds the GL entry, and waives remaining loan schedule rows so
  // the next payroll run doesn't double-recover.
  fastify.post<{ Params: { id: string } }>("/:id/post", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "payroll.manage");
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [s] = await tx
        .select()
        .from(schema.finalSettlements)
        .where(
          and(
            eq(schema.finalSettlements.tenantId, ctx.tenantId),
            eq(schema.finalSettlements.id, req.params.id),
          ),
        )
        .limit(1);
      if (!s) return { error: "NOT_FOUND" as const };
      if (s.status !== "approved") return { error: "NOT_APPROVED" as const };

      // Resolve GL accounts --------------------------------------------------
      const coaRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        );
      const bySub = new Map(
        coaRows.map((r) => [`${r.accountType}:${r.accountSubtype}`, r]),
      );
      const salaryExpense = bySub.get("expense:payroll");
      const gratuityExpense = bySub.get("expense:payroll_gratuity");
      const epfExpense = bySub.get("expense:payroll_epf");
      const etfExpense = bySub.get("expense:payroll_etf");
      const epfPayable = bySub.get("liability:epf");
      const etfPayable = bySub.get("liability:etf");
      const payePayable = bySub.get("liability:paye");
      const salariesPayable = bySub.get("liability:salaries");
      const gratuityPayable = bySub.get("liability:gratuity_payable");
      const loansReceivable = bySub.get("asset:loans_receivable");
      const interestIncome = bySub.get("income:interest_income");

      for (const [key, acc] of [
        ["expense:payroll", salaryExpense],
        ["expense:payroll_gratuity", gratuityExpense],
        ["liability:salaries", salariesPayable],
        ["liability:gratuity_payable", gratuityPayable],
      ] as const) {
        if (!acc) return { error: "MISSING_ACCOUNT" as const, account: key };
      }
      if ((s.epfEmployeeCents > 0 || s.epfEmployerCents > 0) && (!epfExpense || !epfPayable)) {
        return { error: "MISSING_ACCOUNT" as const, account: "liability:epf" };
      }
      if (s.etfEmployerCents > 0 && (!etfExpense || !etfPayable)) {
        return { error: "MISSING_ACCOUNT" as const, account: "liability:etf" };
      }
      if (s.payeCents > 0 && !payePayable) {
        return { error: "MISSING_ACCOUNT" as const, account: "liability:paye" };
      }
      const loanTotal =
        s.loanPrincipalRecoveryCents + s.loanInterestRecoveryCents;
      if (loanTotal > 0 && (!loansReceivable || !interestIncome)) {
        return { error: "MISSING_ACCOUNT" as const, account: "asset:loans_receivable" };
      }

      const settlementNumber = await nextDocumentNumber(tx, "final_settlement");

      // Build journal lines --------------------------------------------------
      //
      //   DR Salaries & wages expense  = earnings excluding gratuity
      //   DR Gratuity expense          = gratuity
      //   DR EPF/ETF employer expense  = employer contribs
      //     CR EPF payable             = epf_employee + epf_employer
      //     CR ETF payable             = etf_employer
      //     CR PAYE payable            = paye
      //     CR Loans receivable        = loan principal (asset reduction)
      //     CR Interest income         = loan interest
      //     CR Gratuity payable        = gratuity portion of net
      //     CR Salaries payable        = remainder of net (non-gratuity)
      //
      // The net split between Gratuity payable and Salaries payable lets the
      // tenant's accountant reconcile gratuity separately — some tenants
      // pay gratuity from a different bank account or on a different date.
      const wageEarnings =
        s.proRataSalaryCents +
        s.leaveEncashmentCents +
        s.noticePayInLieuCents +
        s.otherEarningsCents;
      const lines: Parameters<typeof postJournal>[1]["lines"] = [];
      if (wageEarnings > 0) {
        lines.push({
          accountId: salaryExpense!.id,
          drCents: wageEarnings,
          description: `Settlement ${settlementNumber} · wages`,
        });
      }
      if (s.gratuityCents > 0) {
        lines.push({
          accountId: gratuityExpense!.id,
          drCents: s.gratuityCents,
          description: `Settlement ${settlementNumber} · gratuity`,
        });
      }
      if (s.epfEmployerCents > 0) {
        lines.push({
          accountId: epfExpense!.id,
          drCents: s.epfEmployerCents,
          description: `Settlement ${settlementNumber} · EPF employer`,
        });
      }
      if (s.etfEmployerCents > 0) {
        lines.push({
          accountId: etfExpense!.id,
          drCents: s.etfEmployerCents,
          description: `Settlement ${settlementNumber} · ETF employer`,
        });
      }

      const epfTotal = s.epfEmployeeCents + s.epfEmployerCents;
      if (epfTotal > 0) {
        lines.push({
          accountId: epfPayable!.id,
          crCents: epfTotal,
          description: `EPF payable · ${settlementNumber}`,
        });
      }
      if (s.etfEmployerCents > 0) {
        lines.push({
          accountId: etfPayable!.id,
          crCents: s.etfEmployerCents,
          description: `ETF payable · ${settlementNumber}`,
        });
      }
      if (s.payeCents > 0) {
        lines.push({
          accountId: payePayable!.id,
          crCents: s.payeCents,
          description: `PAYE payable · ${settlementNumber}`,
        });
      }
      if (s.loanPrincipalRecoveryCents > 0) {
        lines.push({
          accountId: loansReceivable!.id,
          crCents: s.loanPrincipalRecoveryCents,
          description: `Loan recovery · ${settlementNumber}`,
        });
      }
      if (s.loanInterestRecoveryCents > 0) {
        lines.push({
          accountId: interestIncome!.id,
          crCents: s.loanInterestRecoveryCents,
          description: `Loan interest · ${settlementNumber}`,
        });
      }

      // Net payable split: gratuity rides on Gratuity payable, the rest on
      // Salaries payable. If gratuity > netPayable (unusual — huge loan
      // recovery consuming wages), pro-rate.
      let netGratuityPortion = 0;
      let netSalaryPortion = s.netPayableCents;
      if (s.gratuityCents > 0 && s.netPayableCents > 0) {
        if (s.gratuityCents <= s.netPayableCents) {
          netGratuityPortion = s.gratuityCents;
          netSalaryPortion = s.netPayableCents - s.gratuityCents;
        } else {
          netGratuityPortion = s.netPayableCents;
          netSalaryPortion = 0;
        }
      }
      if (netGratuityPortion > 0) {
        lines.push({
          accountId: gratuityPayable!.id,
          crCents: netGratuityPortion,
          description: `Gratuity payable · ${settlementNumber}`,
        });
      }
      if (netSalaryPortion > 0) {
        lines.push({
          accountId: salariesPayable!.id,
          crCents: netSalaryPortion,
          description: `Settlement net payable · ${settlementNumber}`,
        });
      }

      const payDate = new Date().toISOString().slice(0, 10);
      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: payDate,
        memo: `Final settlement ${settlementNumber} · ${s.employeeFullName}`,
        sourceType: "final_settlement",
        sourceId: s.id,
        postedByUserId: ctx.userId,
        lines,
      });

      // Waive outstanding loan schedule rows for this employee so the
      // next payroll run doesn't also try to recover them. The loan
      // header's outstanding balances are zeroed and status moved to
      // 'closed' with reason 'final_settlement'.
      if (loanTotal > 0) {
        await tx.execute(sql`
          UPDATE employee_loan_schedule
             SET status = 'waived',
                 waived_reason = 'final_settlement',
                 applied_at = now()
           WHERE tenant_id = ${ctx.tenantId}::uuid
             AND status = 'pending'
             AND loan_id IN (
               SELECT id FROM employee_loans
                WHERE tenant_id = ${ctx.tenantId}::uuid
                  AND employee_id = ${s.employeeId}::uuid
                  AND status = 'disbursed'
             )
        `);
        await tx.execute(sql`
          UPDATE employee_loans
             SET status = 'closed',
                 closed_at = now(),
                 closed_reason = 'final_settlement',
                 principal_repaid_cents = principal_repaid_cents + principal_outstanding_cents,
                 interest_repaid_cents = interest_repaid_cents + interest_outstanding_cents,
                 principal_outstanding_cents = 0,
                 interest_outstanding_cents = 0,
                 updated_at = now()
           WHERE tenant_id = ${ctx.tenantId}::uuid
             AND employee_id = ${s.employeeId}::uuid
             AND status = 'disbursed'
        `);
      }

      const [updated] = await tx
        .update(schema.finalSettlements)
        .set({
          status: "posted",
          settlementNumber,
          journalEntryId: entryId,
          postedAt: new Date(),
          postedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.finalSettlements.id, s.id))
        .returning();

      await recordAuditEvent(tx, {
        kind: "final_settlement.posted",
        summary: `Posted settlement ${settlementNumber} · ${s.employeeFullName}`,
        refType: "final_settlement",
        refId: s.id,
        diff: {
          settlementNumber,
          journalEntryNumber: entryNumber,
          netPayableCents: s.netPayableCents,
        },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return {
        ok: true as const,
        settlement: updated,
        journalEntryNumber: entryNumber,
      };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_APPROVED: 409,
        MISSING_ACCOUNT: 500,
      };
      return reply.status((result.error && map[result.error]) ?? 500).send({
        error: {
          code: result.error,
          account: "account" in result ? result.account : undefined,
        },
      });
    }
    return reply.send(result);
  });

  // POST /final-settlements/:id/cancel — void draft or approved (never posted/paid)
  fastify.post<{ Params: { id: string } }>("/:id/cancel", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CancelSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [s] = await tx
        .select()
        .from(schema.finalSettlements)
        .where(
          and(
            eq(schema.finalSettlements.tenantId, ctx.tenantId),
            eq(schema.finalSettlements.id, req.params.id),
          ),
        )
        .limit(1);
      if (!s) return { error: "NOT_FOUND" as const };
      if (!["draft", "approved"].includes(s.status)) {
        return { error: "NOT_CANCELLABLE" as const };
      }

      const [updated] = await tx
        .update(schema.finalSettlements)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledReason: parsed.data.reason || null,
          updatedAt: new Date(),
        })
        .where(eq(schema.finalSettlements.id, s.id))
        .returning();

      await recordAuditEvent(tx, {
        kind: "final_settlement.cancelled",
        summary: `Cancelled settlement for ${s.employeeFullName}`,
        refType: "final_settlement",
        refId: s.id,
        diff: { priorStatus: s.status, reason: parsed.data.reason || null },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { ok: true as const, settlement: updated };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_CANCELLABLE: 409,
      };
      return reply
        .status((result.error && map[result.error]) ?? 500)
        .send({ error: { code: result.error } });
    }
    return reply.send(result);
  });
};

// Minimal reply interface: just what we need to map compute errors to HTTP
// responses. Importing the full FastifyReply type would bring generics that
// don't add value here.
interface ReplyLike {
  status: (code: number) => { send: (body: unknown) => unknown };
}

function mapComputeError(err: unknown, reply: ReplyLike): unknown {
  const msg = (err as Error)?.message ?? "";
  switch (msg) {
    case "EMPLOYEE_NOT_FOUND":
      return reply.status(404).send({ error: { code: "EMPLOYEE_NOT_FOUND" } });
    case "NOT_EXITED":
      return reply.status(400).send({
        error: {
          code: "NOT_EXITED",
          message:
            "Run the exit workflow (POST /employees/:id/exit) before creating a final settlement.",
        },
      });
    case "NO_BASIC_SALARY":
      return reply.status(400).send({
        error: {
          code: "NO_BASIC_SALARY",
          message: "Employee has no basic salary set; cannot compute a settlement.",
        },
      });
    default:
      throw err;
  }
}
