import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  bigint,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { suppliers } from "./suppliers.js";
import { chartOfAccounts } from "./accounts.js";
import { journalEntries } from "./journals.js";
import { bills } from "./bills.js";

export const supplierPayments = pgTable("supplier_payments", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  paymentNumber: varchar("payment_number", { length: 48 }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  paymentDate: date("payment_date").notNull(),
  method: varchar("method", { length: 16 }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  bankAccountId: uuid("bank_account_id")
    .notNull()
    .references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  reference: varchar("reference", { length: 64 }),
  chequeNumber: varchar("cheque_number", { length: 32 }),
  chequeDate: date("cheque_date"),
  memo: text("memo"),
  status: varchar("status", { length: 16 }).notNull().default("posted"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postedByUserId: uuid("posted_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type SupplierPayment = typeof supplierPayments.$inferSelect;
export type NewSupplierPayment = typeof supplierPayments.$inferInsert;

export const billAllocations = pgTable("bill_allocations", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => supplierPayments.id, { onDelete: "cascade" }),
  billId: uuid("bill_id")
    .notNull()
    .references(() => bills.id, { onDelete: "restrict" }),
  allocatedCents: bigint("allocated_cents", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillAllocation = typeof billAllocations.$inferSelect;
export type NewBillAllocation = typeof billAllocations.$inferInsert;
