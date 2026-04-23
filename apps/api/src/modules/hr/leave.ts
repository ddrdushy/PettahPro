import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, asc, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";

// ──────────────────────────────────────────────────────────────────────────────
// Leave types
// ──────────────────────────────────────────────────────────────────────────────

const LeaveTypeCreateSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(128),
  defaultDaysPerYear: z.number().min(0).max(366).default(0),
  isPaid: z.boolean().default(true),
  carryForwardAllowed: z.boolean().default(false),
  maxCarryForwardDays: z.number().min(0).max(366).default(0),
});

const LeaveTypeUpdateSchema = LeaveTypeCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const leaveTypesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /leave-types
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.leaveTypes)
        .where(
          and(
            eq(schema.leaveTypes.tenantId, ctx.tenantId),
            isNull(schema.leaveTypes.deletedAt),
          ),
        )
        .orderBy(asc(schema.leaveTypes.code)),
    );
    return reply.send({ leaveTypes: rows });
  });

  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "hr.manage");
    if (!ctx) return;
    const parsed = LeaveTypeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const b = parsed.data;

    try {
      const [lt] = await withTenant(ctx.tenantId, async (tx) =>
        tx
          .insert(schema.leaveTypes)
          .values({
            tenantId: ctx.tenantId,
            code: b.code,
            name: b.name,
            defaultDaysPerYear: String(b.defaultDaysPerYear),
            isPaid: b.isPaid,
            carryForwardAllowed: b.carryForwardAllowed,
            maxCarryForwardDays: String(b.maxCarryForwardDays),
            isSystem: false,
          })
          .returning(),
      );
      return reply.status(201).send({ leaveType: lt });
    } catch (err) {
      if ((err as Error).message.includes("leave_types_tenant_code_unique")) {
        return reply
          .status(409)
          .send({ error: { code: "DUPLICATE_CODE", message: "A leave type with this code already exists." } });
      }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "hr.manage");
    if (!ctx) return;
    const parsed = LeaveTypeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const b = parsed.data;
    const patch: Partial<typeof schema.leaveTypes.$inferInsert> = { updatedAt: new Date() };
    if (b.code !== undefined) patch.code = b.code;
    if (b.name !== undefined) patch.name = b.name;
    if (b.defaultDaysPerYear !== undefined) patch.defaultDaysPerYear = String(b.defaultDaysPerYear);
    if (b.isPaid !== undefined) patch.isPaid = b.isPaid;
    if (b.carryForwardAllowed !== undefined) patch.carryForwardAllowed = b.carryForwardAllowed;
    if (b.maxCarryForwardDays !== undefined) patch.maxCarryForwardDays = String(b.maxCarryForwardDays);
    if (b.isActive !== undefined) patch.isActive = b.isActive;

    const [lt] = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .update(schema.leaveTypes)
        .set(patch)
        .where(
          and(
            eq(schema.leaveTypes.tenantId, ctx.tenantId),
            eq(schema.leaveTypes.id, req.params.id),
            isNull(schema.leaveTypes.deletedAt),
          ),
        )
        .returning(),
    );
    if (!lt) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ leaveType: lt });
  });
};

// ──────────────────────────────────────────────────────────────────────────────
// Leave balance (per employee, per year)
// ──────────────────────────────────────────────────────────────────────────────

const AllocationUpsertSchema = z.object({
  leaveTypeId: z.string().uuid(),
  periodYear: z.number().int().min(2000).max(2100),
  allocatedDays: z.number().min(0).max(366),
  carriedForwardDays: z.number().min(0).max(366).default(0),
});

