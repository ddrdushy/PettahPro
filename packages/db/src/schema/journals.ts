import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  date,
  smallint,
  bigint,
  text,
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { fiscalPeriods, chartOfAccounts } from "./accounts.js";

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  entryNumber: varchar("entry_number", { length: 48 }).notNull(),
  entryDate: date("entry_date").notNull(),
  fiscalPeriodId: uuid("fiscal_period_id").references(() => fiscalPeriods.id, { onDelete: "set null" }),
  memo: text("memo"),
  sourceType: varchar("source_type", { length: 32 }),
  sourceId: uuid("source_id"),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
  postedByUserId: uuid("posted_by_user_id"),
  isReversed: boolean("is_reversed").notNull().default(false),
  reversedByEntryId: uuid("reversed_by_entry_id"),
  // Cost center dimension (#132 / gaps B1 follow-up). Header-level
  // tag for manual JEs; auto-posts (invoice/bill/etc.) use the
  // source doc's cost_center_id directly on lines and leave this
  // null. The post helper folds this into every line on entries
  // where it's set.
  costCenterId: uuid("cost_center_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JournalEntry = typeof journalEntries.$inferSelect;
export type NewJournalEntry = typeof journalEntries.$inferInsert;

export const journalLines = pgTable("journal_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  journalEntryId: uuid("journal_entry_id")
    .notNull()
    .references(() => journalEntries.id, { onDelete: "cascade" }),
  lineNo: smallint("line_no").notNull(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  drCents: bigint("dr_cents", { mode: "number" }).notNull().default(0),
  crCents: bigint("cr_cents", { mode: "number" }).notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  description: varchar("description", { length: 500 }),
  customerId: uuid("customer_id"),
  supplierId: uuid("supplier_id"),
  itemId: uuid("item_id"),
  // Dimension tag for cost-center reporting (#129 / gaps B1).
  // Nullable — pre-#129 lines stay null and roll up under
  // "Unassigned" in the P&L cost-center filter. Stamped by post
  // helpers when the source document has a cost_center_id (v1:
  // invoices only; bills/payroll/payments are follow-ups).
  costCenterId: uuid("cost_center_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JournalLine = typeof journalLines.$inferSelect;
export type NewJournalLine = typeof journalLines.$inferInsert;

export interface JournalDraftLine {
  accountId: string;
  drCents: number;
  crCents: number;
  description?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  // Cost center dimension (#129 / gaps B1). Optional — when omitted,
  // the line lands with cost_center_id NULL and rolls up under
  // "Unassigned" in the P&L cost-center filter.
  costCenterId?: string | null;
}

export const journalEntryDrafts = pgTable("journal_entry_drafts", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  entryDate: date("entry_date").notNull(),
  memo: text("memo"),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  payload: jsonb("payload").$type<{ lines: JournalDraftLine[] }>().notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending_approval"),
  createdByUserId: uuid("created_by_user_id"),
  approvedByUserId: uuid("approved_by_user_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedByUserId: uuid("rejected_by_user_id"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  postedJournalEntryId: uuid("posted_journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
  // Link to approval_requests when the draft was created via the
  // policy-driven engine path (PR #74 / roadmap #43). Null when the
  // legacy flat-threshold path created the draft — both paths coexist
  // until every tenant has designed a journal_entry policy.
  approvalRequestId: uuid("approval_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JournalEntryDraft = typeof journalEntryDrafts.$inferSelect;
export type NewJournalEntryDraft = typeof journalEntryDrafts.$inferInsert;
