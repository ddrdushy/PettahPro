import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  bigint,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";
import { pettyCashFloats } from "./petty-cash-floats.js";
import { pettyCashTransactions } from "./petty-cash-transactions.js";

// Petty Cash top-up request (roadmap #38). Simple request →
// approve → post workflow: holder requests, someone with
// petty_cash.approve approves, then posts against a caller-chosen
// cash/bank source to create the top_up ledger txn.
//
// No approval-engine integration in v1 — straight permission gate
// (petty_cash.approve). SOD: requester ≠ approver, enforced in the
// API layer. The approval-engine generalisation is a v2 ticket.
export const pettyCashTopUpRequests = pgTable("petty_cash_top_up_requests", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  pettyCashFloatId: uuid("petty_cash_float_id")
    .notNull()
    .references(() => pettyCashFloats.id, { onDelete: "restrict" }),
  requestedAmountCents: bigint("requested_amount_cents", {
    mode: "number",
  }).notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  requestedByUserId: uuid("requested_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  decisionNotes: text("decision_notes"),
  postedTransactionId: uuid("posted_transaction_id").references(
    () => pettyCashTransactions.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PettyCashTopUpRequest =
  typeof pettyCashTopUpRequests.$inferSelect;
export type NewPettyCashTopUpRequest =
  typeof pettyCashTopUpRequests.$inferInsert;

export const PETTY_CASH_TOP_UP_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "posted",
  "cancelled",
] as const;

export type PettyCashTopUpStatus =
  (typeof PETTY_CASH_TOP_UP_STATUSES)[number];