export const employeeLeaveRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /employees/:id/leave-balance?year=
  fastify.get<{ Params: { id: string }; Querystring: { year?: string } }>(
    "/:id/leave-balance",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const year = req.query.year
        ? Number(req.query.year)
        : new Date().getFullYear();

      const rows = await withTenant(ctx.tenantId, async (tx) => {
        // Pull every active leave type + left-join the employee's allocation
        // for the given year. Types without an allocation row show 0s.
        return (await tx.execute(sql`
          SELECT
            lt.id            AS leave_type_id,
            lt.code,
            lt.name,
            lt.is_paid,
            lt.default_days_per_year,
            COALESCE(la.allocated_days, 0)        AS allocated_days,
            COALESCE(la.carried_forward_days, 0)  AS carried_forward_days,
            COALESCE(la.used_days, 0)             AS used_days
          FROM leave_types lt
          LEFT JOIN leave_allocations la
            ON la.leave_type_id = lt.id
           AND la.tenant_id     = lt.tenant_id
           AND la.employee_id   = ${req.params.id}::uuid
           AND la.period_year   = ${year}::smallint
          WHERE lt.tenant_id = current_tenant_id()
            AND lt.deleted_at IS NULL
            AND lt.is_active = true
          ORDER BY lt.code
        `)) as unknown as Array<{
          leave_type_id: string;
          code: string;
          name: string;
          is_paid: boolean;
          default_days_per_year: string | number;
          allocated_days: string | number;
          carried_forward_days: string | number;
          used_days: string | number;
        }>;
      });

      const balances = rows.map((r) => {
        const allocated = Number(r.allocated_days);
        const carried = Number(r.carried_forward_days);
        const used = Number(r.used_days);
        return {
          leaveTypeId: r.leave_type_id,
          code: r.code,
          name: r.name,
          isPaid: r.is_paid,
          defaultDaysPerYear: Number(r.default_days_per_year),
          allocatedDays: allocated,
          carriedForwardDays: carried,
          usedDays: used,
          availableDays: allocated + carried - used,
        };
      });

      return reply.send({ year, balances });
    },
  );

  // POST /employees/:id/leave-allocations — upsert per (employee, type, year)
  fastify.post<{ Params: { id: string } }>("/:id/leave-allocations", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "hr.manage");
    if (!ctx) return;
    const parsed = AllocationUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const b = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Verify the employee and leave type belong to the tenant.
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
      if (!emp) return { error: "EMPLOYEE_NOT_FOUND" as const };

      const [lt] = await tx
        .select()
        .from(schema.leaveTypes)
        .where(
          and(
            eq(schema.leaveTypes.tenantId, ctx.tenantId),
            eq(schema.leaveTypes.id, b.leaveTypeId),
            isNull(schema.leaveTypes.deletedAt),
          ),
        )
        .limit(1);
      if (!lt) return { error: "LEAVE_TYPE_NOT_FOUND" as const };

      // Upsert — drizzle via raw SQL to use the existing unique index.
      await tx.execute(sql`
        INSERT INTO leave_allocations
          (tenant_id, employee_id, leave_type_id, period_year,
           allocated_days, carried_forward_days, used_days)
        VALUES (${ctx.tenantId}::uuid, ${emp.id}::uuid, ${lt.id}::uuid, ${b.periodYear}::smallint,
                ${b.allocatedDays}, ${b.carriedForwardDays}, 0)
        ON CONFLICT (tenant_id, employee_id, leave_type_id, period_year)
        DO UPDATE SET
          allocated_days = EXCLUDED.allocated_days,
          carried_forward_days = EXCLUDED.carried_forward_days,
          updated_at = now()
      `);
      return {};
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        EMPLOYEE_NOT_FOUND: "Employee not found.",
        LEAVE_TYPE_NOT_FOUND: "Leave type not found.",
      };
      const code = result.error as string;
      return reply.status(400).send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send({ ok: true });
  });
};

// ──────────────────────────────────────────────────────────────────────────────
// Leave requests — apply → pending → approved/rejected/cancelled
// ──────────────────────────────────────────────────────────────────────────────

const LeaveRequestCreateSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  daysCount: z.number().positive().max(366),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

