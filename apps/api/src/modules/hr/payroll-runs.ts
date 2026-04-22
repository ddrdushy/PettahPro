import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, lte, gte, or, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, nextDocumentNumber } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { postJournal } from "../accounting/journal-posting.js";
import {
  computePayrollFromComponents,
  type ResolvedComponent,
} from "./sl-tax.js";
import { loadTenantSettings } from "../settings/routes.js";

const CreateSchema = z.object({
  periodYear: z.number().int().min(2020).max(2099),
  periodMonth: z.number().int().min(1).max(12),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional().or(z.literal("")),
});

function endOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

function startOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export const payrollRunsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /payroll-runs — list
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.payrollRuns)
        .where(
          and(
            eq(schema.payrollRuns.tenantId, ctx.tenantId),
            isNull(schema.payrollRuns.deletedAt),
          ),
        )
        .orderBy(desc(schema.payrollRuns.periodYear), desc(schema.payrollRuns.periodMonth))
        .limit(60),
    );

    return reply.send({ runs: rows });
  });

  // GET /payroll-runs/:id — detail with all lines
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const runRows = await tx
        .select()
        .from(schema.payrollRuns)
        .where(
          and(
            eq(schema.payrollRuns.tenantId, ctx.tenantId),
            eq(schema.payrollRuns.id, req.params.id),
            isNull(schema.payrollRuns.deletedAt),
          ),
        )
        .limit(1);
      const run = runRows[0];
      if (!run) return null;

      const lines = await tx
        .select()
        .from(schema.payrollRunLines)
        .where(eq(schema.payrollRunLines.runId, run.id))
        .orderBy(asc(schema.payrollRunLines.employeeFullName));

      // Fetch component breakdown for every line in one round-trip, keyed by
      // line_id so the client can group without another fetch.
      const breakdown = lines.length
        ? await tx
            .select()
            .from(schema.payrollRunLineComponents)
            .where(
              and(
                eq(schema.payrollRunLineComponents.tenantId, ctx.tenantId),
                inArray(
                  schema.payrollRunLineComponents.lineId,
                  lines.map((l) => l.id),
                ),
              ),
            )
            .orderBy(asc(schema.payrollRunLineComponents.sortOrder))
        : [];
      const byLine = new Map<string, typeof breakdown>();
      for (const c of breakdown) {
        const list = byLine.get(c.lineId) ?? [];
        list.push(c);
        byLine.set(c.lineId, list);
      }
      const linesWithComponents = lines.map((l) => ({
        ...l,
        components: byLine.get(l.id) ?? [],
      }));

      return { run, lines: linesWithComponents };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /payroll-runs — draft for a given period, snapshotting every
  // active employee's pay line
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;
    const periodStart = startOfMonth(input.periodYear, input.periodMonth);
    const periodEnd = endOfMonth(input.periodYear, input.periodMonth);
    const payDate = input.payDate ?? periodEnd;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Guard against duplicate active run for the same period
      const existing = await tx
        .select({ id: schema.payrollRuns.id })
        .from(schema.payrollRuns)
        .where(
          and(
            eq(schema.payrollRuns.tenantId, ctx.tenantId),
            eq(schema.payrollRuns.periodYear, input.periodYear),
            eq(schema.payrollRuns.periodMonth, input.periodMonth),
            isNull(schema.payrollRuns.deletedAt),
          ),
        )
        .limit(1);
      if (existing[0]) {
        return { error: "RUN_EXISTS" as const, id: existing[0].id };
      }

      // Snapshot currently active employees
      const emps = await tx
        .select()
        .from(schema.employees)
        .where(
          and(
            eq(schema.employees.tenantId, ctx.tenantId),
            isNull(schema.employees.deletedAt),
          ),
        );
      // Eligibility per payroll-module-spec §14.1 / §14.2:
      //   · currently-working statuses (active/confirmed/on_probation), OR
      //   · recently-exited employees whose exit_date falls inside the run
      //     period (they still earn for days worked before leaving).
      // Joiners whose hire_date falls AFTER periodEnd are excluded — they
      // haven't started yet.
      const eligible = emps.filter((e) => {
        if (e.basicSalaryCents <= 0) return false;
        if (e.hireDate && e.hireDate > periodEnd) return false;
        const working = ["active", "confirmed", "on_probation"].includes(e.status);
        if (working) return true;
        const exited = ["resigned", "terminated", "retired", "deceased"].includes(e.status);
        if (exited) {
          // Include if the effective last day falls inside this period
          const endForExited = e.lastWorkingDay ?? e.exitDate;
          if (endForExited && endForExited >= periodStart) return true;
        }
        return false;
      });
      if (eligible.length === 0) return { error: "NO_ELIGIBLE_EMPLOYEES" as const };

      // Calendar days in this period — denominator for mid-period pro-rata.
      const periodDays =
        Math.round(
          (Date.UTC(
            Number(periodEnd.slice(0, 4)),
            Number(periodEnd.slice(5, 7)) - 1,
            Number(periodEnd.slice(8, 10)),
          ) -
            Date.UTC(
              Number(periodStart.slice(0, 4)),
              Number(periodStart.slice(5, 7)) - 1,
              Number(periodStart.slice(8, 10)),
            )) /
            86_400_000,
        ) + 1;

      // Insert draft run
      const [run] = await tx
        .insert(schema.payrollRuns)
        .values({
          tenantId: ctx.tenantId,
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
          periodStart,
          periodEnd,
          payDate,
          status: "draft",
          employeeCount: eligible.length,
          notes: input.notes || null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!run) throw new Error("Run insert failed");

      // Load every active component assignment for this period. An
      // assignment is active if effective_from <= periodEnd AND
      // (effective_to IS NULL OR effective_to >= periodStart).
      const activeAssignments = await tx
        .select({
          employeeId: schema.employeeSalaryComponents.employeeId,
          amountCents: schema.employeeSalaryComponents.amountCents,
          percentBps: schema.employeeSalaryComponents.percentBps,
          code: schema.salaryComponents.code,
          name: schema.salaryComponents.name,
          kind: schema.salaryComponents.kind,
          calculationBasis: schema.salaryComponents.calculationBasis,
          defaultAmountCents: schema.salaryComponents.defaultAmountCents,
          countsForEpf: schema.salaryComponents.countsForEpf,
          countsForEtf: schema.salaryComponents.countsForEtf,
          countsForPaye: schema.salaryComponents.countsForPaye,
          sortOrder: schema.salaryComponents.sortOrder,
          componentId: schema.salaryComponents.id,
        })
        .from(schema.employeeSalaryComponents)
        .innerJoin(
          schema.salaryComponents,
          eq(schema.salaryComponents.id, schema.employeeSalaryComponents.componentId),
        )
        .where(
          and(
            eq(schema.employeeSalaryComponents.tenantId, ctx.tenantId),
            isNull(schema.employeeSalaryComponents.deletedAt),
            lte(schema.employeeSalaryComponents.effectiveFrom, periodEnd),
            or(
              isNull(schema.employeeSalaryComponents.effectiveTo),
              gte(schema.employeeSalaryComponents.effectiveTo, periodStart),
            ),
            isNull(schema.salaryComponents.deletedAt),
            eq(schema.salaryComponents.isActive, true),
          ),
        );

      const assignmentsByEmployee = new Map<string, typeof activeAssignments>();
      for (const a of activeAssignments) {
        const list = assignmentsByEmployee.get(a.employeeId) ?? [];
        list.push(a);
        assignmentsByEmployee.set(a.employeeId, list);
      }

      // Approved leave days per employee within the period, split by whether
      // the leave type is paid or unpaid:
      //   - unpaid (np) → auto-injected NOPAY-LV deduction below, prorated by
      //     tenantSettings.salaryDaysPerMonth.
      //   - paid        → informational only; surfaces on the payslip so the
      //     employee can see the consumption against their allocation.
      const tenantSettings = await loadTenantSettings(tx);
      const npDaysByEmployee = new Map<string, number>();
      const paidDaysByEmployee = new Map<string, number>();
      const leaveRows = (await tx.execute(sql`
        SELECT lr.employee_id,
               lr.from_date::text AS from_date,
               lr.to_date::text   AS to_date,
               lr.days_count,
               lt.is_paid
        FROM leave_requests lr
        INNER JOIN leave_types lt
          ON lt.id = lr.leave_type_id
         AND lt.tenant_id = lr.tenant_id
        WHERE lr.tenant_id = current_tenant_id()
          AND lr.status = 'approved'
          AND lt.deleted_at IS NULL
          AND lr.from_date <= ${periodEnd}::date
          AND lr.to_date   >= ${periodStart}::date
      `)) as unknown as Array<{
        employee_id: string;
        from_date: string;
        to_date: string;
        days_count: string | number;
        is_paid: boolean;
      }>;

      const SALARY_DAYS_PER_MONTH = tenantSettings.salaryDaysPerMonth;
      const msPerDay = 86_400_000;
      for (const r of leaveRows) {
        const reqStart = new Date(r.from_date).getTime();
        const reqEnd = new Date(r.to_date).getTime();
        const windowStart = Math.max(reqStart, new Date(periodStart).getTime());
        const windowEnd = Math.min(reqEnd, new Date(periodEnd).getTime());
        if (windowEnd < windowStart) continue; // no overlap
        const overlapCalendarDays = Math.round((windowEnd - windowStart) / msPerDay) + 1;
        const totalCalendarDays = Math.round((reqEnd - reqStart) / msPerDay) + 1;
        // Prorate days_count (can be fractional — half-day leave) by the
        // share of the leave-request window that falls inside this period.
        const portion =
          totalCalendarDays > 0 ? overlapCalendarDays / totalCalendarDays : 1;
        const days = Number(r.days_count) * portion;
        const bucket = r.is_paid ? paidDaysByEmployee : npDaysByEmployee;
        bucket.set(r.employee_id, (bucket.get(r.employee_id) ?? 0) + days);
      }

      // Load unapplied salary revisions that land on this run's arrears.
      // A revision is in scope if effective_date <= periodEnd. The live
      // employees.basic_salary_cents already holds the new rate (set when
      // the revision was saved) so the current run pays at the new rate.
      // Arrears = (new - previous) × whole-months between effective-date
      // and periodStart, i.e. count of already-paid prior periods. Per
      // payroll-module-spec §14.4.
      const revisionRows = eligible.length
        ? await tx
            .select()
            .from(schema.employeeSalaryRevisions)
            .where(
              and(
                eq(schema.employeeSalaryRevisions.tenantId, ctx.tenantId),
                isNull(schema.employeeSalaryRevisions.appliedInRunId),
                inArray(
                  schema.employeeSalaryRevisions.employeeId,
                  eligible.map((e) => e.id),
                ),
                lte(schema.employeeSalaryRevisions.effectiveDate, periodEnd),
              ),
            )
        : [];
      const revisionsByEmployee = new Map<string, typeof revisionRows>();
      for (const r of revisionRows) {
        const list = revisionsByEmployee.get(r.employeeId) ?? [];
        list.push(r);
        revisionsByEmployee.set(r.employeeId, list);
      }
      // periodStart is YYYY-MM-01 — parse for whole-month diff math.
      const periodStartParts = periodStart.split("-").map(Number);
      const periodStartYear = periodStartParts[0] ?? input.periodYear;
      const periodStartMonth = periodStartParts[1] ?? input.periodMonth;

      // Revisions we touch during compute, applied en-masse after the loop.
      const consumedRevisions: Array<{ id: string; arrearsCents: number }> = [];

      // Load unclaimed staff-loan EMI rows that fall due by periodEnd.
      // Outer join against employee_loans to filter only disbursed loans and
      // get the loan_number for the deduction label. Same atomic-claim idiom
      // as arrears: we stamp applied_in_run_id at draft-creation time so a
      // later run can't re-deduct the same EMI.
      const loanDueRows = eligible.length
        ? ((await tx.execute(sql`
            SELECT s.id              AS schedule_id,
                   s.loan_id         AS loan_id,
                   s.installment_no  AS installment_no,
                   s.principal_cents AS principal_cents,
                   s.interest_cents  AS interest_cents,
                   s.total_cents     AS total_cents,
                   s.due_date::text  AS due_date,
                   l.employee_id     AS employee_id,
                   l.loan_number     AS loan_number
            FROM employee_loan_schedule s
            INNER JOIN employee_loans l
              ON l.id = s.loan_id
             AND l.tenant_id = s.tenant_id
            WHERE s.tenant_id = ${ctx.tenantId}::uuid
              AND s.status = 'pending'
              AND s.applied_in_run_id IS NULL
              AND s.due_date <= ${periodEnd}::date
              AND l.status = 'disbursed'
              AND l.deleted_at IS NULL
          `)) as unknown as Array<{
            schedule_id: string;
            loan_id: string;
            installment_no: number;
            principal_cents: number;
            interest_cents: number;
            total_cents: number;
            due_date: string;
            employee_id: string;
            loan_number: string | null;
          }>)
        : [];
      const loansByEmployee = new Map<string, typeof loanDueRows>();
      for (const r of loanDueRows) {
        const list = loansByEmployee.get(r.employee_id) ?? [];
        list.push(r);
        loansByEmployee.set(r.employee_id, list);
      }
      // Schedule rows we'll claim after the loop. Each row's applied_in_run_id
      // gets stamped to run.id and linked to the payroll line it rode on.
      const consumedScheduleRows: Array<{
        scheduleId: string;
        runLineId: string;
        loanId: string;
        principalCents: number;
        interestCents: number;
      }> = [];

      // Compute each line and persist
      let gross = 0,
        epfEmp = 0,
        epfEr = 0,
        etfEr = 0,
        paye = 0,
        net = 0;

      for (const e of eligible) {
        const assignments = assignmentsByEmployee.get(e.id) ?? [];

        // Mid-period pro-rata (spec §14.1 joiner, §14.2 leaver).
        // workedStart = max(periodStart, hire_date)
        // workedEnd   = min(periodEnd, last_working_day ?? exit_date ?? periodEnd)
        // When the span is shorter than the calendar period, every EARNING
        // scales by daysWorked / periodDays. Deductions (loans, NOPAY-LV)
        // stay unscaled — they are fixed obligations, not proportional
        // to hours worked.
        const workedStart =
          e.hireDate && e.hireDate > periodStart ? e.hireDate : periodStart;
        const endCandidate = e.lastWorkingDay ?? e.exitDate ?? periodEnd;
        const workedEnd = endCandidate < periodEnd ? endCandidate : periodEnd;
        const daysWorked = Math.max(
          0,
          Math.round(
            (Date.UTC(
              Number(workedEnd.slice(0, 4)),
              Number(workedEnd.slice(5, 7)) - 1,
              Number(workedEnd.slice(8, 10)),
            ) -
              Date.UTC(
                Number(workedStart.slice(0, 4)),
                Number(workedStart.slice(5, 7)) - 1,
                Number(workedStart.slice(8, 10)),
              )) /
              86_400_000,
          ) + 1,
        );
        const isProrated = daysWorked > 0 && daysWorked < periodDays;
        const prorate = (cents: number): number =>
          isProrated ? Math.round((cents * daysWorked) / periodDays) : cents;
        const proratedBasic = prorate(e.basicSalaryCents);

        // Resolve to flat components for the compute. If no explicit
        // assignments exist, fall back to a single Basic earning built from
        // employees.basic_salary_cents — this keeps v1 employees (pre-
        // structure) working without any data migration.
        let resolved: ResolvedComponent[];
        const snapshotInputs: Array<{
          componentId: string | null;
          code: string;
          name: string;
          kind: "earning" | "deduction";
          amountCents: number;
          countsForEpf: boolean;
          countsForEtf: boolean;
          countsForPaye: boolean;
          sortOrder: number;
        }> = [];

        if (assignments.length === 0) {
          resolved = [
            {
              code: "BASIC",
              name: "Basic salary",
              kind: "earning",
              amountCents: proratedBasic,
              countsForEpf: true,
              countsForEtf: true,
              countsForPaye: true,
              sortOrder: 10,
            },
          ];
          snapshotInputs.push({
            componentId: null,
            code: "BASIC",
            name: "Basic salary",
            kind: "earning",
            amountCents: proratedBasic,
            countsForEpf: true,
            countsForEtf: true,
            countsForPaye: true,
            sortOrder: 10,
          });
        } else {
          resolved = assignments.map((a) => {
            const kind = (a.kind as "earning" | "deduction");
            let amount = a.amountCents;
            if (a.calculationBasis === "from_employee_basic") {
              amount = e.basicSalaryCents;
            } else if (a.calculationBasis === "percent_of_basic") {
              amount = Math.round((e.basicSalaryCents * a.percentBps) / 10_000);
            }
            // Scale earnings by worked-days ratio for mid-period joiners/leavers.
            // Deductions pass through unchanged — loan EMIs, ad-hoc deductions
            // are fixed obligations independent of hours worked.
            if (kind === "earning" && isProrated) {
              amount = Math.round((amount * daysWorked) / periodDays);
            }
            snapshotInputs.push({
              componentId: a.componentId,
              code: a.code,
              name: a.name,
              kind,
              amountCents: amount,
              countsForEpf: a.countsForEpf,
              countsForEtf: a.countsForEtf,
              countsForPaye: a.countsForPaye,
              sortOrder: a.sortOrder,
            });
            return {
              code: a.code,
              name: a.name,
              kind,
              amountCents: amount,
              countsForEpf: a.countsForEpf,
              countsForEtf: a.countsForEtf,
              countsForPaye: a.countsForPaye,
              sortOrder: a.sortOrder,
            };
          });
        }

        // Auto-injected no-pay leave deduction from approved leave requests
        // that overlap this period. Kept separate from any manually-assigned
        // NOPAY component so both can coexist (e.g. a standing sabbatical
        // plus ad-hoc NP days).
        const npDays = npDaysByEmployee.get(e.id) ?? 0;
        if (npDays > 0 && e.basicSalaryCents > 0) {
          // SL convention: monthly salary divided by 30 calendar days.
          // For mid-period joiners/leavers we use the prorated basic as the
          // denominator base — NP days during the worked window should only
          // reduce the already-reduced earnings, not claw back unpaid days
          // the employee never would have been paid for.
          const npDeductionCents = Math.round(
            (proratedBasic * npDays) / SALARY_DAYS_PER_MONTH,
          );
          const npLabel = `No-pay leave (${npDays.toFixed(npDays % 1 === 0 ? 0 : 2)}d)`;
          resolved.push({
            code: "NOPAY-LV",
            name: npLabel,
            kind: "deduction",
            amountCents: npDeductionCents,
            // SL EPF Act s.47: NP reduces EPF/ETF basis, so it counts for
            // the statutory bases. PAYE is similarly reduced.
            countsForEpf: true,
            countsForEtf: true,
            countsForPaye: true,
            sortOrder: 95,
          });
          snapshotInputs.push({
            componentId: null,
            code: "NOPAY-LV",
            name: npLabel,
            kind: "deduction",
            amountCents: npDeductionCents,
            countsForEpf: true,
            countsForEtf: true,
            countsForPaye: true,
            sortOrder: 95,
          });
        }

        // Arrears injection — each unapplied revision contributes
        // (new − previous) × monthsUnpaid. Summed into one ARREARS line if
        // positive (retroactive raise), or OVERPAY-REC deduction if the
        // net is negative (retroactive cut). A revision with effective_date
        // inside the current run period contributes 0 arrears but is still
        // marked applied — the live basic_salary_cents already reflects it.
        const revisions = revisionsByEmployee.get(e.id) ?? [];
        let arrearsNet = 0;
        const effectiveDates: string[] = [];
        for (const r of revisions) {
          const effParts = r.effectiveDate.split("-").map(Number);
          const effY = effParts[0] ?? periodStartYear;
          const effM = effParts[1] ?? periodStartMonth;
          const monthsUnpaid = Math.max(
            0,
            (periodStartYear - effY) * 12 + (periodStartMonth - effM),
          );
          const diff = r.newBasicSalaryCents - r.previousBasicSalaryCents;
          const cents = diff * monthsUnpaid;
          arrearsNet += cents;
          consumedRevisions.push({ id: r.id, arrearsCents: cents });
          effectiveDates.push(r.effectiveDate);
        }
        if (arrearsNet > 0) {
          const label =
            effectiveDates.length === 1
              ? `Arrears (effective ${effectiveDates[0]})`
              : `Arrears (${effectiveDates.length} revisions)`;
          resolved.push({
            code: "ARREARS",
            name: label,
            kind: "earning",
            amountCents: arrearsNet,
            // Arrears form part of remuneration in the month received —
            // count for EPF/ETF (SL EPF Act s.23 basis is wages earned)
            // and PAYE (tax-in-period-received, the simpler option per
            // payroll-module-spec §14.4).
            countsForEpf: true,
            countsForEtf: true,
            countsForPaye: true,
            sortOrder: 90,
          });
          snapshotInputs.push({
            componentId: null,
            code: "ARREARS",
            name: label,
            kind: "earning",
            amountCents: arrearsNet,
            countsForEpf: true,
            countsForEtf: true,
            countsForPaye: true,
            sortOrder: 90,
          });
        } else if (arrearsNet < 0) {
          const label =
            effectiveDates.length === 1
              ? `Overpayment recovery (effective ${effectiveDates[0]})`
              : `Overpayment recovery (${effectiveDates.length} revisions)`;
          resolved.push({
            code: "OVERPAY-REC",
            name: label,
            kind: "deduction",
            amountCents: -arrearsNet,
            countsForEpf: true,
            countsForEtf: true,
            countsForPaye: true,
            sortOrder: 90,
          });
          snapshotInputs.push({
            componentId: null,
            code: "OVERPAY-REC",
            name: label,
            kind: "deduction",
            amountCents: -arrearsNet,
            countsForEpf: true,
            countsForEtf: true,
            countsForPaye: true,
            sortOrder: 90,
          });
        }

        // Staff loan EMI recovery — one deduction line per loan so each
        // loan's recovery is visible on the payslip. countsForEpf/Etf/Paye
        // are all FALSE: loan repayment shouldn't shrink the statutory
        // bases (wages earned haven't changed). The schedule rows get
        // claimed after the line is inserted below so applied_run_line_id
        // can point at the canonical line.
        const dueRows = loansByEmployee.get(e.id) ?? [];
        // Group by loan so one LOAN-REC line covers N missed installments
        // if they've stacked up (shouldn't happen in steady state but
        // possible after a gap in payroll).
        const perLoan = new Map<
          string,
          {
            loanNumber: string | null;
            totalCents: number;
            principalCents: number;
            interestCents: number;
            scheduleIds: string[];
          }
        >();
        for (const r of dueRows) {
          const bucket = perLoan.get(r.loan_id) ?? {
            loanNumber: r.loan_number,
            totalCents: 0,
            principalCents: 0,
            interestCents: 0,
            scheduleIds: [] as string[],
          };
          bucket.totalCents += r.total_cents;
          bucket.principalCents += r.principal_cents;
          bucket.interestCents += r.interest_cents;
          bucket.scheduleIds.push(r.schedule_id);
          perLoan.set(r.loan_id, bucket);
        }
        for (const [loanId, b] of perLoan) {
          if (b.totalCents <= 0) continue;
          const installments = b.scheduleIds.length;
          const label =
            installments === 1
              ? `Loan recovery (${b.loanNumber ?? "loan"})`
              : `Loan recovery (${b.loanNumber ?? "loan"} · ${installments} EMIs)`;
          resolved.push({
            code: `LOAN-REC-${loanId.slice(0, 8)}`,
            name: label,
            kind: "deduction",
            amountCents: b.totalCents,
            countsForEpf: false,
            countsForEtf: false,
            countsForPaye: false,
            sortOrder: 100,
          });
          snapshotInputs.push({
            componentId: null,
            code: `LOAN-REC-${loanId.slice(0, 8)}`,
            name: label,
            kind: "deduction",
            amountCents: b.totalCents,
            countsForEpf: false,
            countsForEtf: false,
            countsForPaye: false,
            sortOrder: 100,
          });
        }

        const c = computePayrollFromComponents({
          components: resolved,
          epfEligible: e.epfEligible,
          etfEligible: e.etfEligible,
          payeApplicable: e.payeApplicable,
        });

        const [line] = await tx
          .insert(schema.payrollRunLines)
          .values({
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
            basicSalaryCents: proratedBasic,
            grossCents: c.grossCents,
            earningsCents: c.earningsCents,
            nonStatutoryDeductionsCents: c.nonStatutoryDeductionsCents,
            epfEmployeeCents: c.epfEmployeeCents,
            payeCents: c.payeCents,
            otherDeductionsCents: c.nonStatutoryDeductionsCents,
            totalDeductionsCents: c.totalDeductionsCents,
            epfEmployerCents: c.epfEmployerCents,
            etfEmployerCents: c.etfEmployerCents,
            netPayCents: c.netPayCents,
            wasEpfEligible: e.epfEligible,
            wasEtfEligible: e.etfEligible,
            wasPayeApplicable: e.payeApplicable,
            paidLeaveDays: (paidDaysByEmployee.get(e.id) ?? 0).toFixed(2),
            unpaidLeaveDays: (npDaysByEmployee.get(e.id) ?? 0).toFixed(2),
            // Only persist prorata denominator+numerator when the employee
            // didn't work the full period. NULL keeps the payslip clean for
            // the 99% steady-state case.
            prorataDaysWorked: isProrated ? daysWorked : null,
            prorataDaysInPeriod: isProrated ? periodDays : null,
            bankName: e.bankName,
            bankAccountNo: e.bankAccountNo,
            bankBranch: e.bankBranch,
          })
          .returning();
        if (!line) throw new Error("Payroll line insert failed");

        // Snapshot the component breakdown for audit + payslip rendering
        for (const s of snapshotInputs) {
          await tx.insert(schema.payrollRunLineComponents).values({
            tenantId: ctx.tenantId,
            lineId: line.id,
            componentId: s.componentId,
            code: s.code,
            name: s.name,
            kind: s.kind,
            amountCents: s.amountCents,
            countsForEpf: s.countsForEpf,
            countsForEtf: s.countsForEtf,
            countsForPaye: s.countsForPaye,
            sortOrder: s.sortOrder,
          });
        }

        // Queue schedule rows to be claimed after the loop completes. We
        // defer the UPDATE so that if anything throws between here and the
        // run-aggregates update, the atomic-claim idiom stays consistent
        // (the tx rolls back as a unit either way).
        for (const r of dueRows) {
          consumedScheduleRows.push({
            scheduleId: r.schedule_id,
            runLineId: line.id,
            loanId: r.loan_id,
            principalCents: r.principal_cents,
            interestCents: r.interest_cents,
          });
        }

        gross += c.grossCents;
        epfEmp += c.epfEmployeeCents;
        epfEr += c.epfEmployerCents;
        etfEr += c.etfEmployerCents;
        paye += c.payeCents;
        net += c.netPayCents;
      }

      // Atomically claim every revision we just compensated so it can't
      // drive arrears on a subsequent run. Arrears-paid amount is stamped
      // for audit. If a void/delete endpoint is ever added for runs, it
      // MUST unset applied_in_run_id on these revisions to release them.
      for (const cr of consumedRevisions) {
        await tx
          .update(schema.employeeSalaryRevisions)
          .set({
            appliedInRunId: run.id,
            appliedAt: new Date(),
            arrearsCentsApplied: cr.arrearsCents,
          })
          .where(eq(schema.employeeSalaryRevisions.id, cr.id));
      }

      // Claim staff-loan EMI rows. Same rule: any future void/delete handler
      // for runs MUST unset these back out, or the schedule will stay stuck.
      // Aggregate per-loan effects and update the loan header's running
      // outstanding totals in one pass.
      const loanEffects = new Map<
        string,
        { principal: number; interest: number }
      >();
      for (const cs of consumedScheduleRows) {
        await tx
          .update(schema.employeeLoanSchedule)
          .set({
            appliedInRunId: run.id,
            appliedRunLineId: cs.runLineId,
            appliedAt: new Date(),
          })
          .where(eq(schema.employeeLoanSchedule.id, cs.scheduleId));
        const prev = loanEffects.get(cs.loanId) ?? { principal: 0, interest: 0 };
        prev.principal += cs.principalCents;
        prev.interest += cs.interestCents;
        loanEffects.set(cs.loanId, prev);
      }
      // Note: we stamp `status = 'paid'` and decrement outstanding only at
      // post time (see below) so that voiding a draft doesn't leave the
      // loan header in a half-paid state.

      // Update run aggregates
      await tx
        .update(schema.payrollRuns)
        .set({
          grossCents: gross,
          epfEmployeeCents: epfEmp,
          epfEmployerCents: epfEr,
          etfEmployerCents: etfEr,
          payeCents: paye,
          netPayCents: net,
          updatedAt: new Date(),
        })
        .where(eq(schema.payrollRuns.id, run.id));

      return { ok: true as const, runId: run.id };
    });

    if ("error" in result) {
      if (result.error === "RUN_EXISTS") {
        return reply.status(409).send({
          error: {
            code: "RUN_EXISTS",
            message: "A payroll run already exists for this period. Void it first to redo.",
            existingRunId: result.id,
          },
        });
      }
      if (result.error === "NO_ELIGIBLE_EMPLOYEES") {
        return reply.status(400).send({
          error: {
            code: "NO_ELIGIBLE_EMPLOYEES",
            message:
              "No active employees with a basic salary > 0 found. Add employees first.",
          },
        });
      }
      return reply.status(500).send({ error: { code: result.error } });
    }

    return reply.status(201).send(result);
  });

  // POST /payroll-runs/:id/post — finalize draft: allocate number, post GL
  fastify.post<{ Params: { id: string } }>("/:id/post", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "payroll.manage");
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const runRows = await tx
        .select()
        .from(schema.payrollRuns)
        .where(
          and(
            eq(schema.payrollRuns.tenantId, ctx.tenantId),
            eq(schema.payrollRuns.id, req.params.id),
            isNull(schema.payrollRuns.deletedAt),
          ),
        )
        .limit(1);
      const run = runRows[0];
      if (!run) return { error: "NOT_FOUND" as const };
      if (run.status !== "draft") return { error: "NOT_DRAFT" as const };
      if (run.employeeCount === 0) return { error: "EMPTY" as const };

      // Resolve GL accounts
      const coaRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        );
      const bySub = new Map(coaRows.map((r) => [`${r.accountType}:${r.accountSubtype}`, r]));
      const salaryExpense = bySub.get("expense:payroll");
      const epfExpense = bySub.get("expense:payroll_epf");
      const etfExpense = bySub.get("expense:payroll_etf");
      const epfPayable = bySub.get("liability:epf");
      const etfPayable = bySub.get("liability:etf");
      const payePayable = bySub.get("liability:paye");
      const salariesPayable = bySub.get("liability:salaries");
      const employeeDeductions = bySub.get("liability:employee_deductions");
      // Loan recovery books against the receivable / interest income. These
      // are optional at post — only required if there are loan EMIs on this
      // run. If missing in the CoA we surface a clear error instead of
      // silently dropping the posting.
      const loansReceivable = bySub.get("asset:loans_receivable");
      const interestIncome = bySub.get("income:interest_income");

      for (const [key, acc] of [
        ["expense:payroll", salaryExpense],
        ["expense:payroll_epf", epfExpense],
        ["expense:payroll_etf", etfExpense],
        ["liability:epf", epfPayable],
        ["liability:etf", etfPayable],
        ["liability:paye", payePayable],
        ["liability:salaries", salariesPayable],
        ["liability:employee_deductions", employeeDeductions],
      ] as const) {
        if (!acc) return { error: "MISSING_ACCOUNT" as const, account: key };
      }

      // Sum loan EMIs claimed on this run's lines. They were picked up at
      // draft-creation time (applied_in_run_id stamped); at post we split
      // them into principal (goes to CR Loans receivable — reduces the
      // asset) and interest (goes to CR Interest income).
      const loanRecoveryRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(principal_cents), 0) AS principal_total,
               COALESCE(SUM(interest_cents), 0)  AS interest_total,
               COALESCE(SUM(total_cents), 0)     AS grand_total
          FROM employee_loan_schedule
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND applied_in_run_id = ${run.id}::uuid
      `)) as unknown as Array<{
        principal_total: string | number;
        interest_total: string | number;
        grand_total: string | number;
      }>;
      const loanPrincipalTotal = Number(loanRecoveryRows[0]?.principal_total ?? 0);
      const loanInterestTotal = Number(loanRecoveryRows[0]?.interest_total ?? 0);
      const loanGrandTotal = loanPrincipalTotal + loanInterestTotal;
      if (loanGrandTotal > 0 && (!loansReceivable || !interestIncome)) {
        return { error: "MISSING_ACCOUNT" as const, account: "asset:loans_receivable" };
      }

      const runNumber = await nextDocumentNumber(tx, "payroll");

      // Aggregate line-level figures needed to split gross into wages expense
      // (what we truly owe for work done) vs. amounts withheld from pay for
      // non-statutory recoveries (advance repayment, etc.) that land in a
      // clearing liability until reconciled against the original advance asset.
      const runLines = await tx
        .select({
          earningsCents: schema.payrollRunLines.earningsCents,
          nonStatutoryDeductionsCents: schema.payrollRunLines.nonStatutoryDeductionsCents,
          netPayCents: schema.payrollRunLines.netPayCents,
          epfEmployeeCents: schema.payrollRunLines.epfEmployeeCents,
          payeCents: schema.payrollRunLines.payeCents,
        })
        .from(schema.payrollRunLines)
        .where(
          and(
            eq(schema.payrollRunLines.tenantId, ctx.tenantId),
            eq(schema.payrollRunLines.runId, run.id),
          ),
        );
      const sumEarnings = runLines.reduce((s, l) => s + l.earningsCents, 0);
      const sumNonStat = runLines.reduce((s, l) => s + l.nonStatutoryDeductionsCents, 0);
      const sumNet = runLines.reduce((s, l) => s + l.netPayCents, 0);
      const sumEpfEmp = runLines.reduce((s, l) => s + l.epfEmployeeCents, 0);
      const sumPaye = runLines.reduce((s, l) => s + l.payeCents, 0);
      // Pre-tax basis-reducing deductions (e.g. no-pay leave) — those genuinely
      // reduce the employer's wages cost. Derived from the net identity:
      //   earnings = net + epfEmp + paye + preTax + nonStat
      const preTaxDed = Math.max(
        0,
        sumEarnings - sumNet - sumEpfEmp - sumPaye - sumNonStat,
      );
      const wagesExpense = sumEarnings - preTaxDed;

      // Build balanced journal:
      //   DR Salaries & wages               earnings − pre-tax deductions
      //   DR EPF employer contribution      epf_employer
      //   DR ETF employer contribution      etf_employer
      //     CR EPF payable                  epf_employee + epf_employer
      //     CR ETF payable                  etf_employer
      //     CR PAYE payable                 paye
      //     CR Salaries payable             net
      //     CR Employee deductions payable  non-statutory recoveries
      const journalLines: Parameters<typeof postJournal>[1]["lines"] = [
        {
          accountId: salaryExpense!.id,
          drCents: wagesExpense,
          description: `Payroll ${runNumber} · wages`,
        },
      ];
      if (run.epfEmployerCents > 0) {
        journalLines.push({
          accountId: epfExpense!.id,
          drCents: run.epfEmployerCents,
          description: `Payroll ${runNumber} · EPF employer`,
        });
      }
      if (run.etfEmployerCents > 0) {
        journalLines.push({
          accountId: etfExpense!.id,
          drCents: run.etfEmployerCents,
          description: `Payroll ${runNumber} · ETF employer`,
        });
      }
      const epfTotal = run.epfEmployeeCents + run.epfEmployerCents;
      if (epfTotal > 0) {
        journalLines.push({
          accountId: epfPayable!.id,
          crCents: epfTotal,
          description: `EPF payable · ${runNumber}`,
        });
      }
      if (run.etfEmployerCents > 0) {
        journalLines.push({
          accountId: etfPayable!.id,
          crCents: run.etfEmployerCents,
          description: `ETF payable · ${runNumber}`,
        });
      }
      if (run.payeCents > 0) {
        journalLines.push({
          accountId: payePayable!.id,
          crCents: run.payeCents,
          description: `PAYE payable · ${runNumber}`,
        });
      }
      journalLines.push({
        accountId: salariesPayable!.id,
        crCents: run.netPayCents,
        description: `Net salaries · ${runNumber}`,
      });
      // Split non-statutory deductions: loan recovery credits the
      // receivable (asset reduction) + interest income; remainder lands
      // in the employee deductions clearing liability.
      const otherDeductions = Math.max(0, sumNonStat - loanGrandTotal);
      if (loanPrincipalTotal > 0) {
        journalLines.push({
          accountId: loansReceivable!.id,
          crCents: loanPrincipalTotal,
          description: `Loan recoveries · ${runNumber}`,
        });
      }
      if (loanInterestTotal > 0) {
        journalLines.push({
          accountId: interestIncome!.id,
          crCents: loanInterestTotal,
          description: `Loan interest · ${runNumber}`,
        });
      }
      if (otherDeductions > 0) {
        journalLines.push({
          accountId: employeeDeductions!.id,
          crCents: otherDeductions,
          description: `Employee deductions withheld · ${runNumber}`,
        });
      }

      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: run.payDate,
        memo: `Payroll ${runNumber} · ${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`,
        sourceType: "payroll_run",
        sourceId: run.id,
        postedByUserId: ctx.userId,
        lines: journalLines,
      });

      await tx
        .update(schema.payrollRuns)
        .set({
          status: "posted",
          runNumber,
          journalEntryId: entryId,
          postedAt: new Date(),
          postedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.payrollRuns.id, run.id));

      // Flip claimed EMI schedule rows to 'paid' and decrement the loan
      // header's outstanding totals. Close any loan whose outstanding has
      // hit zero. We do this at POST (not at draft creation) so that
      // rolling back a draft doesn't leave half-paid loans behind.
      if (loanGrandTotal > 0) {
        const claimedRows = await tx
          .select()
          .from(schema.employeeLoanSchedule)
          .where(
            and(
              eq(schema.employeeLoanSchedule.tenantId, ctx.tenantId),
              eq(schema.employeeLoanSchedule.appliedInRunId, run.id),
            ),
          );
        const effects = new Map<
          string,
          { principal: number; interest: number }
        >();
        for (const r of claimedRows) {
          await tx
            .update(schema.employeeLoanSchedule)
            .set({ status: "paid" })
            .where(eq(schema.employeeLoanSchedule.id, r.id));
          const p = effects.get(r.loanId) ?? { principal: 0, interest: 0 };
          p.principal += r.principalCents;
          p.interest += r.interestCents;
          effects.set(r.loanId, p);
        }
        for (const [loanId, eff] of effects) {
          const [lr] = await tx
            .select()
            .from(schema.employeeLoans)
            .where(eq(schema.employeeLoans.id, loanId))
            .limit(1);
          if (!lr) continue;
          const newPrincipalOut = Math.max(0, lr.principalOutstandingCents - eff.principal);
          const newInterestOut = Math.max(0, lr.interestOutstandingCents - eff.interest);
          const fullyPaid = newPrincipalOut === 0 && newInterestOut === 0;
          await tx
            .update(schema.employeeLoans)
            .set({
              principalOutstandingCents: newPrincipalOut,
              interestOutstandingCents: newInterestOut,
              principalRepaidCents: lr.principalRepaidCents + eff.principal,
              interestRepaidCents: lr.interestRepaidCents + eff.interest,
              ...(fullyPaid && {
                status: "closed",
                closedAt: new Date(),
                closedReason: "fully_paid",
              }),
              updatedAt: new Date(),
            })
            .where(eq(schema.employeeLoans.id, loanId));
        }
      }

      return { ok: true as const, runNumber, entryNumber };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_DRAFT: 409,
        EMPTY: 400,
        MISSING_ACCOUNT: 500,
      };
      return reply.status(map[result.error] ?? 500).send({
        error: { code: result.error, account: "account" in result ? result.account : undefined },
      });
    }
    return reply.send(result);
  });

  // POST /payroll-runs/:id/pay — disburse net pay, clearing Salaries payable
  const PaySchema = z.object({
    bankAccountId: z.string().uuid(),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    method: z
      .enum(["bank_transfer", "slips", "cash", "cheque", "other"])
      .default("slips"),
    reference: z.string().max(64).optional().or(z.literal("")),
    memo: z.string().optional().or(z.literal("")),
  });

  fastify.post<{ Params: { id: string } }>("/:id/pay", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = PaySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", issues: parsed.error.issues },
      });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const runRows = await tx
        .select()
        .from(schema.payrollRuns)
        .where(
          and(
            eq(schema.payrollRuns.tenantId, ctx.tenantId),
            eq(schema.payrollRuns.id, req.params.id),
            isNull(schema.payrollRuns.deletedAt),
          ),
        )
        .limit(1);
      const run = runRows[0];
      if (!run) return { error: "NOT_FOUND" as const };
      if (run.status !== "posted") return { error: "NOT_PAYABLE" as const };

      // Verify bank/cash account
      const bankRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.id, input.bankAccountId),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      const bank = bankRows[0];
      if (!bank) return { error: "BANK_NOT_FOUND" as const };
      if (bank.accountType !== "asset" || !["cash", "bank"].includes(bank.accountSubtype ?? "")) {
        return { error: "INVALID_BANK_ACCOUNT" as const };
      }

      // Resolve Salaries payable
      const salariesPayableRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.accountSubtype, "salaries"),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      const salariesPayable = salariesPayableRows[0];
      if (!salariesPayable) return { error: "NO_SALARIES_PAYABLE_ACCOUNT" as const };

      if (run.netPayCents <= 0) return { error: "NOTHING_TO_PAY" as const };

      const payDate = input.paymentDate ?? new Date().toISOString().slice(0, 10);
      const refSuffix = input.reference ? ` · ${input.reference}` : "";

      // Journal: DR Salaries payable (full net), CR Bank (full net)
      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: payDate,
        memo: `Payroll ${run.runNumber ?? run.id.slice(0, 8)} disbursement${refSuffix}`,
        sourceType: "payroll_disbursement",
        sourceId: run.id,
        postedByUserId: ctx.userId,
        lines: [
          {
            accountId: salariesPayable.id,
            drCents: run.netPayCents,
            description: `Salaries paid · ${run.runNumber ?? ""}`,
          },
          {
            accountId: bank.id,
            crCents: run.netPayCents,
            description: `Payroll disbursement · ${input.method}${refSuffix}`,
          },
        ],
      });

      await tx
        .update(schema.payrollRuns)
        .set({
          status: "paid",
          updatedAt: new Date(),
          notes:
            input.memo && run.notes
              ? `${run.notes}\n\n[Paid] ${input.memo}`
              : input.memo
                ? `[Paid] ${input.memo}`
                : run.notes,
        })
        .where(eq(schema.payrollRuns.id, run.id));

      return { ok: true as const, entryNumber };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_PAYABLE: 409,
        BANK_NOT_FOUND: 400,
        INVALID_BANK_ACCOUNT: 400,
        NOTHING_TO_PAY: 400,
        NO_SALARIES_PAYABLE_ACCOUNT: 500,
      };
      const messages: Record<string, string> = {
        NOT_PAYABLE: "Only posted (unpaid) runs can be paid.",
        INVALID_BANK_ACCOUNT: "Pick a bank or cash account.",
      };
      return reply.status(map[result.error] ?? 500).send({
        error: { code: result.error, message: messages[result.error] },
      });
    }
    return reply.send(result);
  });

  // ----- Statutory CSV exports -----
  // All three routes load the run + lines + component snapshots, then emit
  // Labour-Department-friendly CSVs. Only posted or paid runs are exportable
  // (drafts are provisional). Amounts are rupees with 2 decimals, not cents.

  /** CSV cell escape: wrap in quotes if contains comma, quote, or newline. */
  function csv(val: string | number | null | undefined): string {
    if (val === null || val === undefined) return "";
    const s = String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  function rupees(cents: number): string {
    return (cents / 100).toFixed(2);
  }

  async function loadRunForExport(tenantId: string, runId: string) {
    return withTenant(tenantId, async (tx) => {
      const runRows = await tx
        .select()
        .from(schema.payrollRuns)
        .where(
          and(
            eq(schema.payrollRuns.tenantId, tenantId),
            eq(schema.payrollRuns.id, runId),
            isNull(schema.payrollRuns.deletedAt),
          ),
        )
        .limit(1);
      const run = runRows[0];
      if (!run) return null;
      const lines = await tx
        .select()
        .from(schema.payrollRunLines)
        .where(eq(schema.payrollRunLines.runId, run.id))
        .orderBy(asc(schema.payrollRunLines.employeeFullName));
      const snaps = lines.length
        ? await tx
            .select()
            .from(schema.payrollRunLineComponents)
            .where(
              and(
                eq(schema.payrollRunLineComponents.tenantId, tenantId),
                inArray(
                  schema.payrollRunLineComponents.lineId,
                  lines.map((l) => l.id),
                ),
              ),
            )
        : [];
      const snapByLine = new Map<string, typeof snaps>();
      for (const c of snaps) {
        const list = snapByLine.get(c.lineId) ?? [];
        list.push(c);
        snapByLine.set(c.lineId, list);
      }
      return { run, lines, snapByLine };
    });
  }

  /** Sum earnings − deductions per statutory basis flag for one line's snapshot. */
  function basisFor(
    comps: Array<{ kind: string; amountCents: number; countsForEpf: boolean; countsForEtf: boolean; countsForPaye: boolean }>,
    flag: "epf" | "etf" | "paye",
  ): number {
    let basis = 0;
    for (const c of comps) {
      const counts =
        flag === "epf" ? c.countsForEpf : flag === "etf" ? c.countsForEtf : c.countsForPaye;
      if (!counts) continue;
      basis += c.kind === "earning" ? c.amountCents : -c.amountCents;
    }
    return Math.max(0, basis);
  }

  // GET /payroll-runs/:id/epf-csv — SL Labour Dept EPF C-form member contribution file
  fastify.get<{ Params: { id: string } }>("/:id/epf-csv", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const data = await loadRunForExport(ctx.tenantId, req.params.id);
    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    const { run, lines, snapByLine } = data;
    if (run.status === "draft") {
      return reply.status(400).send({
        error: { code: "NOT_POSTED", message: "Post the run before exporting statutory files." },
      });
    }

    const period = `${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`;
    const header = [
      "Member Number",
      "NIC",
      "Name",
      "Total EPF Earnings (Rs.)",
      "Employee Contribution 8% (Rs.)",
      "Employer Contribution 12% (Rs.)",
      "Total 20% (Rs.)",
      "Period",
    ];
    const body: string[] = [header.map(csv).join(",")];
    let totalEarnings = 0,
      totalEmp = 0,
      totalEr = 0;

    for (const l of lines) {
      if (!l.wasEpfEligible) continue;
      const snap = snapByLine.get(l.id) ?? [];
      const basis = snap.length > 0 ? basisFor(snap, "epf") : l.earningsCents;
      const empC = l.epfEmployeeCents;
      const erC = l.epfEmployerCents;
      if (empC + erC === 0) continue;
      totalEarnings += basis;
      totalEmp += empC;
      totalEr += erC;
      body.push(
        [
          l.epfNumber ?? "",
          l.nic ?? "",
          l.employeeFullName.toUpperCase(),
          rupees(basis),
          rupees(empC),
          rupees(erC),
          rupees(empC + erC),
          period,
        ]
          .map(csv)
          .join(","),
      );
    }
    body.push(
      ["TOTAL", "", "", rupees(totalEarnings), rupees(totalEmp), rupees(totalEr), rupees(totalEmp + totalEr), period]
        .map(csv)
        .join(","),
    );

    const filename = `epf-cform-${period}-${run.runNumber ?? run.id.slice(0, 8)}.csv`;
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(body.join("\r\n") + "\r\n");
  });

  // GET /payroll-runs/:id/etf-csv — SL Labour Dept ETF R-form (3% employer only)
  fastify.get<{ Params: { id: string } }>("/:id/etf-csv", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const data = await loadRunForExport(ctx.tenantId, req.params.id);
    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    const { run, lines, snapByLine } = data;
    if (run.status === "draft") {
      return reply.status(400).send({
        error: { code: "NOT_POSTED", message: "Post the run before exporting statutory files." },
      });
    }

    const period = `${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`;
    const header = [
      "Member Number",
      "NIC",
      "Name",
      "Total ETF Earnings (Rs.)",
      "Employer Contribution 3% (Rs.)",
      "Period",
    ];
    const body: string[] = [header.map(csv).join(",")];
    let totalEarn = 0,
      totalEr = 0;

    for (const l of lines) {
      if (!l.wasEtfEligible) continue;
      const snap = snapByLine.get(l.id) ?? [];
      const basis = snap.length > 0 ? basisFor(snap, "etf") : l.earningsCents;
      const erC = l.etfEmployerCents;
      if (erC === 0) continue;
      totalEarn += basis;
      totalEr += erC;
      body.push(
        [
          l.etfNumber ?? l.epfNumber ?? "",
          l.nic ?? "",
          l.employeeFullName.toUpperCase(),
          rupees(basis),
          rupees(erC),
          period,
        ]
          .map(csv)
          .join(","),
      );
    }
    body.push(
      ["TOTAL", "", "", rupees(totalEarn), rupees(totalEr), period].map(csv).join(","),
    );

    const filename = `etf-rform-${period}-${run.runNumber ?? run.id.slice(0, 8)}.csv`;
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(body.join("\r\n") + "\r\n");
  });

  // GET /payroll-runs/:id/paye-csv — PAYE T-10 monthly schedule of tax deductions
  fastify.get<{ Params: { id: string } }>("/:id/paye-csv", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const data = await loadRunForExport(ctx.tenantId, req.params.id);
    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    const { run, lines, snapByLine } = data;
    if (run.status === "draft") {
      return reply.status(400).send({
        error: { code: "NOT_POSTED", message: "Post the run before exporting statutory files." },
      });
    }

    const period = `${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`;
    const header = [
      "NIC",
      "Name",
      "Designation",
      "Gross Remuneration (Rs.)",
      "PAYE Basis (Rs.)",
      "PAYE Deducted (Rs.)",
      "Period",
    ];
    const body: string[] = [header.map(csv).join(",")];
    let totalGross = 0,
      totalBasis = 0,
      totalPaye = 0;

    for (const l of lines) {
      if (l.payeCents === 0) continue;
      const snap = snapByLine.get(l.id) ?? [];
      const basis = snap.length > 0 ? basisFor(snap, "paye") : l.earningsCents;
      totalGross += l.earningsCents;
      totalBasis += basis;
      totalPaye += l.payeCents;
      body.push(
        [
          l.nic ?? "",
          l.employeeFullName.toUpperCase(),
          l.designation ?? "",
          rupees(l.earningsCents),
          rupees(basis),
          rupees(l.payeCents),
          period,
        ]
          .map(csv)
          .join(","),
      );
    }
    if (body.length === 1) {
      body.push(["", "No employees with PAYE liability this period", "", "", "", "", period].map(csv).join(","));
    } else {
      body.push(
        ["TOTAL", "", "", rupees(totalGross), rupees(totalBasis), rupees(totalPaye), period]
          .map(csv)
          .join(","),
      );
    }

    const filename = `paye-t10-${period}-${run.runNumber ?? run.id.slice(0, 8)}.csv`;
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(body.join("\r\n") + "\r\n");
  });
};
