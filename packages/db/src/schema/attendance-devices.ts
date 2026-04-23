import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { branches } from "./branches.js";

// Attendance device registry (roadmap #39).
//
// Per-tenant source of attendance events — could be a biometric
// device (zkteco/essl/suprema), a QR station, or a catch-all
// "manual" entry for supervisor-driven muster sheets. The
// `column_template` jsonb remembers the user's column mapping from
// the last CSV import so the next file from the same device defaults
// to the same layout — matching the #39 spec's "learned once, reused
// forever" import UX. See `docker/postgres/init/76-attendance.sql`.
export const attendanceDevices = pgTable("attendance_devices", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  deviceType: varchar("device_type", { length: 32 }).notNull(),
  branchId: uuid("branch_id").references(() => branches.id, {
    onDelete: "restrict",
  }),
  exportFormat: varchar("export_format", { length: 16 }),
  columnTemplate: jsonb("column_template").notNull().default({}),
  notes: text("notes"),
  lastImportAt: timestamp("last_import_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AttendanceDevice = typeof attendanceDevices.$inferSelect;
export type NewAttendanceDevice = typeof attendanceDevices.$inferInsert;

export const ATTENDANCE_DEVICE_TYPES = [
  "zkteco",
  "essl",
  "suprema",
  "other",
  "qr",
  "manual",
] as const;
export type AttendanceDeviceType = (typeof ATTENDANCE_DEVICE_TYPES)[number];

export const ATTENDANCE_DEVICE_EXPORT_FORMATS = ["csv", "xlsx", "txt"] as const;
export type AttendanceDeviceExportFormat =
  (typeof ATTENDANCE_DEVICE_EXPORT_FORMATS)[number];