const RejectSchema = z.object({
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

export const leaveRequestsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /leave-requests?status=&employeeId=
  fastify.get<{ Querystring: { status?: string; employeeId?: string } }>(
    "/",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const rows = await withTenant(ctx.tenantId, async (tx) => {
        const whereClauses = [eq(schema.leaveRequests.tenantId, ctx.tenantId)];
        if (req.query.status) whereClauses.push(eq(schema.leaveRequests.status, req.query.status));
        if (req.query.employeeId)
          whereClauses.push(eq(schema.leaveRequests.employeeId, req.query.employeeId));

        return tx
          .select({
            id: schema.leaveRequests.id,
            requestNumber: schema.leaveRequests.requestNumber,
            status: schema.leaveRequests.status,
            fromDate: schema.leaveRequests.fromDate,
            toDate: schema.leaveRequests.toDate,
            daysCount: schema.leaveRequests.daysCount,
            reason: schema.leaveRequests.reason,
            employeeId: schema.leaveRequests.employeeId,
            employeeName: schema.employees.fullName,
            leaveTypeId: schema.leaveRequests.leaveTypeId,
            leaveTypeCode: schema.leaveTypes.code,
            leaveTypeName: schema.leaveTypes.name,
            submittedAt: schema.leaveRequests.submittedAt,
            createdAt: schema.leaveRequests.createdAt,
          })
          .from(schema.leaveRequests)
          .innerJoin(
            schema.employees,
            eq(schema.employees.id, schema.leaveRequests.employeeId),
          )
          .innerJoin(
            schema.leaveTypes,
            eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId),
          )
          .where(and(...whereClauses))
          .orderBy(desc(schema.leaveRequests.createdAt))
          .limit(200);
      });

      return reply.send({ leaveRequests: rows });
    },
  );

  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(schema.leaveRequests)
        .where(
          and(
            eq(schema.leaveRequests.tenantId, ctx.tenantId),
            eq(schema.leaveRequests.id, req.params.id),
          ),
        )
        .limit(1);
      if (!r) return null;

      const [emp] = await tx
        .select()
        .from(schema.employees)
        .where(
          and(
            eq(schema.employees.tenantId, ctx.tenantId),
            eq(schema.employees.id, r.employeeId),
          ),
        )
        .limit(1);
      const [lt] = await tx
        .select()
        .from(schema.leaveTypes)
        .where(
          and(
            eq(schema.leaveTypes.tenantId, ctx.tenantId),
            eq(schema.leaveTypes.id, r.leaveTypeId),
          ),
        )
        .limit(1);
      return { leaveRequest: r, employee: emp ?? null, leaveType: lt ?? null };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /leave-requests — create draft. Deliberately NOT gated on hr.manage:
  // every employee needs to be able to file their own leave request. Creator
  // authorization (cannot file for someone else) is enforced downstream by
  // matching employee_id against the caller.
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = LeaveRequestCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const b = parsed.data;
    if (b.fromDate > b.toDate) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_DATE_RANGE", message: "From date must be on or before To date." } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [emp] = await tx
        .select()
        .from(schema.employees)
        .where(
          and(
            eq(schema.employees.tenantId, ctx.tenantId),
            eq(schema.employees.id, b.employeeId),
            isNull(schema.employees.deletedAt),
          ),
        )
        .limit(1);
      if (!emp) return { error: "EMPLOYEE_NOT_FOUND" as const };

      const [lt] = await tx
        .select()
        .from(schema.leaveTypes)
        .where(
          and(
            eq(schema.leaveTypes.tenantId, ctx.tenantId),
            eq(schema.leaveTypes.id, b.leaveTypeId),
            isNull(schema.leaveTypes.deletedAt),
            eq(schema.leaveTypes.isActive, true),
          ),
        )
        .limit(1);
      if (!lt) return { error: "LEAVE_TYPE_NOT_FOUND" as const };

      const [req] = await tx
        .insert(schema.leaveRequests)
        .values({
          tenantId: ctx.tenantId,
          employeeId: emp.id,
          leaveTypeId: lt.id,
          fromDate: b.fromDate,
          toDate: b.toDate,
          daysCount: String(b.daysCount),
          reason: b.reason?.trim() || null,
          status: "draft",
          createdByUserId: ctx.userId,
        })
        .returning();
      return { leaveRequest: req };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        EMPLOYEE_NOT_FOUND: "Employee not found.",
        LEAVE_TYPE_NOT_FOUND: "Leave type not found or inactive.",
      };
      const code = result.error as string;
      return reply.status(400).send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.status(201).send(result);
  });

  // POST /leave-requests/:id/submit
  fastify.post<{ Params: { id: string } }>("/:id/submit", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(schema.leaveRequests)
        .where(
          and(
            eq(schema.leaveRequests.tenantId, ctx.tenantId),
            eq(schema.leaveRequests.id, req.params.id),
          ),
        )
        .limit(1);
      if (!r) return { error: "NOT_FOUND" as const };
      if (r.status !== "draft") return { error: "NOT_DRAFT" as const };

      const now = new Date();
      await tx
        .update(schema.leaveRequests)
        .set({ status: "pending", submittedAt: now, updatedAt: now })
        .where(eq(schema.leaveRequests.id, r.id));
      return {};
    });

    if ("error" in result) {
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
    }
    return reply.send({ ok: true });
  });

  // POST /leave-requests/:id/approve — debits allocated balance
  fastify.post<{ Params: { id: string } }>("/:id/approve", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "hr.manage");
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(schema.leaveRequests)
        .where(
          and(
            eq(schema.leaveRequests.tenantId, ctx.tenantId),
            eq(schema.leaveRequests.id, req.params.id),
          ),
        )
        .limit(1);
      if (!r) return { error: "NOT_FOUND" as const };
      if (r.status !== "pending" && r.status !== "draft") return { error: "WRONG_STATUS" as const };

      // Ensure an allocation row exists for this (employee, type, year) so
      // the debit increments `used_days` consistently. Seed from the leave
      // type's default entitlement if the tenant never set it up explicitly.
      const year = yearOf(r.fromDate);
      await tx.execute(sql`
        INSERT INTO leave_allocations
          (tenant_id, employee_id, leave_type_id, period_year,
           allocated_days, carried_forward_days, used_days)
        SELECT ${ctx.tenantId}::uuid, ${r.employeeId}::uuid, ${r.leaveTypeId}::uuid, ${year}::smallint,
               lt.default_days_per_year, 0, 0
        FROM leave_types lt
        WHERE lt.id = ${r.leaveTypeId}::uuid
          AND lt.tenant_id = current_tenant_id()
        ON CONFLICT (tenant_id, employee_id, leave_type_id, period_year) DO NOTHING
      `);

      // Debit used_days by the requested amount.
      await tx.execute(sql`
        UPDATE leave_allocations
        SET used_days = used_days + ${r.daysCount},
            updated_at = now()
        WHERE tenant_id = current_tenant_id()
          AND employee_id = ${r.employeeId}::uuid
          AND leave_type_id = ${r.leaveTypeId}::uuid
          AND period_year = ${year}::smallint
      `);

      const now = new Date();
      await tx
        .update(schema.leaveRequests)
        .set({
          status: "approved",
          approvedAt: now,
          approvedByUserId: ctx.userId,
          updatedAt: now,
        })
        .where(eq(schema.leaveRequests.id, r.id));
      return {};
    });

    if ("error" in result) {
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
    }
    return reply.send({ ok: true });
  });

  // POST /leave-requests/:id/reject
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/:id/reject",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "hr.manage");
      if (!ctx) return;

      const parsed = RejectSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }
      const reason = parsed.data.reason?.trim() || null;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [r] = await tx
          .select()
          .from(schema.leaveRequests)
          .where(
            and(
              eq(schema.leaveRequests.tenantId, ctx.tenantId),
              eq(schema.leaveRequests.id, req.params.id),
            ),
          )
          .limit(1);
        if (!r) return { error: "NOT_FOUND" as const };
        if (r.status === "approved" || r.status === "cancelled") {
          return { error: "WRONG_STATUS" as const };
        }

        const now = new Date();
        await tx
          .update(schema.leaveRequests)
          .set({ status: "rejected", rejectedAt: now, rejectedReason: reason, updatedAt: now })
          .where(eq(schema.leaveRequests.id, r.id));
        return {};
      });

      if ("error" in result) {
        const code = result.error as string;
        return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
      }
      return reply.send({ ok: true });
    },
  );

  // POST /leave-requests/:id/cancel — if approved, refund days to allocation
  fastify.post<{ Params: { id: string } }>("/:id/cancel", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(schema.leaveRequests)
        .where(
          and(
            eq(schema.leaveRequests.tenantId, ctx.tenantId),
            eq(schema.leaveRequests.id, req.params.id),
          ),
        )
        .limit(1);
      if (!r) return { error: "NOT_FOUND" as const };
      if (r.status === "cancelled") return { error: "ALREADY_CANCELLED" as const };

      // If cancelling a previously approved request, refund the days.
      if (r.status === "approved") {
        const year = yearOf(r.fromDate);
        await tx.execute(sql`
          UPDATE leave_allocations
          SET used_days = GREATEST(0, used_days - ${r.daysCount}),
              updated_at = now()
          WHERE tenant_id = current_tenant_id()
            AND employee_id = ${r.employeeId}::uuid
            AND leave_type_id = ${r.leaveTypeId}::uuid
            AND period_year = ${year}::smallint
        `);
      }

      const now = new Date();
      await tx
        .update(schema.leaveRequests)
        .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
        .where(eq(schema.leaveRequests.id, r.id));
      return {};
    });

    if ("error" in result) {
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
    }
    return reply.send({ ok: true });
  });
};
