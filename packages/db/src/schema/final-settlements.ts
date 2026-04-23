import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  bigint,
  integer,
  numeric,
  text,
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { employees } from "./employees.js";
import { users } from "./users.js";
import { journalEntries } from "./journals.js";

// A single-row settlement worksheet per exiting employee. See
// docker/postgres/init/51-final-settlement.sql for the full schema comment.
// Lines (pro-rata, gratuity, leave encashment, notice, loans, PAYE, EPF,
// ETF) are flattened as columns for reporting AND snapshotted as JSON in
// `linesSnapshot` so the worksheet UI can render freeform labels without
// re-deriving from the column aggregates.
export const finalSettlements = pgTable("final_settlements", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  settlementNumber: varchar("settlement_number", { length: 32 }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "restrict" }),

  // Snapshot of employee state at settlement time
  employeeCode: varchar("employee_code", { length: 32 }),
  employeeFullName: varchar("employee_full_name", { length: 255 }).notNull(),
  designation: varchar("designation", { length: 128 }),
  department: varchar("department", { length: 128 }),
  hireDate: date("hire_date").notNull(),
  exitDate: date("exit_date").notNull(),
  lastWorkingDay: date("last_working_day").notNull(),
  statusAfter: varchar("status_after", { length: 24 }).notNull(),
  basicSalaryCents: bigint("basic_salary_cents", { mode: "number" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),

  yearsOfService: numeric("years_of_service", { precision: 6, scale: 2 })
    .notNull()
    .default("0"),
  gratuityYearsCompleted: integer("gratuity_years_completed")
    .notNull()
    .default(0),

  // Auto-computed components (editable on worksheet before approval)
  proRataSalaryCents: bigint("pro_rata_salary_cents", { mode: "number" })
    .notNull()
    .default(0),
  leaveEncashmentDays: numeric("leave_encashment_days", {
    precision: 8,
    scale: 2,
  })
    .notNull()
    .default("0"),
  leaveEncashmentCents: bigint("leave_encashment_cents", { mode: "number" })
    .notNull()
    .default(0),
  gratuityCents: bigint("gratuity_cents", { mode: "number" })
    .notNull()
    .default(0),
  noticePayInLieuCents: bigint("notice_pay_in_lieu_cents", { mode: "number" })
    .notNull()
    .default(0),
  noticeShortfallCents: bigint("notice_shortfall_cents", { mode: "number" })
    .notNull()
    .default(0),
  loanPrincipalRecoveryCents: bigint("loan_principal_recovery_cents", {
    mode: "number",
  })
    .notNull()
    .default(0),
  loanInterestRecoveryCents: bigint("loan_interest_recovery_cents", {
    mode: "number",
  })
    .notNull()
    .default(0),
  otherEarningsCents: bigint("other_earnings_cents", { mode: "number" })
    .notNull()
    .default(0),
  otherDeductionsCents: bigint("other_deductions_cents", { mode: "number" })
    .notNull()
    .default(0),

  // Statutory on settlement
  epfEmployeeCents: bigint("epf_employee_cents", { mode: "number" })
    .notNull()
    .default(0),
  epfEmployerCents: bigint("epf_employer_cents", { mode: "number" })
    .notNull()
    .default(0),
  etfEmployerCents: bigint("etf_employer_cents", { mode: "number" })
    .notNull()
    .default(0),
  payeCents: bigint("paye_cents", { mode: "number" }).notNull().default(0),

  // Derived totals
  grossCents: bigint("gross_cents", { mode: "number" }).notNull().default(0),
  totalDeductionsCents: bigint("total_deductions_cents", { mode: "number" })
    .notNull()
    .default(0),
  netPayableCents: bigint("net_payable_cents", { mode: "number" })
    .notNull()
    .default(0),

  linesSnapshot: jsonb("lines_snapshot")
    .$type<FinalSettlementLine[]>()
    .notNull()
    .default([]),

  status: varchar("status", { length: 16 }).notNull().default("draft"),
  notes: text("notes"),

  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postedByUserId: uuid("posted_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, {
    onDelete: "set null",
  }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidByUserId: uuid("paid_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  paymentJournalId: uuid("payment_journal_id").references(
    () => journalEntries.id,
    { onDelete: "set null" },
  ),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),

  // Approval engine linkage (roadmap #43e). Non-null iff the
  // settlement is owned by the generic engine (parked in
  // `pending_approval`). Cleared on reject / cancel back to draft.
  approvalRequestId: uuid("approval_request_id"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
});

export type FinalSettlement = typeof finalSettlements.$inferSelect;
export type NewFinalSettlement = typeof finalSettlements.$inferInsert;

// Shape of each line inside `linesSnapshot`. Kept simple so the UI can
// render without knowing the flat columns.
export interface FinalSettlementLine {
  code: string; // e.g. "PRO-RATA", "LEAVE-ENC", "GRATUITY", "NOTICE-LIEU", "LOAN-REC", "PAYE"
  name: string; // Display label
  kind: "earning" | "deduction" | "statutory";
  amountCents: number;
  // Free-form breakdown for richer tooltips (days count, formula, etc.)
  meta?: Record<string, unknown>;
}
