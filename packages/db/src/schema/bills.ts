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
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { suppliers } from "./suppliers.js";
import { branches } from "./branches.js";
import { items } from "./items.js";
import { taxCodes, chartOfAccounts } from "./accounts.js";
import { journalEntries } from "./journals.js";

export const bills = pgTable("bills", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  internalReference: varchar("internal_reference", { length: 48 }),
  supplierBillNumber: varchar("supplier_bill_number", { length: 64 }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  billDate: date("bill_date").notNull(),
  dueDate: date("due_date").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  fxRate: numeric("fx_rate", { precision: 18, scale: 6 }).notNull().default("1.0"),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
  discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
  chargesTotalCents: bigint("charges_total_cents", { mode: "number" }).notNull().default(0),
  chargeAllocationMethod: varchar("charge_allocation_method", { length: 16 }).notNull().default("value"),
  totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
  amountPaidCents: bigint("amount_paid_cents", { mode: "number" }).notNull().default(0),
  balanceDueCents: bigint("balance_due_cents", { mode: "number" }).notNull().default(0),
  notes: text("notes"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postedByUserId: uuid("posted_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Bill = typeof bills.$inferSelect;
export type NewBill = typeof bills.$inferInsert;

export const billLines = pgTable("bill_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  billId: uuid("bill_id").notNull().references(() => bills.id, { onDelete: "cascade" }),
  lineNo: smallint("line_no").notNull(),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("1"),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull().default(0),
  lineSubtotalCents: bigint("line_subtotal_cents", { mode: "number" }).notNull().default(0),
  discountPctBps: integer("discount_pct_bps").notNull().default(0),
  discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
  taxCodeId: uuid("tax_code_id").references(() => taxCodes.id, { onDelete: "set null" }),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
  lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull().default(0),
  expenseAccountId: uuid("expense_account_id").references(() => chartOfAccounts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillLine = typeof billLines.$inferSelect;
export type NewBillLine = typeof billLines.$inferInsert;

export const billCharges = pgTable("bill_charges", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  billId: uuid("bill_id").notNull().references(() => bills.id, { onDelete: "cascade" }),
  lineNo: smallint("line_no").notNull(),
  kind: varchar("kind", { length: 20 }).notNull(),
  description: varchar("description", { length: 500 }),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillCharge = typeof billCharges.$inferSelect;
export type NewBillCharge = typeof billCharges.$inferInsert;
