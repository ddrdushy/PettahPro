import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  integer,
  boolean,
  text,
  numeric,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { employees } from "./employees.js";
import { branches } from "./branches.js";
import { attendanceDevices } from "./attendance-devices.js";
import { users } from "./users.js";

// Attendance record — the event (roadmap #39).
//
// One row per (employee, day). Four capture methods all converge on
// this shape: self check-in/out, QR scan, biometric file import,
// manual supervisor muster. Pay-affecting calculations (late / OT /
// half-day policy) live in payroll, not here — `total_minutes` is
// the raw floor measurement. See
// `docker/postgres/init/76-attendance.sql` for the full design
// notes.
//
// Dedup: a partial unique index on
// `(tenant_id, employee_id, attendance_date) WHERE deleted_at IS
// NULL` guarantees one live record per day. Second punch =
// update (earliest check_in_at, latest check_out_at). Method
// mismatch flips `has_conflict=true` with a reason; supervisor
// resolves via PATCH.
export const attendanceRecords = pgTable("attendance_records", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "restrict" }),
  attendanceDate: date("attendance_date").notNull(),
  branchId: uuid("branch_id").references(() => branches.id, {
    onDelete: "restrict",
  }),
  checkInAt: timestamp("check_in_at", { withTimezone: true }),
  checkOutAt: timestamp("check_out_at", { withTimezone: true }),
  totalMinutes: integer("total_minutes"),
  method: varchar("method", { length: 24 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("present"),
  sourceDeviceId: uuid("source_device_id").references(
    () => attendanceDevices.id,
    { onDelete: "set null" },
  ),
  supervisorUserId: uuid("supervisor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  locationLat: numeric("location_lat", { precision: 10, scale: 7 }),
  locationLng: numeric("location_lng", { precision: 10, scale: 7 }),
  hasConflict: boolean("has_conflict").notNull().default(false),
  conflictReason: text("conflict_reason"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type NewAttendanceRecord = typeof attendanceRecords.$inferInsert;

// Enum constants — kept in sync with the DB CHECK constraints in
// migration 76. Use these both in the API layer and the web forms.
export const ATTENDANCE_METHODS = [
  "qr",
  "biometric",
  "geofence",
  "manual_muster",
  "self",
] as const;
export type AttendanceMethod = (typeof ATTENDANCE_METHODS)[number];

export const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "half_day",
  "on_leave",
  "holiday",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
