import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  smallint,
  bigint,
  integer,
  text,
  numeric,
  boolean,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { suppliers } from "./suppliers.js";
import { branches } from "./branches.js";
import { items } from "./items.js";
import { taxCodes, chartOfAccounts } from "./accounts.js";
import { bills } from "./bills.js";

export const recurringBills = pgTable("recurring_bills", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  scheduleName: varchar("schedule_name", { length: 200 }).notNull(),
  frequency: varchar("frequency", { length: 16 }).notNull().default("monthly"),
  dayOfMonth: smallint("day_of_month").notNull().default(1),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  nextRunDate: date("next_run_date").notNull(),
  lastRunDate: date("last_run_date"),
  dueDays: integer("due_days").notNull().default(30),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  supplierBillNumberTemplate: varchar("supplier_bill_number_template", { length: 128 }),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  generatedCount: integer("generated_count").notNull().default(0),
  lastGeneratedBillId: uuid("last_generated_bill_id").references(() => bills.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type RecurringBill = typeof recurringBills.$inferSelect;
export type NewRecurringBill = typeof recurringBills.$inferInsert;

export const recurringBillLines = pgTable("recurring_bill_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  recurringBillId: uuid("recurring_bill_id")
    .notNull()
    .references(() => recurringBills.id, { onDelete: "cascade" }),
  lineNo: smallint("line_no").notNull(),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("1"),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull().default(0),
  discountPctBps: integer("discount_pct_bps").notNull().default(0),
  taxCodeId: uuid("tax_code_id").references(() => taxCodes.id, { onDelete: "set null" }),
  expenseAccountId: uuid("expense_account_id").references(() => chartOfAccounts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RecurringBillLine = typeof recurringBillLines.$inferSelect;
export type NewRecurringBillLine = typeof recurringBillLines.$inferInsert;
