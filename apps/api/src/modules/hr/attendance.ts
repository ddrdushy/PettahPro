// Attendance capture module (roadmap #39).
//
// End-to-end HR attendance: device registry, biometric employee map,
// the daily attendance_records event log, and biometric file imports.
// Four capture methods converge on one (employee, date) record:
//
//   self            — the employee hits /records/check-in from their
//                     browser / phone, optionally with geofence.
//   qr              — wall-mounted kiosk posts /records/check-in with
//                     a device_id (branch kiosk).
//   biometric       — bulk CSV import via POST /imports; each row
//                     resolves via biometric_employee_map.
//   geofence        — self-checkin variant with lat/lng recorded.
//   manual_muster   — supervisor fills a form for an entire branch in
//                     one POST /records/muster call.
//
// Posting invariants — every mutating path:
//
//   1. Upserts on `(tenant, employee_id, attendance_date)` — the
//      partial unique index guarantees one live row per day. Second
//      punch folds into the same row: earliest check_in_at, latest
//      check_out_at.
//   2. Detects method mismatch and flips `has_conflict=true` +
//      `conflict_reason`. Never silently overwrites — the exceptions
//      queue is the supervisor's cue to resolve.
//   3. Recomputes `total_minutes` when both check_in_at and
//      check_out_at are set.
//   4. Writes an audit event through recordAuditEvent.
//
// Permission model — two keys seeded onto Owner / Admin / Accountant:
//   · attendance.operate  — create/update/delete records, mark
//                           muster, run imports, manage devices +
//                           biometric map.
//   · attendance.view     — read-only list + exceptions queue.
//
// Self check-in/out uses the `requireAuth` gate only (any logged-in
// user), since an employee may not have attendance.operate — they
// just need to clock themselves. Everyone else goes through
// requirePermission.

import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { schema, withTenant } from "@pettahpro/db";
import { requirePermission } from "../../lib/permissions.js";
import { requireAuth } from "../../lib/with-tenant.js";
import { recordAuditEvent } from "../../lib/audit.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateDeviceSchema = z.object({
  name: z.string().min(1).max(120),
  deviceType: z.enum(schema.ATTENDANCE_DEVICE_TYPES),
  branchId: z.string().uuid().optional().nullable(),
  exportFormat: z.enum(schema.ATTENDANCE_DEVICE_EXPORT_FORMATS).optional().nullable(),
  columnTemplate: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

const PatchDeviceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  deviceType: z.enum(schema.ATTENDANCE_DEVICE_TYPES).optional(),
  branchId: z.string().uuid().optional().nullable(),
  exportFormat: z.enum(schema.ATTENDANCE_DEVICE_EXPORT_FORMATS).optional().nullable(),
  columnTemplate: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

const ReplaceMapSchema = z.object({
  rows: z.array(
    z.object({
      biometricEmployeeId: z.string().min(1).max(64),
      employeeId: z.string().uuid(),
    }),
  ),
});

