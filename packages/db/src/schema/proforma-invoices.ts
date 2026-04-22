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
import { customers } from "./customers.js";
import { branches } from "./branches.js";
import { items } from "./items.js";
import { taxCodes, chartOfAccounts } from "./accounts.js";
import { invoices } from "./invoices.js";

export const proformaInvoices = pgTable("proforma_invoices", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  proformaNumber: varchar("proforma_number", { length: 48 }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  issueDate: date("issue_date").notNull(),
  validUntil: date("valid_until").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
  discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
  totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
  reference: varchar("reference", { length: 64 }),
  notes: text("notes"),
  terms: text("terms"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  convertedInvoiceId: uuid("converted_invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ProformaInvoice = typeof proformaInvoices.$inferSelect;
export type NewProformaInvoice = typeof proformaInvoices.$inferInsert;

export const proformaInvoiceLines = pgTable("proforma_invoice_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  proformaInvoiceId: uuid("proforma_invoice_id")
    .notNull()
    .references(() => proformaInvoices.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProformaInvoiceLine = typeof proformaInvoiceLines.$inferSelect;
export type NewProformaInvoiceLine = typeof proformaInvoiceLines.$inferInsert;
