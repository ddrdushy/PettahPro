import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  timestamp,
  date,
  bigint,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";
import { pettyCashFloats } from "./petty-cash-floats.js";
import { pettyCashTransactions } from "./petty-cash-transactions.js";

// Petty Cash reconciliation (roadmap #38). One EOD record per float
// per day, enforced by a partial unique index in the migration.
//
// Computes expected close = opening + movements_in − movements_out
// from the txn ledger since the previous recon (or float open if
// first). Variance = counted − expected. Non-zero variance posts a
// variance_short / variance_over txn to 5190 Cash Over/Short and the
// txn id is stamped here via `variance_transaction_id`.
//
// Reconciliation freezes its window: transactions dated on or before
// `recon_date` on the same float can't be posted or voided after a
// recon for that day exists. Enforced at the API layer.
export const pettyCashReconciliations = pgTable(
  "petty_cash_reconciliations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pettyCashFloatId: uuid("petty_cash_float_id")
      .notNull()
      .references(() => pettyCashFloats.id, { onDelete: "restrict" }),
    reconDate: date("recon_date").notNull(),
    openingBalanceCents: bigint("opening_balance_cents", {
      mode: "number",
    }).notNull(),
    movementsInCents: bigint("movements_in_cents", { mode: "number" })
      .notNull()
      .default(0),
    movementsOutCents: bigint("movements_out_cents", { mode: "number" })
      .notNull()
      .default(0),
    expectedCloseCents: bigint("expected_close_cents", {
      mode: "number",
    }).notNull(),
    countedCents: bigint("counted_cents", { mode: "number" }).notNull(),
    varianceCents: bigint("variance_cents", { mode: "number" }).notNull(),
    varianceReason: text("variance_reason"),
    varianceTransactionId: uuid("variance_transaction_id").references(
      () => pettyCashTransactions.id,
      { onDelete: "set null" },
    ),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reconciledByUserId: uuid("reconciled_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type PettyCashReconciliation =
  typeof pettyCashReconciliations.$inferSelect;
export type NewPettyCashReconciliation =
  typeof pettyCashReconciliations.$inferInsert;
