import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// SL NIC: old 10-char (9 digits + V|X) or new 12-digit
const NIC_REGEX = /^(?:\d{9}[VvXx]|\d{12})$/;

const EMPLOYMENT_TYPES = ["permanent", "contract", "casual", "probation", "intern", "consultant"] as const;
const WAGE_TYPES = ["monthly", "daily", "hourly", "piece", "commission"] as const;
const GENDERS = ["male", "female", "other", "prefer_not_say"] as const;
const STATUSES = [
  "active",
  "on_probation",
  "confirmed",
  "suspended",
  "resigned",
  "terminated",
  "retired",
  "deceased",
] as const;

const CreateSchema = z.object({
  employeeCode: z.string().trim().max(32).optional().or(z.literal("")),
  firstName: z.string().trim().min(1).max(128),
  lastName: z.string().trim().min(1).max(128),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.enum(GENDERS).optional(),
  personalEmail: z.string().email().max(255).optional().or(z.literal("")),
  mobilePhone: z.string().trim().max(32).optional().or(z.literal("")),
  whatsapp: z.string().trim().max(32).optional().or(z.literal("")),
  addressLine1: z.string().trim().max(255).optional().or(z.literal("")),
  city: z.string().trim().max(128).optional().or(z.literal("")),
  postalCode: z.string().trim().max(16).optional().or(z.literal("")),
  nic: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || NIC_REGEX.test(v), {
      message: "NIC must be old 10-char (9 digits + V/X) or new 12-digit format",
    }),
  epfNumber: z.string().trim().max(30).optional().or(z.literal("")),
  etfNumber: z.string().trim().max(30).optional().or(z.literal("")),
  tin: z.string().trim().max(32).optional().or(z.literal("")),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("permanent"),
  designation: z.string().trim().max(128).optional().or(z.literal("")),
  department: z.string().trim().max(128).optional().or(z.literal("")),
  branchId: z.string().uuid().optional(),
  wageType: z.enum(WAGE_TYPES).default("monthly"),
  basicSalaryCents: z.number().int().min(0).default(0),
  epfEligible: z.boolean().default(true),
  etfEligible: z.boolean().default(true),
  payeApplicable: z.boolean().default(true),
  bankName: z.string().trim().max(128).optional().or(z.literal("")),
  bankAccountNo: z.string().trim().max(64).optional().or(z.literal("")),
  bankBranch: z.string().trim().max(128).optional().or(z.literal("")),
  status: z.enum(STATUSES).default("active"),
  notes: z.string().optional().or(z.literal("")),
});

