import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  smallint,
  integer,
  bigint,
  boolean,
  text,
  numeric,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { employees } from "./employees.js";
import { journalEntries } from "./journals.js";

export const payrollRuns = pgTable("payroll_runs", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  runNumber: varchar("run_number", { length: 48 }),
  periodYear: smallint("period_year").notNull(),
  periodMonth: smallint("period_month").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  payDate: date("pay_date").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  employeeCount: integer("employee_count").notNull().default(0),
  grossCents: bigint("gross_cents", { mode: "number" }).notNull().default(0),
  epfEmployeeCents: bigint("epf_employee_cents", { mode: "number" }).notNull().default(0),
  epfEmployerCents: bigint("epf_employer_cents", { mode: "number" }).notNull().default(0),
  etfEmployerCents: bigint("etf_employer_cents", { mode: "number" }).notNull().default(0),
  payeCents: bigint("paye_cents", { mode: "number" }).notNull().default(0),
  netPayCents: bigint("net_pay_cents", { mode: "number" }).notNull().default(0),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postedByUserId: uuid("posted_by_user_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // Void metadata — populated by POST /payroll-runs/:id/void. Same shape
  // as bonus_runs / expense_claims. When voidAt is set, status is flipped
  // to 'voided', the originating JE is reversed, and every atomic claim
  // the run made (salary revisions, loan EMI schedule, commission
  // earnings) is released.
  voidReason: text("void_reason"),
  voidAt: timestamp("void_at", { withTimezone: true }),
  voidByUserId: uuid("void_by_user_id"),
});

export type PayrollRun = typeof payrollRuns.$inferSelect;
export type NewPayrollRun = typeof payrollRuns.$inferInsert;

export const payrollRunLines = pgTable("payroll_run_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "restrict" }),
  employeeFullName: varchar("employee_full_name", { length: 255 }).notNull(),
  employeeCode: varchar("employee_code", { length: 32 }),
  nic: varchar("nic", { length: 20 }),
  epfNumber: varchar("epf_number", { length: 30 }),
  etfNumber: varchar("etf_number", { length: 30 }),
  designation: varchar("designation", { length: 128 }),
  department: varchar("department", { length: 128 }),
  basicSalaryCents: bigint("basic_salary_cents", { mode: "number" }).notNull(),
  grossCents: bigint("gross_cents", { mode: "number" }).notNull(),
  earningsCents: bigint("earnings_cents", { mode: "number" }).notNull().default(0),
  nonStatutoryDeductionsCents: bigint("non_statutory_deductions_cents", { mode: "number" }).notNull().default(0),
  epfEmployeeCents: bigint("epf_employee_cents", { mode: "number" }).notNull().default(0),
  payeCents: bigint("paye_cents", { mode: "number" }).notNull().default(0),
  otherDeductionsCents: bigint("other_deductions_cents", { mode: "number" }).notNull().default(0),
  totalDeductionsCents: bigint("total_deductions_cents", { mode: "number" }).notNull(),
  epfEmployerCents: bigint("epf_employer_cents", { mode: "number" }).notNull().default(0),
  etfEmployerCents: bigint("etf_employer_cents", { mode: "number" }).notNull().default(0),
  netPayCents: bigint("net_pay_cents", { mode: "number" }).notNull(),
  wasEpfEligible: boolean("was_epf_eligible").notNull(),
  wasEtfEligible: boolean("was_etf_eligible").notNull(),
  wasPayeApplicable: boolean("was_paye_applicable").notNull(),
  paidLeaveDays: numeric("paid_leave_days", { precision: 6, scale: 2 }).notNull().default("0"),
  unpaidLeaveDays: numeric("unpaid_leave_days", { precision: 6, scale: 2 }).notNull().default("0"),
  prorataDaysWorked: integer("prorata_days_worked"),
  prorataDaysInPeriod: integer("prorata_days_in_period"),
  bankName: varchar("bank_name", { length: 128 }),
  bankAccountNo: varchar("bank_account_no", { length: 64 }),
  bankBranch: varchar("bank_branch", { length: 128 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PayrollRunLine = typeof payrollRunLines.$inferSelect;
export type NewPayrollRunLine = typeof payrollRunLines.$inferInsert;