const CreateRecordSchema = z.object({
  employeeId: z.string().uuid(),
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().uuid().optional().nullable(),
  checkInAt: z.string().datetime().optional().nullable(),
  checkOutAt: z.string().datetime().optional().nullable(),
  method: z.enum(schema.ATTENDANCE_METHODS),
  status: z.enum(schema.ATTENDANCE_STATUSES).optional(),
  locationLat: z.number().optional().nullable(),
  locationLng: z.number().optional().nullable(),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

const PatchRecordSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  checkInAt: z.string().datetime().optional().nullable(),
  checkOutAt: z.string().datetime().optional().nullable(),
  status: z.enum(schema.ATTENDANCE_STATUSES).optional(),
  hasConflict: z.boolean().optional(),
  conflictReason: z.string().max(500).optional().nullable(),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

const SelfPunchSchema = z.object({
  locationLat: z.number().optional().nullable(),
  locationLng: z.number().optional().nullable(),
  // Fallback when the app hasn't wired `users.employee_id`: the caller
  // tells the API which employee they are. Only honoured for a caller
  // with attendance.operate (see route).
  employeeId: z.string().uuid().optional(),
});

const MusterSchema = z.object({
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().uuid().optional().nullable(),
  employeeIds: z.array(z.string().uuid()).min(1),
  status: z.enum(schema.ATTENDANCE_STATUSES).optional(),
  notes: z.string().max(500).optional().or(z.literal("")),
});

const ImportRowSchema = z.object({
  biometricEmployeeId: z.string().min(1).max(64),
  punchAt: z.string().datetime(),
  direction: z.enum(["in", "out"]).nullable().optional(),
});

const CreateImportSchema = z.object({
  attendanceDeviceId: z.string().uuid(),
  fileName: z.string().min(1),
  fileSizeBytes: z.number().int().min(0).optional(),
  columnTemplate: z.record(z.string(), z.unknown()).optional(),
  rows: z.array(ImportRowSchema),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeTotalMinutes(
  checkInAt: Date | string | null | undefined,
  checkOutAt: Date | string | null | undefined,
): number | null {
  if (!checkInAt || !checkOutAt) return null;
  const inMs = new Date(checkInAt).getTime();
  const outMs = new Date(checkOutAt).getTime();
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs < inMs) return null;
  return Math.round((outMs - inMs) / 60000);
}

function earliest(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined,
): Date | null {
  if (!a && !b) return null;
  if (!a) return b ? new Date(b) : null;
  if (!b) return a ? new Date(a) : null;
  return new Date(a).getTime() <= new Date(b).getTime() ? new Date(a) : new Date(b);
}

function latest(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined,
): Date | null {
  if (!a && !b) return null;
  if (!a) return b ? new Date(b) : null;
  if (!b) return a ? new Date(a) : null;
  return new Date(a).getTime() >= new Date(b).getTime() ? new Date(a) : new Date(b);
}

// Upsert a record on (tenant, employee_id, attendance_date). Returns
// whether the row was created, updated, or produced a conflict (method
// mismatch with an existing row for the same day).
type UpsertOutcome = "created" | "updated" | "conflict";

interface UpsertInput {
  tenantId: string;
  employeeId: string;
  attendanceDate: string;
  branchId?: string | null;
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
  method: (typeof schema.ATTENDANCE_METHODS)[number];
  status?: (typeof schema.ATTENDANCE_STATUSES)[number];
  sourceDeviceId?: string | null;
  supervisorUserId?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  notes?: string | null;
  createdByUserId: string;
}

async function upsertAttendanceRecord(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  input: UpsertInput,
): Promise<{
  outcome: UpsertOutcome;
  record: typeof schema.attendanceRecords.$inferSelect;
}> {
  // Find existing live row for this (employee, date).
  const [existing] = await tx
    .select()
    .from(schema.attendanceRecords)
    .where(
      and(
        eq(schema.attendanceRecords.tenantId, input.tenantId),
        eq(schema.attendanceRecords.employeeId, input.employeeId),
        eq(schema.attendanceRecords.attendanceDate, input.attendanceDate),
        isNull(schema.attendanceRecords.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) {
    const checkInAt = input.checkInAt ?? null;
    const checkOutAt = input.checkOutAt ?? null;
    const [inserted] = await tx
      .insert(schema.attendanceRecords)
      .values({
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        attendanceDate: input.attendanceDate,
        branchId: input.branchId ?? null,
        checkInAt,
        checkOutAt,
        totalMinutes: computeTotalMinutes(checkInAt, checkOutAt),
        method: input.method,
        status: input.status ?? "present",
        sourceDeviceId: input.sourceDeviceId ?? null,
        supervisorUserId: input.supervisorUserId ?? null,
        locationLat:
          input.locationLat != null ? String(input.locationLat) : null,
        locationLng:
          input.locationLng != null ? String(input.locationLng) : null,
        notes: input.notes ?? null,
        createdByUserId: input.createdByUserId,
      })
      .returning();
    if (!inserted) throw new Error("Attendance insert failed");
    return { outcome: "created", record: inserted };
  }

  const newIn = earliest(existing.checkInAt, input.checkInAt);
  const newOut = latest(existing.checkOutAt, input.checkOutAt);
  const methodMismatch = existing.method !== input.method;

  const updateSet: Partial<typeof schema.attendanceRecords.$inferInsert> = {
    checkInAt: newIn,
    checkOutAt: newOut,
    totalMinutes: computeTotalMinutes(newIn, newOut),
    updatedAt: new Date(),
  };
  if (input.branchId !== undefined) updateSet.branchId = input.branchId;
  if (input.status) updateSet.status = input.status;
  if (input.sourceDeviceId !== undefined)
    updateSet.sourceDeviceId = input.sourceDeviceId;
  if (input.supervisorUserId !== undefined)
    updateSet.supervisorUserId = input.supervisorUserId;
  if (input.locationLat !== undefined)
    updateSet.locationLat =
      input.locationLat != null ? String(input.locationLat) : null;
  if (input.locationLng !== undefined)
    updateSet.locationLng =
      input.locationLng != null ? String(input.locationLng) : null;
  if (input.notes !== undefined) updateSet.notes = input.notes;

  if (methodMismatch) {
    updateSet.hasConflict = true;
    updateSet.conflictReason = `Mixed methods for ${input.attendanceDate}: existing=${existing.method}, incoming=${input.method}`;
  }

  const [updated] = await tx
    .update(schema.attendanceRecords)
    .set(updateSet)
    .where(eq(schema.attendanceRecords.id, existing.id))
    .returning();
  if (!updated) throw new Error("Attendance update failed");

  return {
    outcome: methodMismatch ? "conflict" : "updated",
    record: updated,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const attendanceRoutes: FastifyPluginAsync = async (fastify) => {
  // =========================================================================
  // DEVICES
  // =========================================================================

  fastify.get("/devices", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "attendance.view");
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.attendanceDevices)
        .where(
          and(
            eq(schema.attendanceDevices.tenantId, ctx.tenantId),
            isNull(schema.attendanceDevices.deletedAt),
          ),
        )
        .orderBy(asc(schema.attendanceDevices.name)),
    );
    return reply.send({ devices: rows });
  });

  fastify.get<{ Params: { id: string } }>(
    "/devices/:id",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "attendance.view");
      if (!ctx) return;

      const row = await withTenant(ctx.tenantId, async (tx) => {
        const [r] = await tx
          .select()
          .from(schema.attendanceDevices)
          .where(
            and(
              eq(schema.attendanceDevices.tenantId, ctx.tenantId),
              eq(schema.attendanceDevices.id, req.params.id),
              isNull(schema.attendanceDevices.deletedAt),
            ),
          )
          .limit(1);
        return r ?? null;
      });
      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      return reply.send({ device: row });
    },
  );

  fastify.post("/devices", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "attendance.operate");
    if (!ctx) return;

    const parsed = CreateDeviceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const device = await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.attendanceDevices)
        .values({
          tenantId: ctx.tenantId,
          name: input.name,
          deviceType: input.deviceType,
          branchId: input.branchId ?? null,
          exportFormat: input.exportFormat ?? null,
          columnTemplate: input.columnTemplate ?? {},
          notes: input.notes || null,
        })
        .returning();
      if (!row) throw new Error("Device insert failed");
      await recordAuditEvent(tx, {
        kind: "attendance_device.created",
        summary: `Created attendance device "${row.name}"`,
        refType: "attendance_device",
        refId: row.id,
        diff: { deviceType: row.deviceType, branchId: row.branchId },
        actorUserId: ctx.userId,
      });
      return row;
    });
    return reply.status(201).send({ device });
  });

  fastify.patch<{ Params: { id: string } }>(
    "/devices/:id",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "attendance.operate");
      if (!ctx) return;

      const parsed = PatchDeviceSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }
      const input = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.attendanceDevices)
          .where(
            and(
              eq(schema.attendanceDevices.tenantId, ctx.tenantId),
              eq(schema.attendanceDevices.id, req.params.id),
              isNull(schema.attendanceDevices.deletedAt),
            ),
          )
          .limit(1);
        if (!existing) return { error: "NOT_FOUND" as const };

        const updates: Partial<typeof schema.attendanceDevices.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (input.name !== undefined) updates.name = input.name;
        if (input.deviceType !== undefined) updates.deviceType = input.deviceType;
        if (input.branchId !== undefined) updates.branchId = input.branchId;
        if (input.exportFormat !== undefined)
          updates.exportFormat = input.exportFormat;
        if (input.columnTemplate !== undefined)
          updates.columnTemplate = input.columnTemplate;
        if (input.notes !== undefined) updates.notes = input.notes || null;

        const [updated] = await tx
          .update(schema.attendanceDevices)
          .set(updates)
          .where(eq(schema.attendanceDevices.id, existing.id))
          .returning();

        await recordAuditEvent(tx, {
          kind: "attendance_device.updated",
          summary: `Updated attendance device "${existing.name}"`,
          refType: "attendance_device",
          refId: existing.id,
          diff: { before: existing, after: updated },
          actorUserId: ctx.userId,
        });
        return { ok: true as const, device: updated };
      });

      if ("error" in result) {
        return reply.status(404).send({ error: { code: result.error } });
      }
      return reply.send({ device: result.device });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/devices/:id",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "attendance.operate");
      if (!ctx) return;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.attendanceDevices)
          .where(
            and(
              eq(schema.attendanceDevices.tenantId, ctx.tenantId),
              eq(schema.attendanceDevices.id, req.params.id),
              isNull(schema.attendanceDevices.deletedAt),
            ),
          )
          .limit(1);
        if (!existing) return { error: "NOT_FOUND" as const };

        await tx
          .update(schema.attendanceDevices)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.attendanceDevices.id, existing.id));

        await recordAuditEvent(tx, {
          kind: "attendance_device.deleted",
          summary: `Soft-deleted attendance device "${existing.name}"`,
          refType: "attendance_device",
          refId: existing.id,
          diff: null,
          actorUserId: ctx.userId,
        });
        return { ok: true as const };
      });

      if ("error" in result) {
        return reply.status(404).send({ error: { code: result.error } });
      }
      return reply.send({ ok: true });
    },
  );

  // =========================================================================
  // BIOMETRIC EMPLOYEE MAP
  // =========================================================================

  // GET /attendance/devices/:deviceId/map — list mapped rows with
  // employee full name for display.
  fastify.get<{ Params: { deviceId: string } }>(
    "/devices/:deviceId/map",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "attendance.view");
      if (!ctx) return;

      const rows = await withTenant(ctx.tenantId, async (tx) =>
        tx
          .select({
            id: schema.biometricEmployeeMap.id,
            biometricEmployeeId: schema.biometricEmployeeMap.biometricEmployeeId,
            employeeId: schema.biometricEmployeeMap.employeeId,
            employeeFullName: schema.employees.fullName,
            employeeCode: schema.employees.employeeCode,
          })
          .from(schema.biometricEmployeeMap)
          .leftJoin(
            schema.employees,
            eq(schema.employees.id, schema.biometricEmployeeMap.employeeId),
          )
          .where(
            and(
              eq(schema.biometricEmployeeMap.tenantId, ctx.tenantId),
              eq(
                schema.biometricEmployeeMap.attendanceDeviceId,
                req.params.deviceId,
              ),
              isNull(schema.biometricEmployeeMap.deletedAt),
            ),
          )
          .orderBy(asc(schema.biometricEmployeeMap.biometricEmployeeId)),
      );
      return reply.send({ rows });
    },
  );

  // PUT /attendance/devices/:deviceId/map — replace-all. Soft-deletes
  // rows that are no longer present and upserts the new ones.
  fastify.put<{ Params: { deviceId: string } }>(
    "/devices/:deviceId/map",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "attendance.operate");
      if (!ctx) return;

      const parsed = ReplaceMapSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }

      const result = await withTenant(ctx.tenantId, async (tx) => {
        // Verify device exists and is live.
        const [dev] = await tx
          .select()
          .from(schema.attendanceDevices)
          .where(
            and(
              eq(schema.attendanceDevices.tenantId, ctx.tenantId),
              eq(schema.attendanceDevices.id, req.params.deviceId),
              isNull(schema.attendanceDevices.deletedAt),
            ),
          )
          .limit(1);
        if (!dev) return { error: "DEVICE_NOT_FOUND" as const };

        // Hard-delete existing live rows for this device, then insert
        // the new set. Simpler than a diff — the audit event captures
        // the outcome. The DB-level constraint (`deleted_at IS NULL`
        // on the unique index) lets hard-delete coexist with any
        // soft-deleted history the caller may have created manually.
        await tx
          .delete(schema.biometricEmployeeMap)
          .where(
            and(
              eq(schema.biometricEmployeeMap.tenantId, ctx.tenantId),
              eq(
                schema.biometricEmployeeMap.attendanceDeviceId,
                req.params.deviceId,
              ),
            ),
          );

        if (parsed.data.rows.length > 0) {
          await tx.insert(schema.biometricEmployeeMap).values(
            parsed.data.rows.map((r) => ({
              tenantId: ctx.tenantId,
              attendanceDeviceId: req.params.deviceId,
              biometricEmployeeId: r.biometricEmployeeId,
              employeeId: r.employeeId,
            })),
          );
        }

        await recordAuditEvent(tx, {
          kind: "biometric_map.updated",
          summary: `Replaced biometric map for device "${dev.name}" (${parsed.data.rows.length} rows)`,
          refType: "attendance_device",
          refId: dev.id,
          diff: { rowCount: parsed.data.rows.length },
          actorUserId: ctx.userId,
        });
        return { ok: true as const };
      });

      if ("error" in result) {
        return reply.status(404).send({ error: { code: result.error } });
      }
      return reply.send({ ok: true });
    },
  );

  // =========================================================================
  // RECORDS
  // =========================================================================

  // GET /attendance/records — filtered list with employee full name
  // joined for display.
  fastify.get<{
    Querystring: {
      date_from?: string;
      date_to?: string;
      employee_id?: string;
      branch_id?: string;
      status?: string;
      method?: string;
      has_conflict?: string;
    };
  }>("/records", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "attendance.view");
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const conds = [
        eq(schema.attendanceRecords.tenantId, ctx.tenantId),
        isNull(schema.attendanceRecords.deletedAt),
      ];
      if (req.query.date_from) {
        conds.push(gte(schema.attendanceRecords.attendanceDate, req.query.date_from));
      }
      if (req.query.date_to) {
        conds.push(lte(schema.attendanceRecords.attendanceDate, req.query.date_to));
      }
      if (req.query.employee_id) {
        conds.push(eq(schema.attendanceRecords.employeeId, req.query.employee_id));
      }
      if (req.query.branch_id) {
        conds.push(eq(schema.attendanceRecords.branchId, req.query.branch_id));
      }
      if (req.query.status) {
        conds.push(eq(schema.attendanceRecords.status, req.query.status));
      }
      if (req.query.method) {
        conds.push(eq(schema.attendanceRecords.method, req.query.method));
      }
      if (req.query.has_conflict === "true") {
        conds.push(eq(schema.attendanceRecords.hasConflict, true));
      } else if (req.query.has_conflict === "false") {
        conds.push(eq(schema.attendanceRecords.hasConflict, false));
      }

      return tx
        .select({
          record: schema.attendanceRecords,
          employeeFullName: schema.employees.fullName,
          employeeCode: schema.employees.employeeCode,
        })
        .from(schema.attendanceRecords)
        .leftJoin(
          schema.employees,
          eq(schema.employees.id, schema.attendanceRecords.employeeId),
        )
        .where(and(...conds))
        .orderBy(desc(schema.attendanceRecords.attendanceDate))
        .limit(200);
    });

    return reply.send({
      records: rows.map((r) => ({
        ...r.record,
        employeeFullName: r.employeeFullName,
        employeeCode: r.employeeCode,
      })),
    });
  });

  // GET /attendance/records/:id
  fastify.get<{ Params: { id: string } }>(
    "/records/:id",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "attendance.view");
      if (!ctx) return;

      const row = await withTenant(ctx.tenantId, async (tx) => {
        const [r] = await tx
          .select({
            record: schema.attendanceRecords,
            employeeFullName: schema.employees.fullName,
            employeeCode: schema.employees.employeeCode,
          })
          .from(schema.attendanceRecords)
          .leftJoin(
            schema.employees,
            eq(schema.employees.id, schema.attendanceRecords.employeeId),
          )
          .where(
            and(
              eq(schema.attendanceRecords.tenantId, ctx.tenantId),
              eq(schema.attendanceRecords.id, req.params.id),
              isNull(schema.attendanceRecords.deletedAt),
            ),
          )
          .limit(1);
        return r ?? null;
      });
      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      return reply.send({
        record: {
          ...row.record,
          employeeFullName: row.employeeFullName,
          employeeCode: row.employeeCode,
        },
      });
    },
  );

  // POST /attendance/records — create or upsert a single record.
  fastify.post("/records", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "attendance.operate");
    if (!ctx) return;

    const parsed = CreateRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const out = await withTenant(ctx.tenantId, async (tx) => {
      const result = await upsertAttendanceRecord(tx, {
        tenantId: ctx.tenantId,
        employeeId: input.employeeId,
        attendanceDate: input.attendanceDate,
        branchId: input.branchId ?? null,
        checkInAt: input.checkInAt ? new Date(input.checkInAt) : null,
        checkOutAt: input.checkOutAt ? new Date(input.checkOutAt) : null,
        method: input.method,
        status: input.status,
        locationLat: input.locationLat ?? null,
        locationLng: input.locationLng ?? null,
        notes: input.notes || null,
        createdByUserId: ctx.userId,
      });

      await recordAuditEvent(tx, {
        kind:
          result.outcome === "created"
            ? "attendance_record.created"
            : "attendance_record.updated",
        summary: `${result.outcome} attendance for ${input.employeeId} on ${input.attendanceDate} (${input.method})`,
        refType: "attendance_record",
        refId: result.record.id,
        diff: { outcome: result.outcome, method: input.method },
        actorUserId: ctx.userId,
      });
      return result;
    });

    return reply
      .status(out.outcome === "created" ? 201 : 200)
      .send({ record: out.record, outcome: out.outcome });
  });

  // PATCH /attendance/records/:id
  fastify.patch<{ Params: { id: string } }>(
    "/records/:id",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "attendance.operate");
      if (!ctx) return;

      const parsed = PatchRecordSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }
      const input = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.attendanceRecords)
          .where(
            and(
              eq(schema.attendanceRecords.tenantId, ctx.tenantId),
              eq(schema.attendanceRecords.id, req.params.id),
              isNull(schema.attendanceRecords.deletedAt),
            ),
          )
          .limit(1);
        if (!existing) return { error: "NOT_FOUND" as const };

        const updates: Partial<typeof schema.attendanceRecords.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (input.branchId !== undefined) updates.branchId = input.branchId;
        if (input.checkInAt !== undefined)
          updates.checkInAt = input.checkInAt ? new Date(input.checkInAt) : null;
        if (input.checkOutAt !== undefined)
          updates.checkOutAt = input.checkOutAt
            ? new Date(input.checkOutAt)
            : null;
        if (input.status !== undefined) updates.status = input.status;
        if (input.hasConflict !== undefined)
          updates.hasConflict = input.hasConflict;
        if (input.conflictReason !== undefined)
          updates.conflictReason = input.conflictReason;
        if (input.notes !== undefined) updates.notes = input.notes || null;

        // If either check timestamp changed, recompute totalMinutes.
        const nextIn =
          updates.checkInAt !== undefined ? updates.checkInAt : existing.checkInAt;
        const nextOut =
          updates.checkOutAt !== undefined
            ? updates.checkOutAt
            : existing.checkOutAt;
        if (updates.checkInAt !== undefined || updates.checkOutAt !== undefined) {
          updates.totalMinutes = computeTotalMinutes(nextIn, nextOut);
        }

        const [updated] = await tx
          .update(schema.attendanceRecords)
          .set(updates)
          .where(eq(schema.attendanceRecords.id, existing.id))
          .returning();

        await recordAuditEvent(tx, {
          kind: "attendance_record.updated",
          summary: `Updated attendance record ${existing.id.slice(0, 8)}`,
          refType: "attendance_record",
          refId: existing.id,
          diff: { before: existing, after: updated },
          actorUserId: ctx.userId,
        });
        return { ok: true as const, record: updated };
      });

      if ("error" in result) {
        return reply.status(404).send({ error: { code: result.error } });
      }
      return reply.send({ record: result.record });
    },
  );

  // DELETE /attendance/records/:id — soft delete
  fastify.delete<{ Params: { id: string } }>(
    "/records/:id",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "attendance.operate");
      if (!ctx) return;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.attendanceRecords)
          .where(
            and(
              eq(schema.attendanceRecords.tenantId, ctx.tenantId),
              eq(schema.attendanceRecords.id, req.params.id),
              isNull(schema.attendanceRecords.deletedAt),
            ),
          )
          .limit(1);
        if (!existing) return { error: "NOT_FOUND" as const };

        await tx
          .update(schema.attendanceRecords)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.attendanceRecords.id, existing.id));

        await recordAuditEvent(tx, {
          kind: "attendance_record.deleted",
          summary: `Soft-deleted attendance ${existing.id.slice(0, 8)}`,
          refType: "attendance_record",
          refId: existing.id,
          diff: null,
          actorUserId: ctx.userId,
        });
        return { ok: true as const };
      });

      if ("error" in result) {
        return reply.status(404).send({ error: { code: result.error } });
      }
      return reply.send({ ok: true });
    },
  );

  // POST /attendance/records/check-in — self or kiosk check-in. Any
  // authenticated user can hit this; if `users.employee_id` column
  // exists we look it up, otherwise the caller must carry
  // attendance.operate and supply `employeeId` in the body so a
  // supervisor-at-kiosk flow still works on day one.
  fastify.post("/records/check-in", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const parsed = SelfPunchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(auth.tenantId, async (tx) => {
      // users.employee_id isn't in the DB today; fall through to the
      // body-supplied employeeId. The column existence check is a
      // belt-and-braces runtime probe so a future migration that adds
      // users.employee_id turns this into auto-resolve for free.
      let employeeId = input.employeeId ?? null;
      if (!employeeId) {
        const probe = (await tx.execute(sql`
          SELECT column_name FROM information_schema.columns
          WHERE table_name='users' AND column_name='employee_id'
        `)) as unknown as Array<{ column_name: string }>;
        if (probe.length > 0) {
          const rows = (await tx.execute(sql`
            SELECT employee_id FROM users
             WHERE id = ${auth.userId}::uuid AND tenant_id = ${auth.tenantId}::uuid
          `)) as unknown as Array<{ employee_id: string | null }>;
          employeeId = rows[0]?.employee_id ?? null;
        }
      }

      if (!employeeId) {
        return {
          error: "EMPLOYEE_UNRESOLVED" as const,
        };
      }

      // If the caller is supplying employeeId by body and they're not
      // self-clocking, they need attendance.operate. This mirrors the
      // SOD intent — can't fake someone else's clock-in.
      if (input.employeeId) {
        const perm = (await tx.execute(sql`
          SELECT
            (SELECT is_owner FROM users WHERE id = ${auth.userId} AND tenant_id = ${auth.tenantId}) AS is_owner,
            EXISTS(SELECT 1 FROM user_roles WHERE tenant_id = ${auth.tenantId}) AS has_assigns,
            COALESCE(
              (
                SELECT BOOL_OR((r.permissions ->> 'attendance.operate')::boolean)
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
                WHERE ur.user_id = ${auth.userId} AND ur.tenant_id = ${auth.tenantId}
              ),
              false
            ) AS allowed
        `)) as unknown as Array<{
          is_owner: boolean | null;
          has_assigns: boolean;
          allowed: boolean;
        }>;
        const row = perm[0] ?? { is_owner: false, has_assigns: false, allowed: false };
        const permitted =
          row.is_owner === true || !row.has_assigns || row.allowed === true;
        if (!permitted) return { error: "FORBIDDEN" as const };
      }

      const today = new Date().toISOString().slice(0, 10);
      const now = new Date();

      const upserted = await upsertAttendanceRecord(tx, {
        tenantId: auth.tenantId,
        employeeId,
        attendanceDate: today,
        checkInAt: now,
        method: "self",
        status: "present",
        locationLat: input.locationLat ?? null,
        locationLng: input.locationLng ?? null,
        createdByUserId: auth.userId,
      });

      await recordAuditEvent(tx, {
        kind: "attendance_record.check_in",
        summary: `Self check-in for ${employeeId} on ${today}`,
        refType: "attendance_record",
        refId: upserted.record.id,
        diff: {
          outcome: upserted.outcome,
          locationLat: input.locationLat ?? null,
          locationLng: input.locationLng ?? null,
        },
        actorUserId: auth.userId,
      });

      return { ok: true as const, record: upserted.record, outcome: upserted.outcome };
    });

    if ("error" in result) {
      const code = result.error;
      const status =
        code === "EMPLOYEE_UNRESOLVED" ? 400 : code === "FORBIDDEN" ? 403 : 500;
      const message =
        code === "EMPLOYEE_UNRESOLVED"
          ? "Can't resolve your employee record. Pass `employeeId` explicitly or have an admin link your user to an employee."
          : code === "FORBIDDEN"
            ? "You need attendance.operate to clock in on behalf of another employee."
            : "";
      return reply.status(status).send({ error: { code, message } });
    }
    return reply.send({ record: result.record, outcome: result.outcome });
  });

  // POST /attendance/records/check-out — mirror of check-in.
  fastify.post("/records/check-out", async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const parsed = SelfPunchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(auth.tenantId, async (tx) => {
      let employeeId = input.employeeId ?? null;
      if (!employeeId) {
        const probe = (await tx.execute(sql`
          SELECT column_name FROM information_schema.columns
          WHERE table_name='users' AND column_name='employee_id'
        `)) as unknown as Array<{ column_name: string }>;
        if (probe.length > 0) {
          const rows = (await tx.execute(sql`
            SELECT employee_id FROM users
             WHERE id = ${auth.userId}::uuid AND tenant_id = ${auth.tenantId}::uuid
          `)) as unknown as Array<{ employee_id: string | null }>;
          employeeId = rows[0]?.employee_id ?? null;
        }
      }
      if (!employeeId) return { error: "EMPLOYEE_UNRESOLVED" as const };

      const today = new Date().toISOString().slice(0, 10);
      const now = new Date();

      const upserted = await upsertAttendanceRecord(tx, {
        tenantId: auth.tenantId,
        employeeId,
        attendanceDate: today,
        checkOutAt: now,
        method: "self",
        status: "present",
        locationLat: input.locationLat ?? null,
        locationLng: input.locationLng ?? null,
        createdByUserId: auth.userId,
      });

      await recordAuditEvent(tx, {
        kind: "attendance_record.check_out",
        summary: `Self check-out for ${employeeId} on ${today}`,
        refType: "attendance_record",
        refId: upserted.record.id,
        diff: {
          outcome: upserted.outcome,
          totalMinutes: upserted.record.totalMinutes,
        },
        actorUserId: auth.userId,
      });

      return { ok: true as const, record: upserted.record, outcome: upserted.outcome };
    });

    if ("error" in result) {
      return reply.status(400).send({
        error: {
          code: result.error,
          message:
            "Can't resolve your employee record. Pass `employeeId` explicitly or have an admin link your user to an employee.",
        },
      });
    }
    return reply.send({ record: result.record, outcome: result.outcome });
  });

  // POST /attendance/records/muster — bulk supervisor muster. One
  // POST, N rows, one upsert each.
  fastify.post("/records/muster", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "attendance.operate");
    if (!ctx) return;

    const parsed = MusterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const results = await withTenant(ctx.tenantId, async (tx) => {
      const out: Array<{
        employeeId: string;
        result: UpsertOutcome;
        recordId: string;
      }> = [];
      for (const employeeId of input.employeeIds) {
        const upserted = await upsertAttendanceRecord(tx, {
          tenantId: ctx.tenantId,
          employeeId,
          attendanceDate: input.attendanceDate,
          branchId: input.branchId ?? null,
          method: "manual_muster",
          status: input.status ?? "present",
          supervisorUserId: ctx.userId,
          notes: input.notes || null,
          createdByUserId: ctx.userId,
        });
        out.push({
          employeeId,
          result: upserted.outcome,
          recordId: upserted.record.id,
        });
      }

      await recordAuditEvent(tx, {
        kind: "attendance_record.muster",
        summary: `Muster on ${input.attendanceDate}: ${out.length} employees`,
        refType: "attendance_record",
        refId: null,
        diff: {
          attendanceDate: input.attendanceDate,
          branchId: input.branchId ?? null,
          status: input.status ?? "present",
          created: out.filter((r) => r.result === "created").length,
          updated: out.filter((r) => r.result === "updated").length,
          conflicts: out.filter((r) => r.result === "conflict").length,
        },
        actorUserId: ctx.userId,
      });

      return out;
    });

    return reply.send({ results });
  });

  // =========================================================================
  // IMPORTS
  // =========================================================================

  // GET /attendance/imports — filter by ?device_id=
  fastify.get<{ Querystring: { device_id?: string } }>(
    "/imports",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "attendance.view");
      if (!ctx) return;

      const rows = await withTenant(ctx.tenantId, async (tx) => {
        const conds = [eq(schema.attendanceImports.tenantId, ctx.tenantId)];
        if (req.query.device_id) {
          conds.push(
            eq(schema.attendanceImports.attendanceDeviceId, req.query.device_id),
          );
        }
        return tx
          .select()
          .from(schema.attendanceImports)
          .where(and(...conds))
          .orderBy(desc(schema.attendanceImports.createdAt))
          .limit(100);
      });
      return reply.send({ imports: rows });
    },
  );

  // GET /attendance/imports/:id
  fastify.get<{ Params: { id: string } }>(
    "/imports/:id",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "attendance.view");
      if (!ctx) return;

      const row = await withTenant(ctx.tenantId, async (tx) => {
        const [r] = await tx
          .select()
          .from(schema.attendanceImports)
          .where(
            and(
              eq(schema.attendanceImports.tenantId, ctx.tenantId),
              eq(schema.attendanceImports.id, req.params.id),
            ),
          )
          .limit(1);
        return r ?? null;
      });
      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      return reply.send({ import: row });
    },
  );

  // POST /attendance/imports — commit a parsed biometric file. Body
  // carries the already-parsed rows (client parses CSV). The API
  // resolves biometric_employee_id → employee_id, skips unresolved,
  // upserts the rest.
  fastify.post("/imports", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "attendance.operate");
    if (!ctx) return;

    const parsed = CreateImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Verify device exists.
      const [dev] = await tx
        .select()
        .from(schema.attendanceDevices)
        .where(
          and(
            eq(schema.attendanceDevices.tenantId, ctx.tenantId),
            eq(schema.attendanceDevices.id, input.attendanceDeviceId),
            isNull(schema.attendanceDevices.deletedAt),
          ),
        )
        .limit(1);
      if (!dev) return { error: "DEVICE_NOT_FOUND" as const };

      // Preload the biometric map for this device into memory once.
      const mapRows = await tx
        .select()
        .from(schema.biometricEmployeeMap)
        .where(
          and(
            eq(schema.biometricEmployeeMap.tenantId, ctx.tenantId),
            eq(
              schema.biometricEmployeeMap.attendanceDeviceId,
              input.attendanceDeviceId,
            ),
            isNull(schema.biometricEmployeeMap.deletedAt),
          ),
        );
      const bioToEmp = new Map<string, string>();
      for (const r of mapRows) bioToEmp.set(r.biometricEmployeeId, r.employeeId);

      type ErrorEntry = {
        row: number;
        biometricEmployeeId?: string;
        punchAt?: string;
        reason: string;
      };
      const errors: ErrorEntry[] = [];
      let rowsImported = 0;
      let rowsSkipped = 0;

      for (let i = 0; i < input.rows.length; i++) {
        const raw = input.rows[i];
        if (!raw) continue;
        const employeeId = bioToEmp.get(raw.biometricEmployeeId);
        if (!employeeId) {
          rowsSkipped++;
          errors.push({
            row: i + 1,
            biometricEmployeeId: raw.biometricEmployeeId,
            punchAt: raw.punchAt,
            reason: `Biometric ID "${raw.biometricEmployeeId}" is not mapped on this device.`,
          });
          continue;
        }

        const punch = new Date(raw.punchAt);
        if (!Number.isFinite(punch.getTime())) {
          rowsSkipped++;
          errors.push({
            row: i + 1,
            biometricEmployeeId: raw.biometricEmployeeId,
            punchAt: raw.punchAt,
            reason: "Unparseable punch timestamp.",
          });
          continue;
        }
        const date = punch.toISOString().slice(0, 10);

        // Direction hint: 'in' → set checkInAt; 'out' → set checkOutAt;
        // null/undefined → pass both, the helper takes earliest+latest
        // so either one wins correctly.
        const checkInAt = raw.direction === "out" ? null : punch;
        const checkOutAt = raw.direction === "in" ? null : punch;

        try {
          await upsertAttendanceRecord(tx, {
            tenantId: ctx.tenantId,
            employeeId,
            attendanceDate: date,
            branchId: dev.branchId ?? null,
            checkInAt,
            checkOutAt,
            method: "biometric",
            status: "present",
            sourceDeviceId: dev.id,
            createdByUserId: ctx.userId,
          });
          rowsImported++;
        } catch (err) {
          rowsSkipped++;
          errors.push({
            row: i + 1,
            biometricEmployeeId: raw.biometricEmployeeId,
            punchAt: raw.punchAt,
            reason:
              err instanceof Error ? err.message : "Unexpected upsert failure",
          });
        }
      }

      // Persist learned column mapping on the device, if the client
      // sent one.
      if (input.columnTemplate) {
        await tx
          .update(schema.attendanceDevices)
          .set({
            columnTemplate: input.columnTemplate,
            lastImportAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.attendanceDevices.id, dev.id));
      } else {
        await tx
          .update(schema.attendanceDevices)
          .set({ lastImportAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.attendanceDevices.id, dev.id));
      }

      const [imp] = await tx
        .insert(schema.attendanceImports)
        .values({
          tenantId: ctx.tenantId,
          attendanceDeviceId: dev.id,
          fileName: input.fileName,
          fileSizeBytes: input.fileSizeBytes ?? null,
          rowsTotal: input.rows.length,
          rowsImported,
          rowsSkipped,
          rowsErrored: 0,
          errors,
          status: "completed",
          importedByUserId: ctx.userId,
          completedAt: new Date(),
        })
        .returning();
      if (!imp) throw new Error("Import insert failed");

      await recordAuditEvent(tx, {
        kind: "attendance_import.completed",
        summary: `Imported ${rowsImported}/${input.rows.length} rows from "${input.fileName}"`,
        refType: "attendance_import",
        refId: imp.id,
        diff: {
          deviceId: dev.id,
          rowsTotal: input.rows.length,
          rowsImported,
          rowsSkipped,
          errorCount: errors.length,
        },
        actorUserId: ctx.userId,
      });

      return { ok: true as const, import: imp };
    });

    if ("error" in result) {
      return reply.status(404).send({ error: { code: result.error } });
    }
    return reply.status(201).send({ import: result.import });
  });

  // =========================================================================
  // EXCEPTIONS
  // =========================================================================

  // GET /attendance/exceptions — records that need supervisor action:
  //   1. has_conflict = true (method mismatch)
  //   2. check_in_at IS NOT NULL AND check_out_at IS NULL AND
  //      attendance_date < today (missed check-out)
  fastify.get("/exceptions", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "attendance.view");
    if (!ctx) return;

    const today = new Date().toISOString().slice(0, 10);

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      return (await tx.execute(sql`
        SELECT
          ar.*,
          e.full_name  AS employee_full_name,
          e.employee_code AS employee_code
          FROM attendance_records ar
          LEFT JOIN employees e ON e.id = ar.employee_id
         WHERE ar.tenant_id = current_tenant_id()
           AND ar.deleted_at IS NULL
           AND (
             ar.has_conflict = true
             OR (ar.check_in_at IS NOT NULL
                 AND ar.check_out_at IS NULL
                 AND ar.attendance_date < ${today}::date)
           )
         ORDER BY ar.attendance_date DESC
         LIMIT 200
      `)) as unknown as Array<Record<string, unknown>>;
    });

    return reply.send({ exceptions: rows });
  });
};