export const employeesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /employees — list
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const q = typeof req.query === "object" && req.query
      ? (req.query as { q?: string }).q?.trim()
      : undefined;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const whereClauses = [
        eq(schema.employees.tenantId, ctx.tenantId),
        isNull(schema.employees.deletedAt),
      ];
      if (q) whereClauses.push(ilike(schema.employees.fullName, `%${q}%`));

      return tx
        .select({
          id: schema.employees.id,
          employeeCode: schema.employees.employeeCode,
          firstName: schema.employees.firstName,
          lastName: schema.employees.lastName,
          fullName: schema.employees.fullName,
          designation: schema.employees.designation,
          department: schema.employees.department,
          hireDate: schema.employees.hireDate,
          employmentType: schema.employees.employmentType,
          status: schema.employees.status,
          nic: schema.employees.nic,
          personalEmail: schema.employees.personalEmail,
          mobilePhone: schema.employees.mobilePhone,
          basicSalaryCents: schema.employees.basicSalaryCents,
          currency: schema.employees.currency,
          epfEligible: schema.employees.epfEligible,
          etfEligible: schema.employees.etfEligible,
          payeApplicable: schema.employees.payeApplicable,
        })
        .from(schema.employees)
        .where(and(...whereClauses))
        .orderBy(desc(schema.employees.createdAt))
        .limit(500);
    });

    return reply.send({ employees: rows });
  });

  // GET /employees/:id — detail
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.employees)
        .where(
          and(
            eq(schema.employees.tenantId, ctx.tenantId),
            eq(schema.employees.id, req.params.id),
            isNull(schema.employees.deletedAt),
          ),
        )
        .limit(1),
    );
    const employee = rows[0];
    if (!employee) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ employee });
  });

  // POST /employees — create
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    try {
      const employee = await withTenant(ctx.tenantId, async (tx) => {
        const [e] = await tx
          .insert(schema.employees)
          .values({
            tenantId: ctx.tenantId,
            employeeCode: d.employeeCode || null,
            firstName: d.firstName,
            lastName: d.lastName,
            dateOfBirth: d.dateOfBirth ?? null,
            gender: d.gender ?? null,
            personalEmail: d.personalEmail || null,
            mobilePhone: d.mobilePhone || null,
            whatsapp: d.whatsapp || null,
            addressLine1: d.addressLine1 || null,
            city: d.city || null,
            postalCode: d.postalCode || null,
            nic: d.nic ? d.nic.toUpperCase() : null,
            epfNumber: d.epfNumber || null,
            etfNumber: d.etfNumber || null,
            tin: d.tin || null,
            hireDate: d.hireDate,
            employmentType: d.employmentType,
            designation: d.designation || null,
            department: d.department || null,
            branchId: d.branchId ?? null,
            wageType: d.wageType,
            basicSalaryCents: d.basicSalaryCents,
            epfEligible: d.epfEligible,
            etfEligible: d.etfEligible,
            payeApplicable: d.payeApplicable,
            bankName: d.bankName || null,
            bankAccountNo: d.bankAccountNo || null,
            bankBranch: d.bankBranch || null,
            status: d.status,
            notes: d.notes || null,
            createdByUserId: ctx.userId,
          })
          .returning();
        return e;
      });
      return reply.status(201).send({ employee });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("employees_tenant_code_unique")) {
        return reply.status(409).send({
          error: { code: "DUPLICATE_CODE", message: "An employee with this code already exists." },
        });
      }
      if (msg.includes("employees_tenant_nic_unique")) {
        return reply.status(409).send({
          error: { code: "DUPLICATE_NIC", message: "An employee with this NIC already exists." },
        });
      }
      throw err;
    }
  });

  // POST /employees/:id/exit — kick off the exit workflow
  //
  // Mid-period leavers per payroll-module-spec §14.2. Sets exit_date and the
  // terminal status (resigned / terminated / retired / deceased). The next
  // payroll run will include them for work done up to last_working_day,
  // pro-rated, then they drop out of future runs because their status is no
  // longer in the eligibility set.
  //
  // This PR does the pro-rata piece only. Full final-settlement worksheet
  // (leave encashment, outstanding-loan recovery in full, notice pay,
  // gratuity) is a follow-up — see roadmap #11 note.
  const ExitSchema = z.object({
    exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    noticePeriodDays: z.number().int().min(0).max(365).optional(),
    statusAfter: z
      .enum(["resigned", "terminated", "retired", "deceased"])
      .default("resigned"),
    reason: z.string().max(1000).optional().or(z.literal("")),
  });
  fastify.post<{ Params: { id: string } }>("/:id/exit", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ExitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;
    const lwd = d.lastWorkingDay ?? d.exitDate;
    if (lwd > d.exitDate) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: "Last working day can't be after the exit date.",
        },
      });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [emp] = await tx
        .select()
        .from(schema.employees)
        .where(
          and(
            eq(schema.employees.tenantId, ctx.tenantId),
            eq(schema.employees.id, req.params.id),
            isNull(schema.employees.deletedAt),
          ),
        )
        .limit(1);
      if (!emp) return { error: "NOT_FOUND" as const };
      if (["resigned", "terminated", "retired", "deceased"].includes(emp.status)) {
        return { error: "ALREADY_EXITED" as const };
      }
      if (lwd < emp.hireDate) {
        return { error: "BEFORE_HIRE" as const };
      }

      const [updated] = await tx
        .update(schema.employees)
        .set({
          status: d.statusAfter,
          exitDate: d.exitDate,
          lastWorkingDay: lwd,
          noticePeriodDays: d.noticePeriodDays ?? emp.noticePeriodDays,
          statusChangedAt: new Date(),
          statusChangeReason: d.reason || `Exit: ${d.statusAfter}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.employees.id, emp.id))
        .returning();
      return { ok: true as const, employee: updated };
    });

    if ("error" in result) {
      let status = 500;
      let message = "";
      switch (result.error) {
        case "NOT_FOUND":
          status = 404; message = "Employee not found."; break;
        case "ALREADY_EXITED":
          status = 409;
          message = "This employee has already been exited.";
          break;
        case "BEFORE_HIRE":
          status = 400;
          message = "Last working day can't be before the hire date.";
          break;
      }
      return reply.status(status).send({ error: { code: result.error, message } });
    }
    return reply.send({ employee: result.employee });
  });

  // POST /employees/:id/confirm-probation — flip on_probation → active
  //
  // Per payroll-module-spec §14.3. Records confirmation_date so future salary-
  // component assignments can key off it ("confirmation bonus from date X"),
  // and parks an audit note on status_change_reason.
  const ConfirmSchema = z.object({
    confirmationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().max(500).optional().or(z.literal("")),
  });
  fastify.post<{ Params: { id: string } }>(
    "/:id/confirm-probation",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const parsed = ConfirmSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }
      const d = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [emp] = await tx
          .select()
          .from(schema.employees)
          .where(
            and(
              eq(schema.employees.tenantId, ctx.tenantId),
              eq(schema.employees.id, req.params.id),
              isNull(schema.employees.deletedAt),
            ),
          )
          .limit(1);
        if (!emp) return { error: "NOT_FOUND" as const };
        if (emp.status !== "on_probation") {
          return { error: "NOT_ON_PROBATION" as const };
        }
        if (d.confirmationDate < emp.hireDate) {
          return { error: "BEFORE_HIRE" as const };
        }

        const [updated] = await tx
          .update(schema.employees)
          .set({
            status: "active",
            confirmationDate: d.confirmationDate,
            statusChangedAt: new Date(),
            statusChangeReason: d.notes || "Probation confirmed",
            updatedAt: new Date(),
          })
          .where(eq(schema.employees.id, emp.id))
          .returning();
        return { ok: true as const, employee: updated };
      });

      if ("error" in result) {
        let status = 500;
        let message = "";
        switch (result.error) {
          case "NOT_FOUND":
            status = 404; message = "Employee not found."; break;
          case "NOT_ON_PROBATION":
            status = 409;
            message = "This employee isn't on probation.";
            break;
          case "BEFORE_HIRE":
            status = 400;
            message = "Confirmation date can't be before the hire date.";
            break;
        }
        return reply.status(status).send({ error: { code: result.error, message } });
      }
      return reply.send({ employee: result.employee });
    },
  );
};
