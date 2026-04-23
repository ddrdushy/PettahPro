import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { attendanceDevices } from "./attendance-devices.js";
import { employees } from "./employees.js";

// Biometric-employee mapping (roadmap #39).
//
// Biometric vendors hand out device-local IDs (often just a 3–4
// digit integer stamped on the device's enrolment screen). This
// table joins `(device_id, biometric_employee_id) → employee_id`
// so the import can resolve raw punch rows to real employees.
// A single employee can be mapped on multiple devices with
// different biometric IDs on each. See
// `docker/postgres/init/76-attendance.sql`.
export const biometricEmployeeMap = pgTable("biometric_employee_map", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  attendanceDeviceId: uuid("attendance_device_id")
    .notNull()
    .references(() => attendanceDevices.id, { onDelete: "cascade" }),
  biometricEmployeeId: varchar("biometric_employee_id", { length: 64 }).notNull(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type BiometricEmployeeMap = typeof biometricEmployeeMap.$inferSelect;
export type NewBiometricEmployeeMap = typeof biometricEmployeeMap.$inferInsert;
