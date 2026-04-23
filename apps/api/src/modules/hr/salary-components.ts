import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, asc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";

const KINDS = ["earning", "deduction"] as const;
const BASES = ["fixed", "percent_of_basic", "from_employee_basic"] as const;

const CreateComponentSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, digits, or underscore"),
  name: z.string().trim().min(1).max(128),
  kind: z.enum(KINDS),
  calculationBasis: z.enum(BASES).default("fixed"),
  defaultAmountCents: z.number().int().min(0).default(0),
  defaultPercentBps: z.number().int().min(0).max(1_000_000).default(0),
  countsForEpf: z.boolean().default(true),
  countsForEtf: z.boolean().default(true),
  countsForPaye: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(500),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

const UpdateComponentSchema = CreateComponentSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const UpsertEmployeeComponentSchema = z.object({
  componentId: z.string().uuid(),
  amountCents: z.number().int().min(0).default(0),
  percentBps: z.number().int().min(0).max(1_000_000).default(0),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export const salaryComponentsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /salary-components — list the tenant library
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.salaryComponents)
        .where(
          and(
            eq(schema.salaryComponents.tenantId, ctx.tenantId),
            isNull(schema.salaryComponents.deletedAt),
          ),
        )
        .orderBy(asc(schema.salaryComponents.sortOrder), asc(schema.salaryComponents.code)),
    );
    return reply.send({ components: rows });
  });

  // POST /salary-components — add a tenant-specific component
  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "hr.manage");
    if (!ctx) return;

    const parsed = CreateComponentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    try {
      const [row] = await withTenant(ctx.tenantId, async (tx) =>
        tx
          .insert(schema.salaryComponents)
          .values({
            tenantId: ctx.tenantId,
            code: input.code,
            name: input.name,
            kind: input.kind,
            calculationBasis: input.calculationBasis,
            defaultAmountCents: input.defaultAmountCents,
            defaultPercentBps: input.defaultPercentBps,
            countsForEpf: input.countsForEpf,
            countsForEtf: input.countsForEtf,
            countsForPaye: input.countsForPaye,
            sortOrder: input.sortOrder,
            notes: input.notes || null,
            isSystem: false,
          })
          .returning(),
      );
      return reply.status(201).send({ component: row });
    } catch (err) {
      if (err instanceof Error && err.message.includes("salary_components_tenant_code_unique")) {
        return reply
          .status(409)
          .send({ error: { code: "DUPLICATE_CODE", message: "A component with this code already exists." } });
      }
      throw err;
    }
  });

  // PATCH /salary-components/:id — edit name/flags/default amount
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "hr.manage");
    if (!ctx) return;

    const parsed = UpdateComponentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx
        .select()
        .from(schema.salaryComponents)
        .where(
          and(
            eq(schema.salaryComponents.tenantId, ctx.tenantId),
            eq(schema.salaryComponents.id, req.params.id),
            isNull(schema.salaryComponents.deletedAt),
          ),
        )
        .limit(1);
      const row = existing[0];
      if (!row) return { error: "NOT_FOUND" as const };
      // System rows (Basic/BRA/…) can have their amount/flags edited but the
      // code, kind, and basis are locked — those change the meaning.
      if (row.isSystem && (input.code || input.kind || input.calculationBasis)) {
        return { error: "SYSTEM_LOCKED" as const };
      }

      const [updated] = await tx
        .update(schema.salaryComponents)
        .set({
          ...(input.code ? { code: input.code } : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.calculationBasis ? { calculationBasis: input.calculationBasis } : {}),
          ...(input.defaultAmountCents !== undefined ? { defaultAmountCents: input.defaultAmountCents } : {}),
          ...(input.defaultPercentBps !== undefined ? { defaultPercentBps: input.defaultPercentBps } : {}),
          ...(input.countsForEpf !== undefined ? { countsForEpf: input.countsForEpf } : {}),
          ...(input.countsForEtf !== undefined ? { countsForEtf: input.countsForEtf } : {}),
          ...(input.countsForPaye !== undefined ? { countsForPaye: input.countsForPaye } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.salaryComponents.id, row.id))
        .returning();
      return { ok: true as const, component: updated };
    });

    if ("error" in result) {
      const map: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Component not found." },
        SYSTEM_LOCKED: {
          status: 409,
          message: "System components can only have their name/amount/flags edited.",
        },
      };
      const e = map[result.error];
      return reply.status(e.status).send({ error: { code: result.error, message: e.message } });
    }
    return reply.send(result);
  });

  // DELETE /salary-components/:id — soft-delete (only non-system)
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "hr.manage");
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx
        .select()
        .from(schema.salaryComponents)
        .where(
          and(
            eq(schema.salaryComponents.tenantId, ctx.tenantId),
            eq(schema.salaryComponents.id, req.params.id),
            isNull(schema.salaryComponents.deletedAt),
          ),
        )
        .limit(1);
      const row = existing[0];
      if (!row) return { error: "NOT_FOUND" as const };
      if (row.isSystem) return { error: "SYSTEM_LOCKED" as const };

      // If any employee currently references this component, soft-delete.
      await tx
        .update(schema.salaryComponents)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(eq(schema.salaryComponents.id, row.id));
      return { ok: true as const };
    });

    if ("error" in result) {
      const map: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Component not found." },
        SYSTEM_LOCKED: {
          status: 409,
          message: "System components can't be deleted — deactivate instead.",
        },
      };
      const e = map[result.error];
      return reply.status(e.status).send({ error: { code: result.error, message: e.message } });
    }
    return reply.send(result);
  });
};

