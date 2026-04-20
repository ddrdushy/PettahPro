import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "../accounting/journal-posting.js";
import { computePayrollLine } from "./sl-tax.js";

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

      return { run, lines };
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
      const eligible = emps.filter(
        (e) =>
          ["active", "confirmed", "on_probation"].includes(e.status) &&
          e.basicSalaryCents > 0,
      );
      if (eligible.length === 0) return { error: "NO_ELIGIBLE_EMPLOYEES" as const };

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

      // Compute each line and persist
      let gross = 0,
        epfEmp = 0,
        epfEr = 0,
        etfEr = 0,
        paye = 0,
        net = 0;

      for (const e of eligible) {
        const c = computePayrollLine({
          basicSalaryCents: e.basicSalaryCents,
          epfEligible: e.epfEligible,
          etfEligible: e.etfEligible,
          payeApplicable: e.payeApplicable,
        });
        await tx.insert(schema.payrollRunLines).values({
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
          basicSalaryCents: e.basicSalaryCents,
          grossCents: c.grossCents,
          epfEmployeeCents: c.epfEmployeeCents,
          payeCents: c.payeCents,
          otherDeductionsCents: 0,
          totalDeductionsCents: c.totalDeductionsCents,
          epfEmployerCents: c.epfEmployerCents,
          etfEmployerCents: c.etfEmployerCents,
          netPayCents: c.netPayCents,
          wasEpfEligible: e.epfEligible,
          wasEtfEligible: e.etfEligible,
          wasPayeApplicable: e.payeApplicable,
          bankName: e.bankName,
          bankAccountNo: e.bankAccountNo,
          bankBranch: e.bankBranch,
        });
        gross += c.grossCents;
        epfEmp += c.epfEmployeeCents;
        epfEr += c.epfEmployerCents;
        etfEr += c.etfEmployerCents;
        paye += c.payeCents;
        net += c.netPayCents;
      }

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
    const ctx = requireAuth(req, reply);
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

      for (const [key, acc] of [
        ["expense:payroll", salaryExpense],
        ["expense:payroll_epf", epfExpense],
        ["expense:payroll_etf", etfExpense],
        ["liability:epf", epfPayable],
        ["liability:etf", etfPayable],
        ["liability:paye", payePayable],
        ["liability:salaries", salariesPayable],
      ] as const) {
        if (!acc) return { error: "MISSING_ACCOUNT" as const, account: key };
      }

      const [{ number: runNumber }] = (await tx.execute(
        sql`SELECT next_document_number('payroll') AS number`,
      )) as unknown as Array<{ number: string }>;

      // Build balanced journal:
      //   DR Salaries & wages              gross
      //   DR EPF employer contribution     epf_employer
      //   DR ETF employer contribution     etf_employer
      //     CR EPF payable                 epf_employee + epf_employer
      //     CR ETF payable                 etf_employer
      //     CR PAYE payable                paye
      //     CR Salaries payable            net
      const journalLines: Parameters<typeof postJournal>[1]["lines"] = [
        {
          accountId: salaryExpense!.id,
          drCents: run.grossCents,
          description: `Payroll ${runNumber} · gross`,
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
};
