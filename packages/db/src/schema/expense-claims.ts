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
import { employees } from "./employees.js";
import { chartOfAccounts } from "./accounts.js";
import { journalEntries } from "./journals.js";

// Expense category library (payroll-module-spec §8). Seeded with five
// SL-typical defaults (travel, meal, fuel, communication, misc); tenants
// can add more or toggle the seeded ones active/inactive. Each row maps
// to a GL account so the claim's journal posts to the right place; the
// is_taxable flag decides whether a payroll-bundled reimbursement counts
// toward EPF/ETF/PAYE.
export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 32 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  expenseAccountId: uuid("expense_account_id").references(() => chartOfAccounts.id, { onDelete: "set null" }),
  isTaxable: boolean("is_taxable").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type NewExpenseCategory = typeof expenseCategories.$inferInsert;


// Expense claim header. draft → submitted → approved | rejected → paid.
// Two disbursement paths: 'direct' books DR <category account> / CR <bank>
// at approve-and-pay time; 'payroll' leaves the claim 'approved' for the
// next payroll run to claim atomically via applied_in_run_id.
export const expenseClaims = pgTable("expense_claims", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  claimNumber: varchar("claim_number", { length: 32 }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "restrict" }),
  categoryId: uuid("category_id").references(() => expenseCategories.id, { onDelete: "set null" }),
  categoryName: varchar("category_name", { length: 128 }),
  expenseAccountId: uuid("expense_account_id").references(() => chartOfAccounts.id, { onDelete: "set null" }),
  claimDate: date("claim_date").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  description: text("description"),
  receiptRef: text("receipt_ref"),
  disbursementMethod: varchar("disbursement_method", { length: 16 }).notNull().default("direct"),
  isTaxable: boolean("is_taxable").notNull().default(false),

  status: varchar("status", { length: 16 }).notNull().default("draft"),

  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  submittedByUserId: uuid("submitted_by_user_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByUserId: uuid("approved_by_user_id"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectedByUserId: uuid("rejected_by_user_id"),
  rejectionReason: text("rejection_reason"),

  // Direct-pay path
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidByUserId: uuid("paid_by_user_id"),
  paymentAccountId: uuid("payment_account_id").references(() => chartOfAccounts.id, { onDelete: "set null" }),
  paymentJournalId: uuid("payment_journal_id").references(() => journalEntries.id, { onDelete: "set null" }),
  paymentDate: date("payment_date"),
  paymentReference: varchar("payment_reference", { length: 64 }),

  // Payroll-bundling path (populated when payroll compute claims the row)
  appliedInRunId: uuid("applied_in_run_id"),
  appliedInRunLineId: uuid("applied_in_run_line_id"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),

  voidAt: timestamp("void_at", { withTimezone: true }),
  voidReason: text("void_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ExpenseClaim = typeof expenseClaims.$inferSelect;
export type NewExpenseClaim = typeof expenseClaims.$inferInsert;
