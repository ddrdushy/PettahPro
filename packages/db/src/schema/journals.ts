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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JournalLine = typeof journalLines.$inferSelect;
export type NewJournalLine = typeof journalLines.$inferInsert;