// ------------------------------------------------------------------------------
// Employee salary structure routes — nested under /employees/:id/salary-structure
// ------------------------------------------------------------------------------
export const employeeSalaryStructureRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /employees/:id/salary-structure — current structure (open-ended rows)
  fastify.get<{ Params: { id: string } }>("/:id/salary-structure", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const empRows = await tx
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
      const employee = empRows[0];
      if (!employee) return null;

      const current = await tx
        .select({
          id: schema.employeeSalaryComponents.id,
          componentId: schema.employeeSalaryComponents.componentId,
          amountCents: schema.employeeSalaryComponents.amountCents,
          percentBps: schema.employeeSalaryComponents.percentBps,
          effectiveFrom: schema.employeeSalaryComponents.effectiveFrom,
          notes: schema.employeeSalaryComponents.notes,
          code: schema.salaryComponents.code,
          name: schema.salaryComponents.name,
          kind: schema.salaryComponents.kind,
          calculationBasis: schema.salaryComponents.calculationBasis,
          countsForEpf: schema.salaryComponents.countsForEpf,
          countsForEtf: schema.salaryComponents.countsForEtf,
          countsForPaye: schema.salaryComponents.countsForPaye,
          sortOrder: schema.salaryComponents.sortOrder,
        })
        .from(schema.employeeSalaryComponents)
        .innerJoin(
          schema.salaryComponents,
          eq(schema.salaryComponents.id, schema.employeeSalaryComponents.componentId),
        )
        .where(
          and(
            eq(schema.employeeSalaryComponents.tenantId, ctx.tenantId),
            eq(schema.employeeSalaryComponents.employeeId, employee.id),
            isNull(schema.employeeSalaryComponents.effectiveTo),
            isNull(schema.employeeSalaryComponents.deletedAt),
          ),
        )
        .orderBy(asc(schema.salaryComponents.sortOrder), asc(schema.salaryComponents.code));

      return { employee, structure: current };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // PUT /employees/:id/salary-structure — replace the open-ended structure.
  // Body: { effectiveFrom, items: [{ componentId, amountCents, percentBps? }] }
  // Closes out existing open-ended assignments (effective_to = effectiveFrom-1)
  // and inserts the new ones. Atomic.
  const PutStructureSchema = z.object({
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    items: z.array(UpsertEmployeeComponentSchema.omit({ effectiveFrom: true })),
  });
  fastify.put<{ Params: { id: string } }>("/:id/salary-structure", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "hr.manage");
    if (!ctx) return;

    const parsed = PutStructureSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { effectiveFrom, items } = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const empRows = await tx
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
      const employee = empRows[0];
      if (!employee) return { error: "NOT_FOUND" as const };

      // Verify components belong to this tenant and are active+not-deleted
      const compIds = items.map((i) => i.componentId);
      if (compIds.length) {
        const comps = await tx
          .select({ id: schema.salaryComponents.id })
          .from(schema.salaryComponents)
          .where(
            and(
              eq(schema.salaryComponents.tenantId, ctx.tenantId),
              isNull(schema.salaryComponents.deletedAt),
              eq(schema.salaryComponents.isActive, true),
              inArray(schema.salaryComponents.id, compIds),
            ),
          );
        if (comps.length !== new Set(compIds).size) {
          return { error: "INVALID_COMPONENT" as const };
        }
      }

      // Close out every open-ended row (effective_to = effectiveFrom − 1 day)
      await tx.execute(sql`
        UPDATE employee_salary_components
        SET effective_to = (${effectiveFrom}::date - interval '1 day')::date,
            updated_at = now()
        WHERE tenant_id = ${ctx.tenantId}::uuid
          AND employee_id = ${employee.id}::uuid
          AND effective_to IS NULL
          AND deleted_at IS NULL
      `);

      // Insert new ones
      for (const it of items) {
        await tx.insert(schema.employeeSalaryComponents).values({
          tenantId: ctx.tenantId,
          employeeId: employee.id,
          componentId: it.componentId,
          amountCents: it.amountCents,
          percentBps: it.percentBps ?? 0,
          effectiveFrom,
          notes: it.notes || null,
          createdByUserId: ctx.userId,
        });
      }

      return { ok: true as const, count: items.length };
    });

    if ("error" in result) {
      const map: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Employee not found." },
        INVALID_COMPONENT: { status: 400, message: "One or more components don't exist or are inactive." },
      };
      const e = map[result.error];
      return reply.status(e.status).send({ error: { code: result.error, message: e.message } });
    }
    return reply.send(result);
  });
};
