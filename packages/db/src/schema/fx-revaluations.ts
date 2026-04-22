import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  numeric,
  bigint,
  jsonb,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { journalEntries } from "./journals.js";

// FX revaluation at period close (roadmap #44).
//
// Re-measures open foreign-currency AR (invoices) and AP (bills) to the
// closing rate at `as_of_date` and books the delta to Unrealized FX
// gain/loss (4510 / 5510). Incremental-delta semantics: each run stores
// the cumulative delta per document vs issue rate and the previous posted
// run's cumulative — only the *incremental* change hits the GL, so each
// new run naturally supersedes the prior without a month-start reversal.
//
// See docker/postgres/init/56-fx-revaluation.sql for the full design doc.
export const fxRevaluations = pgTable("fx_revaluations", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  asOfDate: date("as_of_date").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  arGainCents: bigint("ar_gain_cents", { mode: "number" }).notNull().default(0),
  arLossCents: bigint("ar_loss_cents", { mode: "number" }).notNull().default(0),
  apGainCents: bigint("ap_gain_cents", { mode: "number" }).notNull().default(0),
  apLossCents: bigint("ap_loss_cents", { mode: "number" }).notNull().default(0),
  currencySummary: jsonb("currency_summary")
    .$type<Record<string, { openForeign: number; openLkr: number; asOfRate: number; deltaLkr: number }>>()
    .notNull()
    .default({}),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
  voidJournalEntryId: uuid("void_journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postedByUserId: uuid("posted_by_user_id"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedByUserId: uuid("voided_by_user_id"),
  voidReason: text("void_reason"),
});

export type FxRevaluation = typeof fxRevaluations.$inferSelect;
export type NewFxRevaluation = typeof fxRevaluations.$inferInsert;

export const fxRevaluationLines = pgTable("fx_revaluation_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  revaluationId: uuid("revaluation_id")
    .notNull()
    .references(() => fxRevaluations.id, { onDelete: "cascade" }),
  sourceType: varchar("source_type", { length: 16 }).notNull(),
  sourceId: uuid("source_id").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  issueFxRate: numeric("issue_fx_rate", { precision: 18, scale: 6 }).notNull(),
  foreignOutstandingCents: bigint("foreign_outstanding_cents", { mode: "number" }).notNull(),
  lkrOnLedgerCents: bigint("lkr_on_ledger_cents", { mode: "number" }).notNull(),
  asOfRate: numeric("as_of_rate", { precision: 18, scale: 6 }).notNull(),
  lkrAtAsOfCents: bigint("lkr_at_as_of_cents", { mode: "number" }).notNull(),
  cumulativeDeltaCents: bigint("cumulative_delta_cents", { mode: "number" }).notNull(),
  previousCumulativeDeltaCents: bigint("previous_cumulative_delta_cents", { mode: "number" }).notNull().default(0),
  incrementalDeltaCents: bigint("incremental_delta_cents", { mode: "number" }).notNull(),
  direction: varchar("direction", { length: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FxRevaluationLine = typeof fxRevaluationLines.$inferSelect;
export type NewFxRevaluationLine = typeof fxRevaluationLines.$inferInsert;
