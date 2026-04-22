import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  bigint,
  boolean,
  smallint,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { customers } from "./customers.js";
import { suppliers } from "./suppliers.js";
import { chartOfAccounts } from "./accounts.js";
import { journalEntries } from "./journals.js";
import { customerPayments, type CustomerPayment } from "./payments.js";
import { supplierPayments, type SupplierPayment } from "./supplier-payments.js";

export const cheques = pgTable("cheques", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  direction: varchar("direction", { length: 12 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  chequeNumber: varchar("cheque_number", { length: 32 }).notNull(),
  chequeDate: date("cheque_date").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "restrict" }),
  otherPartyName: varchar("other_party_name", { length: 255 }),
  payeeName: varchar("payee_name", { length: 255 }),
  bankAccountId: uuid("bank_account_id").references(() => chartOfAccounts.id, { onDelete: "set null" }),
  draweeBankName: varchar("drawee_bank_name", { length: 128 }),
  draweeBranchName: varchar("drawee_branch_name", { length: 128 }),
  draweeAccountNumber: varchar("drawee_account_number", { length: 64 }),
  sourcePaymentId: uuid("source_payment_id").references(() => supplierPayments.id, { onDelete: "set null" }),
  sourceReceiptId: uuid("source_receipt_id").references(() => customerPayments.id, { onDelete: "set null" }),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
  depositedAt: timestamp("deposited_at", { withTimezone: true }),
  presentedAt: timestamp("presented_at", { withTimezone: true }),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
  bouncedAt: timestamp("bounced_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  staleAt: date("stale_at"),
  bounceCount: smallint("bounce_count").notNull().default(0),
  lastBounceReason: varchar("last_bounce_reason", { length: 64 }),
  journalEntryIdCreate: uuid("journal_entry_id_create").references(() => journalEntries.id, { onDelete: "set null" }),
  journalEntryIdClear: uuid("journal_entry_id_clear").references(() => journalEntries.id, { onDelete: "set null" }),
  journalEntryIdBounce: uuid("journal_entry_id_bounce").references(() => journalEntries.id, { onDelete: "set null" }),
  legalActionInitiated: boolean("legal_action_initiated").notNull().default(false),
  legalActionInitiatedAt: timestamp("legal_action_initiated_at", { withTimezone: true }),
  legalCaseReference: varchar("legal_case_reference", { length: 64 }),
  replacedByChequeId: uuid("replaced_by_cheque_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  memo: text("memo"),
});

export type Cheque = typeof cheques.$inferSelect;
export type NewCheque = typeof cheques.$inferInsert;

export const chequeBounceEvents = pgTable("cheque_bounce_events", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  chequeId: uuid("cheque_id").notNull().references(() => cheques.id, { onDelete: "cascade" }),
  bounceNumber: smallint("bounce_number").notNull(),
  bouncedAt: timestamp("bounced_at", { withTimezone: true }).notNull().defaultNow(),
  reasonCode: varchar("reason_code", { length: 32 }).notNull(),
  reasonDetails: text("reason_details"),
  bankChargesCents: bigint("bank_charges_cents", { mode: "number" }).notNull().default(0),
  bankChargesAccountId: uuid("bank_charges_account_id").references(() => chartOfAccounts.id, {
    onDelete: "set null",
  }),
  customerNotifiedAt: timestamp("customer_notified_at", { withTimezone: true }),
  notificationChannel: varchar("notification_channel", { length: 32 }),
  rePresented: boolean("re_presented").notNull().default(false),
  rePresentedAt: timestamp("re_presented_at", { withTimezone: true }),
  reversalJournalEntryId: uuid("reversal_journal_entry_id").references(() => journalEntries.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
});

export type ChequeBounceEvent = typeof chequeBounceEvents.$inferSelect;
export type NewChequeBounceEvent = typeof chequeBounceEvents.$inferInsert;
