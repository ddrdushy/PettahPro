import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  boolean,
  bigint,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { branches } from "./branches.js";

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  employeeCode: varchar("employee_code", { length: 32 }),
  firstName: varchar("first_name", { length: 128 }).notNull(),
  lastName: varchar("last_name", { length: 128 }).notNull(),
  fullName: varchar("full_name", { length: 255 }),
  dateOfBirth: date("date_of_birth"),
  gender: varchar("gender", { length: 16 }),
  personalEmail: varchar("personal_email", { length: 255 }),
  mobilePhone: varchar("mobile_phone", { length: 32 }),
  whatsapp: varchar("whatsapp", { length: 32 }),
  addressLine1: varchar("address_line1", { length: 255 }),
  city: varchar("city", { length: 128 }),
  postalCode: varchar("postal_code", { length: 16 }),
  nic: varchar("nic", { length: 20 }),
  epfNumber: varchar("epf_number", { length: 30 }),
  etfNumber: varchar("etf_number", { length: 30 }),
  tin: varchar("tin", { length: 32 }),
  hireDate: date("hire_date").notNull(),
  employmentType: varchar("employment_type", { length: 16 }).notNull().default("permanent"),
  designation: varchar("designation", { length: 128 }),
  department: varchar("department", { length: 128 }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  wageType: varchar("wage_type", { length: 16 }).notNull().default("monthly"),
  basicSalaryCents: bigint("basic_salary_cents", { mode: "number" }).notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  epfEligible: boolean("epf_eligible").notNull().default(true),
  etfEligible: boolean("etf_eligible").notNull().default(true),
  payeApplicable: boolean("paye_applicable").notNull().default(true),
  bankName: varchar("bank_name", { length: 128 }),
  bankAccountNo: varchar("bank_account_no", { length: 64 }),
  bankBranch: varchar("bank_branch", { length: 128 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
  statusChangeReason: text("status_change_reason"),
  exitDate: date("exit_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;

// Immutable history of basic salary changes. The employees.basicSalaryCents
// column always reflects the latest rate; this table keeps the paper trail
// AND drives ARREARS auto-computation on the next payroll run (per
// payroll-module-spec §14.4). `applied_in_run_id` marks the revision as
// already compensated so it can't pay arrears twice.
export const employeeSalaryRevisions = pgTable("employee_salary_revisions", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  effectiveDate: date("effective_date").notNull(),
  previousBasicSalaryCents: bigint("previous_basic_salary_cents", { mode: "number" }).notNull(),
  newBasicSalaryCents: bigint("new_basic_salary_cents", { mode: "number" }).notNull(),
  reason: varchar("reason", { length: 255 }),
  notes: text("notes"),
  // Payroll run that compensated the arrears. NULL = pending.
  appliedInRunId: uuid("applied_in_run_id"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  arrearsCentsApplied: bigint("arrears_cents_applied", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
});

export type EmployeeSalaryRevision = typeof employeeSalaryRevisions.$inferSelect;
export type NewEmployeeSalaryRevision = typeof employeeSalaryRevisions.$inferInsert;
