import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { resolveAndCheckPeriod } from "../accounting/journal-posting.js";

/**
 * Salary revisions — records a back-dated or forward-dated basic-salary
 * change. The employee's live `basic_salary_cents` is updated immediately;
 * arrears (difference × intervening full months) are auto-computed on the
 * next payroll run and flushed onto it as an ARREARS earning line.
 *
 * Per payroll-module-spec §14.4. Period-lock enforcement piggybacks on the
 * existing `resolveAndCheckPeriod` used at journal-post time — a revision
 * whose effective date lands in a soft-closed / closed period is rejected
 * so users can't rewrite history silently.
 */

const CreateSchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newBasicSalaryCents: z.number().int().min(0),
  reason: z.string().trim().max(255).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

export const salaryRevisionsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /employees/:id/salary-revisions — history (newest effective-date first)
  fastify.get<{ Params: { id: string } }>(
    "/:id/salary-revisions",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const rows = await withTenant(ctx.tenantId, async (tx) => {
        // Guard: employee must belong to tenant & not be deleted
        const [emp] = await tx
          .select({ id: schema.employees.id })
          .from(schema.employees)
          .where(
            and(
              eq(schema.employees.tenantId, ctx.tenantId),
              eq(schema.employees.id, req.params.id),
              isNull(schema.employees.deletedAt),
            ),
          )
          .limit(1);
        if (!emp) return null;

        return tx
          .select()
          .from(schema.employeeSalaryRevisions)
          .where(
            and(
              eq(schema.employeeSalaryRevisions.tenantId, ctx.tenantId),
              eq(schema.employeeSalaryRevisions.employeeId, req.params.id),
            ),
          )
          .orderBy(desc(schema.employeeSalaryRevisions.effectiveDate));
      });

      if (rows === null) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      return reply.send({ revisions: rows });
    },
  );

  // POST /employees/:id/salary-revisions — record a new revision
  fastify.post<{ Params: { id: string } }>(
    "/:id/salary-revisions",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "hr.manage");
      if (!ctx) return;

      const parsed = CreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }
      const d = parsed.data;

      try {
        const result = await withTenant(ctx.tenantId, async (tx) => {
          // Load employee — need current basic salary for `previous_*`
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

          if (d.newBasicSalaryCents === emp.basicSalaryCents) {
            return { error: "UNCHANGED" as const };
          }
          if (d.newBasicSalaryCents < 0) {
            return { error: "INVALID_AMOUNT" as const };
          }

          // Guard: the revision's effective date must land in an open period.
          // Throws PERIOD_LOCKED if not — bubbles out of withTenant.
          await resolveAndCheckPeriod(tx, ctx.tenantId, d.effectiveDate);

          // Also guard against effective_date BEFORE hire date (nonsense).
          if (d.effectiveDate < emp.hireDate) {
            return { error: "BEFORE_HIRE_DATE" as const };
          }

          const [rev] = await tx
            .insert(schema.employeeSalaryRevisions)
            .values({
              tenantId: ctx.tenantId,
              employeeId: emp.id,
              effectiveDate: d.effectiveDate,
              previousBasicSalaryCents: emp.basicSalaryCents,
              newBasicSalaryCents: d.newBasicSalaryCents,
              reason: d.reason || null,
              notes: d.notes || null,
              createdByUserId: ctx.userId,
            })
            .returning();
          if (!rev) throw new Error("Revision insert failed");

          // Live employee row reflects the new rate immediately. Arrears for
          // any months since effective_date get compensated on the next run.
          await tx
            .update(schema.employees)
            .set({
              basicSalaryCents: d.newBasicSalaryCents,
              updatedAt: new Date(),
            })
            .where(eq(schema.employees.id, emp.id));

          return { ok: true as const, revision: rev };
        });

        if ("error" in result) {
          let status = 500;
          let message = "";
          switch (result.error) {
            case "NOT_FOUND":
              status = 404;
              message = "Employee not found.";
              break;
            case "UNCHANGED":
              status = 400;
              message =
                "New salary is the same as current. Record a different amount.";
              break;
            case "INVALID_AMOUNT":
              status = 400;
              message = "Salary cannot be negative.";
              break;
            case "BEFORE_HIRE_DATE":
              status = 400;
              message = "Effective date can't be before the employee's hire date.";
              break;
          }
          return reply
            .status(status)
            .send({ error: { code: result.error, message } });
        }
        return reply.status(201).send({ revision: result.revision });
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
    },
  );
};
