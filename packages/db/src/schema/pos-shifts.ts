import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp, bigint, text, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { branches } from "./branches.js";
import { chartOfAccounts } from "./accounts.js";
import { journalEntries } from "./journals.js";

export const posShifts = pgTable("pos_shifts", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  cashierUserId: uuid("cashier_user_id").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("open"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  openingFloatCents: bigint("opening_float_cents", { mode: "number" }).notNull().default(0),
  openingNotes: text("opening_notes"),
  cashAccountId: uuid("cash_account_id").references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedByUserId: uuid("closed_by_user_id"),
  closingDenominations: jsonb("closing_denominations"),
  closingCashCents: bigint("closing_cash_cents", { mode: "number" }),
  expectedCashCents: bigint("expected_cash_cents", { mode: "number" }),
  varianceCents: bigint("variance_cents", { mode: "number" }),
  varianceReasonCode: varchar("variance_reason_code", { length: 32 }),
  varianceReasonNotes: text("variance_reason_notes"),
  varianceJournalEntryId: uuid("variance_journal_entry_id").references(() => journalEntries.id, {
    onDelete: "set null",
  }),
  supervisorSignature: text("supervisor_signature"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PosShift = typeof posShifts.$inferSelect;
export type NewPosShift = typeof posShifts.$inferInsert;
