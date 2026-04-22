import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "../accounting/journal-posting.js";

/**
 * Staff loan module — payroll-module-spec §6.
 *
 * Flow:
 *   1. POST /employee-loans/apply            → status: draft
 *   2. POST /employee-loans/:id/approve      → status: approved
 *   3. POST /employee-loans/:id/disburse     → status: disbursed
 *        · materializes employee_loan_schedule rows
 *        · posts JE (DR 1150 Employee loans receivable / CR chosen bank)
 *        · sets principal_outstanding / interest_outstanding
 *   4. POST /employee-loans/:id/cancel       → before disbursement only
 *   5. POST /employee-loans/:id/write-off    → after disbursement, forgives balance
 *
 * EMI collection happens in the payroll run (see modules/hr/payroll-runs.ts).
 * Compute picks up schedule rows with status='pending' AND applied_in_run_id
 * IS NULL AND due_date <= periodEnd, sums them into a LOAN-REC deduction,
 * and atomically claims them at draft-creation time.
 */

const ApplySchema = z.object({
  employeeId: z.string().uuid(),
  loanTypeId: z.string().uuid().nullable().optional(),
  principalCents: z.number().int().min(1),
  interestRateBps: z.number().int().min(0).max(10_000).default(0),
  tenureMonths: z.number().int().min(1).max(120),
  firstInstallmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  applicationReason: z.string().max(1000).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

const ApproveSchema = z.object({
  approvalNotes: z.string().max(1000).optional().or(z.literal("")),
});

const DisburseSchema = z.object({
  disbursementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  disbursementAccountId: z.string().uuid(),
  firstInstallmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const CancelSchema = z.object({
  reason: z.string().max(500).optional().or(z.literal("")),
});

const WriteOffSchema = z.object({
  reason: z.string().max(500),
});

const CreateLoanTypeSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(128),
  description: z.string().optional().or(z.literal("")),
  maxAmountCents: z.number().int().min(0).nullable().optional(),
  defaultInterestRateBps: z.number().int().min(0).max(10_000).default(0),
  defaultTenureMonths: z.number().int().min(1).max(120).default(6),
  maxTenureMonths: z.number().int().min(1).max(120).default(60),
  isInterestBearing: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

// Flat-rate amortization. principal × rate × tenure / 12 / 10000 → interest.
// EMI = (principal + interest) / tenure. Remainder lands on the last row.
function buildSchedule(
  principalCents: number,
  interestRateBps: number,
  tenureMonths: number,
  firstInstallmentISO: string,
): {
  emiCents: number;
  totalInterestCents: number;
  rows: Array<{
    installmentNo: number;
    dueDate: string;
    principalCents: number;
    interestCents: number;
    totalCents: number;
    openingBalanceCents: number;
    closingBalanceCents: number;
  }>;
} {
  const totalInterestCents = Math.round(
    (principalCents * interestRateBps * tenureMonths) / 12 / 10_000,
  );
  const grand = principalCents + totalInterestCents;
  const baseEmi = Math.floor(grand / tenureMonths);
  const finalEmi = grand - baseEmi * (tenureMonths - 1);

  // Split base EMI into principal/interest pro-rata by the grand ratio.
  const baseInterest = totalInterestCents === 0
    ? 0
    : Math.floor((baseEmi * totalInterestCents) / grand);
  const basePrincipal = baseEmi - baseInterest;
  const finalInterest = totalInterestCents - baseInterest * (tenureMonths - 1);
  const finalPrincipal = finalEmi - finalInterest;

  const rows: ReturnType<typeof buildSchedule>["rows"] = [];
  const [fy, fm, fd] = firstInstallmentISO.split("-").map(Number);
  let runningBalance = principalCents;
  for (let i = 0; i < tenureMonths; i++) {
    const monthIdx = (fm ?? 1) - 1 + i;
    const due = new Date(Date.UTC(fy ?? 2026, monthIdx, fd ?? 1));
    const isLast = i === tenureMonths - 1;
    const principalPart = isLast ? finalPrincipal : basePrincipal;
    const interestPart = isLast ? finalInterest : baseInterest;
    const total = principalPart + interestPart;
    const opening = runningBalance;
    runningBalance = Math.max(0, runningBalance - principalPart);
    rows.push({
      installmentNo: i + 1,
      dueDate: due.toISOString().slice(0, 10),
      principalCents: principalPart,
      interestCents: interestPart,
      totalCents: total,
      openingBalanceCents: opening,
      closingBalanceCents: runningBalance,
    });
  }

  return { emiCents: baseEmi, totalInterestCents, rows };
}

export const loanTypesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /loan-types
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.loanTypes)
        .where(
          and(
            eq(schema.loanTypes.tenantId, ctx.tenantId),
            isNull(schema.loanTypes.deletedAt),
          ),
        )
        .orderBy(asc(schema.loanTypes.name)),
    );
    return reply.send({ loanTypes: rows });
  });

  // POST /loan-types
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateLoanTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .insert(schema.loanTypes)
        .values({
          tenantId: ctx.tenantId,
          code: d.code,
          name: d.name,
          description: d.description || null,
          maxAmountCents: d.maxAmountCents ?? null,
          defaultInterestRateBps: d.defaultInterestRateBps,
          defaultTenureMonths: d.defaultTenureMonths,
          maxTenureMonths: d.maxTenureMonths,
          isInterestBearing: d.isInterestBearing,
          isActive: d.isActive,
          isSystem: false,
          createdByUserId: ctx.userId,
        })
        .returning(),
    );
    return reply.status(201).send({ loanType: rows[0] });
  });

  // PATCH /loan-types/:id
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateLoanTypeSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    const updated = await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.loanTypes)
        .set({
          ...(d.name !== undefined && { name: d.name }),
          ...(d.description !== undefined && { description: d.description || null }),
          ...(d.maxAmountCents !== undefined && { maxAmountCents: d.maxAmountCents }),
          ...(d.defaultInterestRateBps !== undefined && { defaultInterestRateBps: d.defaultInterestRateBps }),
          ...(d.defaultTenureMonths !== undefined && { defaultTenureMonths: d.defaultTenureMonths }),
          ...(d.maxTenureMonths !== undefined && { maxTenureMonths: d.maxTenureMonths }),
          ...(d.isInterestBearing !== undefined && { isInterestBearing: d.isInterestBearing }),
          ...(d.isActive !== undefined && { isActive: d.isActive }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.loanTypes.tenantId, ctx.tenantId),
            eq(schema.loanTypes.id, req.params.id),
            isNull(schema.loanTypes.deletedAt),
          ),
        )
        .returning();
      return row;
    });
    if (!updated) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ loanType: updated });
  });
};

