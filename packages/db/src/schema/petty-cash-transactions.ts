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
import { users } from "./users.js";
import { chartOfAccounts } from "./accounts.js";
import { journalEntries } from "./journals.js";
import { employees } from "./employees.js";
import { pettyCashFloats } from "./petty-cash-floats.js";

// Petty Cash Transaction ledger row (roadmap #38).
//
// One row per movement on a float: expense, staff-advance-out / return,
// top-up post, variance short/over booked at reconciliation time, and
// close-transfer when a float is wound down. `amount_cents` is always
// positive; the sign is derived from `txn_type`. Every row has an
// associated JE (see `journal_entry_id`); voids post a reversing JE
// and set `void_journal_entry_id`.
//
// `reconciliation_id` + `top_up_request_id` FKs are added in SQL via
// ALTER TABLE so the table can be created before the tables they
// reference — Drizzle doesn't surface `.references()` here because
// the schema would cycle otherwise (see migration 75).
export const pettyCashTransactions = pgTable("petty_cash_transactions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  pettyCashFloatId: uuid("petty_cash_float_id")
    .notNull()
    .references(() => pettyCashFloats.id, { onDelete: "restrict" }),
  txnType: varchar("txn_type", { length: 24 }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  txnDate: date("txn_date").notNull(),
  description: text("description").notNull(),
  categoryAccountId: uuid("category_account_id").references(
    () => chartOfAccounts.id,
    { onDelete: "restrict" },
  ),
  counterpartyEmployeeId: uuid("counterparty_employee_id").references(
    () => employees.id,
    { onDelete: "restrict" },
  ),
  counterpartyAccountId: uuid("counterparty_account_id").references(
    () => chartOfAccounts.id,
    { onDelete: "restrict" },
  ),
  receiptNumber: varchar("receipt_number", { length: 64 }),
  journalEntryId: uuid("journal_entry_id")
    .notNull()
    .references(() => journalEntries.id, { onDelete: "restrict" }),
  postedAt: timestamp("posted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  postedByUserId: uuid("posted_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedByUserId: uuid("voided_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  voidReason: text("void_reason"),
  voidJournalEntryId: uuid("void_journal_entry_id").references(
    () => journalEntries.id,
    { onDelete: "set null" },
  ),
  // FKs added via ALTER TABLE in migration 75 to avoid schema cycles.
  reconciliationId: uuid("reconciliation_id"),
  topUpRequestId: uuid("top_up_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PettyCashTransaction = typeof pettyCashTransactions.$inferSelect;
export type NewPettyCashTransaction =
  typeof pettyCashTransactions.$inferInsert;

export const PETTY_CASH_TXN_TYPES = [
  "expense",
  "advance_out",
  "advance_return",
  "top_up",
  "variance_short",
  "variance_over",
  "close_transfer",
] as const;

export type PettyCashTxnType = (typeof PETTY_CASH_TXN_TYPES)[number];
