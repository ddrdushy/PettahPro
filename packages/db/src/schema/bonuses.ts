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

// Bonus scheme library — tenant-configured programs (Avurudu, Christmas,
// 13th-month, performance, etc). A scheme carries the formula (how the
// per-employee amount is seeded), eligibility constraints, and tax
// treatment flags. See payroll-module-spec §7.1 / §7.2.
//
// formula_type values:
//   flat_amount      — formula_value cents flat per eligible employee
//   percent_of_basic — formula_value bps × basic / 10_000
//   days_of_basic    — formula_value × (basic / 30) — e.g. 15 days = half-month
//   manual           — seeded at 0; HR enters per employee before post
export const bonusSchemes = pgTable("bonus_schemes", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 32 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  formulaType: varchar("formula_type", { length: 24 }).notNull(),
  formulaValue: bigint("formula_value", { mode: "number" }),
  eligibilityMinTenureDays: integer("eligibility_min_tenure_days").notNull().default(0),
  eligibilityEmploymentTypes: text("eligibility_employment_types")
    .array()
    .notNull()
    .default(sql`ARRAY['permanent']::text[]`),
  eligibilityStatuses: text("eligibility_statuses")
    .array()
    .notNull()
    .default(sql`ARRAY['active','confirmed','on_probation']::text[]`),
  countsForEpf: boolean("counts_for_epf").notNull().default(false),
  countsForEtf: boolean("counts_for_etf").notNull().default(false),
  countsForPaye: boolean("counts_for_paye").notNull().default(true),
  expenseAccountId: uuid("expense_account_id").references(() => chartOfAccounts.id, {
    onDelete: "set null",
  }),
  isActive: boolean("is_active").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type BonusScheme = typeof bonusSchemes.$inferSelect;
export type NewBonusScheme = typeof bonusSchemes.$inferInsert;


// Bonus run — one row per bulk bonus execution. Moves draft → posted →
// void. Post books the JE (DR Salaries & wages / CR Salaries payable /
// CR PAYE / CR EPF (+ employer DR + CR for EPF/ETF)).
export const bonusRuns = pgTable("bonus_runs", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  schemeId: uuid("scheme_id").notNull().references(() => bonusSchemes.id, { onDelete: "restrict" }),
  runNumber: varchar("run_number", { length: 48 }),
  label: varchar("label", { length: 128 }).notNull(),
  payDate: date("pay_date").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  employeeCount: integer("employee_count").notNull().default(0),
  grossCents: bigint("gross_cents", { mode: "number" }).notNull().default(0),
  epfEmployeeCents: bigint("epf_employee_cents", { mode: "number" }).notNull().default(0),
  epfEmployerCents: bigint("epf_employer_cents", { mode: "number" }).notNull().default(0),
  etfEmployerCents: bigint("etf_employer_cents", { mode: "number" }).notNull().default(0),
  payeCents: bigint("paye_cents", { mode: "number" }).notNull().default(0),
  netPayCents: bigint("net_pay_cents", { mode: "number" }).notNull().default(0),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, {
    onDelete: "set null",
  }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postedByUserId: uuid("posted_by_user_id"),
  voidReason: text("void_reason"),
  voidAt: timestamp("void_at", { withTimezone: true }),
  voidByUserId: uuid("void_by_user_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // Approval engine linkage (roadmap #43d). Non-null iff the run is
  // owned by the generic engine (parked in `pending_approval`).
  approvalRequestId: uuid("approval_request_id"),
});

export type BonusRun = typeof bonusRuns.$inferSelect;
export type NewBonusRun = typeof bonusRuns.$inferInsert;


// Per-employee bonus snapshot. Computed from scheme formula on create,
// optionally manually adjusted before post.
export const bonusRunLines = pgTable("bonus_run_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => bonusRuns.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, {
    onDelete: "restrict",
  }),
  employeeFullName: varchar("employee_full_name", { length: 255 }).notNull(),
  employeeCode: varchar("employee_code", { length: 32 }),
  nic: varchar("nic", { length: 20 }),
  epfNumber: varchar("epf_number", { length: 30 }),
  etfNumber: varchar("etf_number", { length: 30 }),
  designation: varchar("designation", { length: 128 }),
  department: varchar("department", { length: 128 }),
  basicAtRunCents: bigint("basic_at_run_cents", { mode: "number" }).notNull(),
  bonusGrossCents: bigint("bonus_gross_cents", { mode: "number" }).notNull().default(0),
  epfEmployeeCents: bigint("epf_employee_cents", { mode: "number" }).notNull().default(0),
  epfEmployerCents: bigint("epf_employer_cents", { mode: "number" }).notNull().default(0),
  etfEmployerCents: bigint("etf_employer_cents", { mode: "number" }).notNull().default(0),
  payeCents: bigint("paye_cents", { mode: "number" }).notNull().default(0),
  netPayCents: bigint("net_pay_cents", { mode: "number" }).notNull().default(0),
  wasManuallyAdjusted: boolean("was_manually_adjusted").notNull().default(false),
  wasEpfApplied: boolean("was_epf_applied").notNull().default(false),
  wasEtfApplied: boolean("was_etf_applied").notNull().default(false),
  wasPayeApplied: boolean("was_paye_applied").notNull().default(false),
  bankName: varchar("bank_name", { length: 128 }),
  bankAccountNo: varchar("bank_account_no", { length: 64 }),
  bankBranch: varchar("bank_branch", { length: 128 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BonusRunLine = typeof bonusRunLines.$inferSelect;
export type NewBonusRunLine = typeof bonusRunLines.$inferInsert;
