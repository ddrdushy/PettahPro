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
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { customers } from "./customers.js";
import { branches } from "./branches.js";
import { items } from "./items.js";
import { taxCodes, chartOfAccounts } from "./accounts.js";
import { journalEntries } from "./journals.js";

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  invoiceNumber: varchar("invoice_number", { length: 48 }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  fxRate: numeric("fx_rate", { precision: 18, scale: 6 }).notNull().default("1.0"),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
  discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
  totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
  foreignTotalCents: bigint("foreign_total_cents", { mode: "number" }),
  amountPaidCents: bigint("amount_paid_cents", { mode: "number" }).notNull().default(0),
  balanceDueCents: bigint("balance_due_cents", { mode: "number" }).notNull().default(0),
  reference: varchar("reference", { length: 64 }),
  poNumber: varchar("po_number", { length: 64 }),
  notes: text("notes"),
  terms: text("terms"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postedByUserId: uuid("posted_by_user_id"),
  writtenOffAt: timestamp("written_off_at", { withTimezone: true }),
  writeoffReason: text("writeoff_reason"),
  writeoffJournalEntryId: uuid("writeoff_journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
  writeoffVatReliefCents: bigint("writeoff_vat_relief_cents", { mode: "number" }).notNull().default(0),
  writeoffPrincipalCents: bigint("writeoff_principal_cents", { mode: "number" }).notNull().default(0),
  channel: varchar("channel", { length: 16 }).notNull().default("web"),
  salespersonUserId: uuid("salesperson_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
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
  incomeAccountId: uuid("income_account_id").references(() => chartOfAccounts.id, { onDelete: "set null" }),
  // Batch / serial outbound picks captured at draft time and
  // consumed at post (roadmap #34). Shape:
  // { serialNumbers[], batchPicks: [{batchId, quantity}] }.
  trackingInput: jsonb("tracking_input").$type<{
    serialNumbers?: string[];
    batchPicks?: Array<{ batchId: string; quantity: number }>;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type NewInvoiceLine = typeof invoiceLines.$inferInsert;
