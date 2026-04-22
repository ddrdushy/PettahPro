import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  boolean,
  bigint,
  integer,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { employees } from "./employees.js";
import { chartOfAccounts } from "./accounts.js";
import { journalEntries } from "./journals.js";

// Loan type library. Seeded per tenant with a compact SL-typical set
// (festival, salary advance, emergency, housing, vehicle). Each row
// carries defaults that prefill the loan form but the staff officer can
// override at application time.
export const loanTypes = pgTable("loan_types", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 32 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  maxAmountCents: bigint("max_amount_cents", { mode: "number" }),
  defaultInterestRateBps: integer("default_interest_rate_bps").notNull().default(0),
  defaultTenureMonths: integer("default_tenure_months").notNull().default(6),
  maxTenureMonths: integer("max_tenure_months").notNull().default(60),
  isInterestBearing: boolean("is_interest_bearing").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type LoanType = typeof loanTypes.$inferSelect;
export type NewLoanType = typeof loanTypes.$inferInsert;


// Loan header. Moves draft → approved → disbursed → closed. Only at
// disburse do we post a JE (DR Employee loans receivable / CR Bank) and
// materialize the schedule; cancel pre-disbursement is a no-op ledger-wise.
export const employeeLoans = pgTable("employee_loans", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  loanNumber: varchar("loan_number", { length: 32 }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "restrict" }),
  loanTypeId: uuid("loan_type_id").references(() => loanTypes.id, { onDelete: "set null" }),
  loanTypeName: varchar("loan_type_name", { length: 128 }),
  principalCents: bigint("principal_cents", { mode: "number" }).notNull(),
  interestRateBps: integer("interest_rate_bps").notNull().default(0),
  tenureMonths: integer("tenure_months").notNull(),
  totalInterestCents: bigint("total_interest_cents", { mode: "number" }).notNull().default(0),
  emiCents: bigint("emi_cents", { mode: "number" }).notNull().default(0),
  firstInstallmentDate: date("first_installment_date"),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByUserId: uuid("approved_by_user_id"),
  disbursedAt: timestamp("disbursed_at", { withTimezone: true }),
  disbursedByUserId: uuid("disbursed_by_user_id"),
  disbursementDate: date("disbursement_date"),
  disbursementAccountId: uuid("disbursement_account_id").references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  disbursementJournalId: uuid("disbursement_journal_id").references(() => journalEntries.id, { onDelete: "set null" }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedReason: varchar("closed_reason", { length: 32 }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),
  principalOutstandingCents: bigint("principal_outstanding_cents", { mode: "number" }).notNull().default(0),
  interestOutstandingCents: bigint("interest_outstanding_cents", { mode: "number" }).notNull().default(0),
  principalRepaidCents: bigint("principal_repaid_cents", { mode: "number" }).notNull().default(0),
  interestRepaidCents: bigint("interest_repaid_cents", { mode: "number" }).notNull().default(0),
  writtenOffCents: bigint("written_off_cents", { mode: "number" }).notNull().default(0),
  applicationReason: text("application_reason"),
  approvalNotes: text("approval_notes"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type EmployeeLoan = typeof employeeLoans.$inferSelect;
export type NewEmployeeLoan = typeof employeeLoans.$inferInsert;


// EMI schedule. One row per installment. Payroll compute claims unpaid
// rows with due_date ≤ period_end by stamping applied_in_run_id inside
// the same tx as line creation — this is the atomic handoff that prevents
// two runs from recovering the same EMI.
export const employeeLoanSchedule = pgTable("employee_loan_schedule", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  loanId: uuid("loan_id").notNull().references(() => employeeLoans.id, { onDelete: "cascade" }),
  installmentNo: integer("installment_no").notNull(),
  dueDate: date("due_date").notNull(),
  principalCents: bigint("principal_cents", { mode: "number" }).notNull().default(0),
  interestCents: bigint("interest_cents", { mode: "number" }).notNull().default(0),
  totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
  openingBalanceCents: bigint("opening_balance_cents", { mode: "number" }).notNull().default(0),
  closingBalanceCents: bigint("closing_balance_cents", { mode: "number" }).notNull().default(0),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  appliedInRunId: uuid("applied_in_run_id"),
  appliedRunLineId: uuid("applied_run_line_id"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  waivedReason: text("waived_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmployeeLoanScheduleRow = typeof employeeLoanSchedule.$inferSelect;
export type NewEmployeeLoanScheduleRow = typeof employeeLoanSchedule.$inferInsert;