export const employeeLoansRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /employee-loans — list with employee name
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          loan: schema.employeeLoans,
          employeeName: schema.employees.fullName,
          employeeCode: schema.employees.employeeCode,
        })
        .from(schema.employeeLoans)
        .innerJoin(schema.employees, eq(schema.employees.id, schema.employeeLoans.employeeId))
        .where(
          and(
            eq(schema.employeeLoans.tenantId, ctx.tenantId),
            isNull(schema.employeeLoans.deletedAt),
          ),
        )
        .orderBy(desc(schema.employeeLoans.appliedAt))
        .limit(200),
    );
    return reply.send({
      loans: rows.map((r) => ({
        ...r.loan,
        employeeName: r.employeeName,
        employeeCode: r.employeeCode,
      })),
    });
  });

  // GET /employee-loans/:id — with schedule
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const loanRows = await tx
        .select({
          loan: schema.employeeLoans,
          employeeName: schema.employees.fullName,
          employeeCode: schema.employees.employeeCode,
        })
        .from(schema.employeeLoans)
        .innerJoin(schema.employees, eq(schema.employees.id, schema.employeeLoans.employeeId))
        .where(
          and(
            eq(schema.employeeLoans.tenantId, ctx.tenantId),
            eq(schema.employeeLoans.id, req.params.id),
            isNull(schema.employeeLoans.deletedAt),
          ),
        )
        .limit(1);
      const row = loanRows[0];
      if (!row) return null;

      const schedule = await tx
        .select()
        .from(schema.employeeLoanSchedule)
        .where(
          and(
            eq(schema.employeeLoanSchedule.tenantId, ctx.tenantId),
            eq(schema.employeeLoanSchedule.loanId, row.loan.id),
          ),
        )
        .orderBy(asc(schema.employeeLoanSchedule.installmentNo));

      return {
        loan: {
          ...row.loan,
          employeeName: row.employeeName,
          employeeCode: row.employeeCode,
        },
        schedule,
      };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // GET /employee-loans/by-employee/:employeeId — per-employee list
  fastify.get<{ Params: { employeeId: string } }>(
    "/by-employee/:employeeId",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const rows = await withTenant(ctx.tenantId, async (tx) =>
        tx
          .select()
          .from(schema.employeeLoans)
          .where(
            and(
              eq(schema.employeeLoans.tenantId, ctx.tenantId),
              eq(schema.employeeLoans.employeeId, req.params.employeeId),
              isNull(schema.employeeLoans.deletedAt),
            ),
          )
          .orderBy(desc(schema.employeeLoans.appliedAt)),
      );
      return reply.send({ loans: rows });
    },
  );

  // POST /employee-loans/apply
  fastify.post("/apply", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ApplySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Guard employee
      const [emp] = await tx
        .select()
        .from(schema.employees)
        .where(
          and(
            eq(schema.employees.tenantId, ctx.tenantId),
            eq(schema.employees.id, d.employeeId),
            isNull(schema.employees.deletedAt),
          ),
        )
        .limit(1);
      if (!emp) return { error: "EMPLOYEE_NOT_FOUND" as const };
      if (["resigned", "terminated", "retired", "deceased"].includes(emp.status)) {
        return { error: "EMPLOYEE_INACTIVE" as const };
      }

      let loanType: typeof schema.loanTypes.$inferSelect | null = null;
      if (d.loanTypeId) {
        const [lt] = await tx
          .select()
          .from(schema.loanTypes)
          .where(
            and(
              eq(schema.loanTypes.tenantId, ctx.tenantId),
              eq(schema.loanTypes.id, d.loanTypeId),
              isNull(schema.loanTypes.deletedAt),
            ),
          )
          .limit(1);
        if (!lt) return { error: "LOAN_TYPE_NOT_FOUND" as const };
        if (!lt.isActive) return { error: "LOAN_TYPE_INACTIVE" as const };
        loanType = lt;
        // Cap checks
        if (lt.maxAmountCents != null && d.principalCents > lt.maxAmountCents) {
          return { error: "PRINCIPAL_EXCEEDS_CAP" as const, cap: lt.maxAmountCents };
        }
        if (d.tenureMonths > lt.maxTenureMonths) {
          return { error: "TENURE_EXCEEDS_CAP" as const, cap: lt.maxTenureMonths };
        }
      }

      const [loan] = await tx
        .insert(schema.employeeLoans)
        .values({
          tenantId: ctx.tenantId,
          employeeId: emp.id,
          loanTypeId: loanType?.id ?? null,
          loanTypeName: loanType?.name ?? null,
          principalCents: d.principalCents,
          interestRateBps: d.interestRateBps,
          tenureMonths: d.tenureMonths,
          firstInstallmentDate: d.firstInstallmentDate ?? null,
          applicationReason: d.applicationReason || null,
          notes: d.notes || null,
          createdByUserId: ctx.userId,
        })
        .returning();

      return { ok: true as const, loan };
    });

    if ("error" in result) {
      let status = 500;
      switch (result.error) {
        case "EMPLOYEE_NOT_FOUND": status = 404; break;
        case "LOAN_TYPE_NOT_FOUND": status = 404; break;
        case "EMPLOYEE_INACTIVE":
        case "LOAN_TYPE_INACTIVE":
        case "PRINCIPAL_EXCEEDS_CAP":
        case "TENURE_EXCEEDS_CAP":
          status = 400; break;
      }
      return reply.status(status).send({ error: result });
    }
    return reply.status(201).send({ loan: result.loan });
  });

  // POST /employee-loans/:id/approve
  fastify.post<{ Params: { id: string } }>("/:id/approve", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [loan] = await tx
        .select()
        .from(schema.employeeLoans)
        .where(
          and(
            eq(schema.employeeLoans.tenantId, ctx.tenantId),
            eq(schema.employeeLoans.id, req.params.id),
            isNull(schema.employeeLoans.deletedAt),
          ),
        )
        .limit(1);
      if (!loan) return { error: "NOT_FOUND" as const };
      if (loan.status !== "draft") return { error: "NOT_DRAFT" as const };
      if (loan.createdByUserId && loan.createdByUserId === ctx.userId) {
        return { error: "SELF_APPROVAL" as const };
      }

      const [updated] = await tx
        .update(schema.employeeLoans)
        .set({
          status: "approved",
          approvedAt: new Date(),
          approvedByUserId: ctx.userId,
          approvalNotes: d.approvalNotes || loan.approvalNotes,
          updatedAt: new Date(),
        })
        .where(eq(schema.employeeLoans.id, loan.id))
        .returning();
      return { ok: true as const, loan: updated };
    });

    if ("error" in result) {
      let status = 500;
      let message = "";
      switch (result.error) {
        case "NOT_FOUND":
          status = 404; message = "Loan not found."; break;
        case "NOT_DRAFT":
          status = 409; message = "Loan is not in draft status."; break;
        case "SELF_APPROVAL":
          status = 403;
          message = "An applicant can't approve their own loan. Ask another admin to approve.";
          break;
      }
      return reply.status(status).send({ error: { code: result.error, message } });
    }
    return reply.send({ loan: result.loan });
  });

  // POST /employee-loans/:id/disburse
  fastify.post<{ Params: { id: string } }>("/:id/disburse", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = DisburseSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    try {
      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [loan] = await tx
          .select()
          .from(schema.employeeLoans)
          .where(
            and(
              eq(schema.employeeLoans.tenantId, ctx.tenantId),
              eq(schema.employeeLoans.id, req.params.id),
              isNull(schema.employeeLoans.deletedAt),
            ),
          )
          .limit(1);
        if (!loan) return { error: "NOT_FOUND" as const };
        if (loan.status !== "approved") return { error: "NOT_APPROVED" as const };

        // Resolve CoA accounts
        const coaRows = await tx
          .select()
          .from(schema.chartOfAccounts)
          .where(
            and(
              eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
              isNull(schema.chartOfAccounts.deletedAt),
            ),
          );
        const loansReceivable = coaRows.find(
          (r) => r.accountSubtype === "loans_receivable",
        );
        if (!loansReceivable) return { error: "MISSING_LOAN_ACCOUNT" as const };

        const bank = coaRows.find((r) => r.id === d.disbursementAccountId);
        if (!bank) return { error: "INVALID_BANK_ACCOUNT" as const };
        if (!["bank", "cash"].includes(bank.accountSubtype ?? "")) {
          return { error: "INVALID_BANK_ACCOUNT" as const };
        }

        const firstDueISO =
          d.firstInstallmentDate ?? loan.firstInstallmentDate ?? (() => {
            // Default: first of the month after disbursement
            const [y, m] = d.disbursementDate.split("-").map(Number);
            const nm = new Date(Date.UTC(y ?? 2026, (m ?? 1), 1));
            return nm.toISOString().slice(0, 10);
          })();

        const { emiCents, totalInterestCents, rows } = buildSchedule(
          loan.principalCents,
          loan.interestRateBps,
          loan.tenureMonths,
          firstDueISO,
        );

        // Allocate loan number
        const numberRows = (await tx.execute(
          sql`SELECT next_document_number('staff_loan') AS number`,
        )) as unknown as Array<{ number: string }>;
        const loanNumber = numberRows[0]?.number;
        if (!loanNumber) throw new Error("Loan number allocation failed");

        // Post disbursement JE (principal only — interest recognised as EMIs land)
        const { entryId } = await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: d.disbursementDate,
          memo: `Loan disbursement · ${loanNumber}`,
          sourceType: "employee_loan",
          sourceId: loan.id,
          postedByUserId: ctx.userId,
          lines: [
            {
              accountId: loansReceivable.id,
              drCents: loan.principalCents,
              description: `Loan to ${loan.employeeId} · ${loanNumber}`,
            },
            {
              accountId: bank.id,
              crCents: loan.principalCents,
              description: `Disbursement · ${loanNumber}`,
            },
          ],
        });

        // Insert schedule
        for (const r of rows) {
          await tx.insert(schema.employeeLoanSchedule).values({
            tenantId: ctx.tenantId,
            loanId: loan.id,
            installmentNo: r.installmentNo,
            dueDate: r.dueDate,
            principalCents: r.principalCents,
            interestCents: r.interestCents,
            totalCents: r.totalCents,
            openingBalanceCents: r.openingBalanceCents,
            closingBalanceCents: r.closingBalanceCents,
          });
        }

        // Update loan header
        const [updated] = await tx
          .update(schema.employeeLoans)
          .set({
            status: "disbursed",
            loanNumber,
            disbursedAt: new Date(),
            disbursedByUserId: ctx.userId,
            disbursementDate: d.disbursementDate,
            disbursementAccountId: bank.id,
            disbursementJournalId: entryId,
            firstInstallmentDate: firstDueISO,
            emiCents,
            totalInterestCents,
            principalOutstandingCents: loan.principalCents,
            interestOutstandingCents: totalInterestCents,
            updatedAt: new Date(),
          })
          .where(eq(schema.employeeLoans.id, loan.id))
          .returning();

        return { ok: true as const, loan: updated, loanNumber };
      });

      if ("error" in result) {
        let status = 500;
        let message = "";
        switch (result.error) {
          case "NOT_FOUND":
            status = 404; message = "Loan not found."; break;
          case "NOT_APPROVED":
            status = 409; message = "Loan must be approved before disbursement."; break;
          case "INVALID_BANK_ACCOUNT":
            status = 400; message = "Pick a Bank or Cash account for the disbursement."; break;
          case "MISSING_LOAN_ACCOUNT":
            status = 500;
            message = "Chart of accounts is missing 'Employee loans receivable' (1150). Re-seed defaults.";
            break;
        }
        return reply.status(status).send({ error: { code: result.error, message } });
      }
      return reply.send(result);
    } catch (err) {
      const e = err as Error & { code?: string; periodStatus?: string };
      if (e.code === "PERIOD_LOCKED") {
        return reply.status(423).send({
          error: {
            code: "PERIOD_LOCKED",
            message: e.message,
            periodStatus: e.periodStatus,
          },
        });
      }
      throw err;
    }
  });

  // POST /employee-loans/:id/cancel — only pre-disbursement
  fastify.post<{ Params: { id: string } }>("/:id/cancel", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CancelSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [loan] = await tx
        .select()
        .from(schema.employeeLoans)
        .where(
          and(
            eq(schema.employeeLoans.tenantId, ctx.tenantId),
            eq(schema.employeeLoans.id, req.params.id),
            isNull(schema.employeeLoans.deletedAt),
          ),
        )
        .limit(1);
      if (!loan) return { error: "NOT_FOUND" as const };
      if (loan.status !== "draft" && loan.status !== "approved") {
        return { error: "NOT_CANCELLABLE" as const };
      }

      const [updated] = await tx
        .update(schema.employeeLoans)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledReason: d.reason || null,
          updatedAt: new Date(),
        })
        .where(eq(schema.employeeLoans.id, loan.id))
        .returning();
      return { ok: true as const, loan: updated };
    });

    if ("error" in result) {
      let status = 500;
      let message = "";
      switch (result.error) {
        case "NOT_FOUND":
          status = 404; message = "Loan not found."; break;
        case "NOT_CANCELLABLE":
          status = 409;
          message = "Disbursed loans can't be cancelled — use write-off instead.";
          break;
      }
      return reply.status(status).send({ error: { code: result.error, message } });
    }
    return reply.send({ loan: result.loan });
  });

  // POST /employee-loans/:id/write-off — forgive the outstanding balance
  fastify.post<{ Params: { id: string } }>("/:id/write-off", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = WriteOffSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    try {
      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [loan] = await tx
          .select()
          .from(schema.employeeLoans)
          .where(
            and(
              eq(schema.employeeLoans.tenantId, ctx.tenantId),
              eq(schema.employeeLoans.id, req.params.id),
              isNull(schema.employeeLoans.deletedAt),
            ),
          )
          .limit(1);
        if (!loan) return { error: "NOT_FOUND" as const };
        if (loan.status !== "disbursed") return { error: "NOT_WRITABLE" as const };
        if (loan.principalOutstandingCents <= 0) return { error: "ALREADY_CLEARED" as const };

        const coaRows = await tx
          .select()
          .from(schema.chartOfAccounts)
          .where(
            and(
              eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
              isNull(schema.chartOfAccounts.deletedAt),
            ),
          );
        const loansReceivable = coaRows.find((r) => r.accountSubtype === "loans_receivable");
        const badDebt = coaRows.find(
          (r) => r.accountSubtype === "bad_debt" || r.accountSubtype === "other",
        );
        if (!loansReceivable || !badDebt) return { error: "MISSING_ACCOUNT" as const };

        const writeOffAmount = loan.principalOutstandingCents;
        await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: new Date().toISOString().slice(0, 10),
          memo: `Loan write-off · ${loan.loanNumber ?? loan.id}`,
          sourceType: "employee_loan",
          sourceId: loan.id,
          postedByUserId: ctx.userId,
          lines: [
            { accountId: badDebt.id, drCents: writeOffAmount, description: d.reason },
            { accountId: loansReceivable.id, crCents: writeOffAmount, description: d.reason },
          ],
        });

        // Waive pending schedule rows so they don't get claimed by a future run
        await tx
          .update(schema.employeeLoanSchedule)
          .set({ status: "waived", waivedReason: d.reason })
          .where(
            and(
              eq(schema.employeeLoanSchedule.tenantId, ctx.tenantId),
              eq(schema.employeeLoanSchedule.loanId, loan.id),
              eq(schema.employeeLoanSchedule.status, "pending"),
            ),
          );

        const [updated] = await tx
          .update(schema.employeeLoans)
          .set({
            status: "written_off",
            closedAt: new Date(),
            closedReason: "written_off",
            writtenOffCents: writeOffAmount,
            principalOutstandingCents: 0,
            interestOutstandingCents: 0,
            notes: loan.notes ? `${loan.notes}\nWrite-off: ${d.reason}` : `Write-off: ${d.reason}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.employeeLoans.id, loan.id))
          .returning();
        return { ok: true as const, loan: updated };
      });

      if ("error" in result) {
        let status = 500;
        switch (result.error) {
          case "NOT_FOUND": status = 404; break;
          case "NOT_WRITABLE":
          case "ALREADY_CLEARED": status = 409; break;
          case "MISSING_ACCOUNT": status = 500; break;
        }
        return reply.status(status).send({ error: { code: result.error } });
      }
      return reply.send({ loan: result.loan });
    } catch (err) {
      const e = err as Error & { code?: string; periodStatus?: string };
      if (e.code === "PERIOD_LOCKED") {
        return reply.status(423).send({
          error: { code: "PERIOD_LOCKED", message: e.message, periodStatus: e.periodStatus },
        });
      }
      throw err;
    }
  });
};
