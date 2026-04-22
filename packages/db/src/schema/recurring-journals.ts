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
  boolean,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { chartOfAccounts } from "./accounts.js";
import { customers } from "./customers.js";
import { suppliers } from "./suppliers.js";

export const recurringJournals = pgTable("recurring_journals", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  scheduleName: varchar("schedule_name", { length: 200 }).notNull(),
  frequency: varchar("frequency", { length: 16 }).notNull().default("monthly"),
  dayOfMonth: smallint("day_of_month").notNull().default(1),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  nextRunDate: date("next_run_date").notNull(),
  lastRunDate: date("last_run_date"),
  autoPost: boolean("auto_post").notNull().default(false),
  memoTemplate: varchar("memo_template", { length: 500 }),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  generatedCount: integer("generated_count").notNull().default(0),
  lastGeneratedEntryId: uuid("last_generated_entry_id"),
  lastGeneratedDraftId: uuid("last_generated_draft_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type RecurringJournal = typeof recurringJournals.$inferSelect;
export type NewRecurringJournal = typeof recurringJournals.$inferInsert;

export const recurringJournalLines = pgTable("recurring_journal_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  recurringJournalId: uuid("recurring_journal_id")
    .notNull()
    .references(() => recurringJournals.id, { onDelete: "cascade" }),
  lineNo: smallint("line_no").notNull(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  drCents: bigint("dr_cents", { mode: "number" }).notNull().default(0),
  crCents: bigint("cr_cents", { mode: "number" }).notNull().default(0),
  description: varchar("description", { length: 500 }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RecurringJournalLine = typeof recurringJournalLines.$inferSelect;
export type NewRecurringJournalLine = typeof recurringJournalLines.$inferInsert;
