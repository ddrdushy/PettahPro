import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  integer,
  bigint,
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { attendanceDevices } from "./attendance-devices.js";
import { users } from "./users.js";

// Attendance import header (roadmap #39).
//
// One row per biometric file parse. Holds the per-row error list
// and summary counts; the actual attendance rows it created live
// in `attendance_records` keyed by (employee, date) — re-running
// the same file is idempotent through that dedup.
export const attendanceImports = pgTable("attendance_imports", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  attendanceDeviceId: uuid("attendance_device_id")
    .notNull()
    .references(() => attendanceDevices.id, { onDelete: "restrict" }),
  fileName: text("file_name").notNull(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsImported: integer("rows_imported").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
  rowsErrored: integer("rows_errored").notNull().default(0),
  errors: jsonb("errors").notNull().default([]),
  status: varchar("status", { length: 16 }).notNull().default("processing"),
  importedByUserId: uuid("imported_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type AttendanceImport = typeof attendanceImports.$inferSelect;
export type NewAttendanceImport = typeof attendanceImports.$inferInsert;
