import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  smallint,
  boolean,
  numeric,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { employees } from "./employees.js";

export const leaveTypes = pgTable("leave_types", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 16 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  defaultDaysPerYear: numeric("default_days_per_year", { precision: 8, scale: 2 }).notNull().default("0"),
  isPaid: boolean("is_paid").notNull().default(true),
  carryForwardAllowed: boolean("carry_forward_allowed").notNull().default(false),
  maxCarryForwardDays: numeric("max_carry_forward_days", { precision: 8, scale: 2 }).notNull().default("0"),
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type LeaveType = typeof leaveTypes.$inferSelect;
export type NewLeaveType = typeof leaveTypes.$inferInsert;

export const leaveAllocations = pgTable("leave_allocations", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id, { onDelete: "restrict" }),
  periodYear: smallint("period_year").notNull(),
  allocatedDays: numeric("allocated_days", { precision: 8, scale: 2 }).notNull().default("0"),
  carriedForwardDays: numeric("carried_forward_days", { precision: 8, scale: 2 }).notNull().default("0"),
  usedDays: numeric("used_days", { precision: 8, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeaveAllocation = typeof leaveAllocations.$inferSelect;
export type NewLeaveAllocation = typeof leaveAllocations.$inferInsert;

export const leaveRequests = pgTable("leave_requests", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  requestNumber: varchar("request_number", { length: 32 }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "restrict" }),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id, { onDelete: "restrict" }),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  daysCount: numeric("days_count", { precision: 8, scale: 2 }).notNull(),
  reason: text("reason"),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByUserId: uuid("approved_by_user_id"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
});

export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type NewLeaveRequest = typeof leaveRequests.$inferInsert;
