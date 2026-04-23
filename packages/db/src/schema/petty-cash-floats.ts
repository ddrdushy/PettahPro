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
import { branches } from "./branches.js";
import { users } from "./users.js";
import { chartOfAccounts } from "./accounts.js";

// Petty Cash Float header (roadmap #38).
//
// Per-branch operational cash float — ceiling, single holder, denormalised
// running balance. See `docker/postgres/init/75-petty-cash.sql` for the
// full design notes; the short version:
//
//   · One active float per (tenant, branch) enforced by a partial unique
//     index in the migration.
//   · `current_balance_cents` is maintained by every txn/top-up/recon
//     in the same DB transaction. API layer is the sole writer.
//   · Holder reassignment = close + open. No in-place holder edit.
export const pettyCashFloats = pgTable("petty_cash_floats", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 120 }).notNull(),
  floatHolderUserId: uuid("float_holder_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  ceilingCents: bigint("ceiling_cents", { mode: "number" }).notNull(),
  currentBalanceCents: bigint("current_balance_cents", { mode: "number" })
    .notNull()
    .default(0),
  pettyCashAccountId: uuid("petty_cash_account_id")
    .notNull()
    .references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  openedAt: timestamp("opened_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  openedByUserId: uuid("opened_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedByUserId: uuid("closed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  closedReason: text("closed_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type PettyCashFloat = typeof pettyCashFloats.$inferSelect;
export type NewPettyCashFloat = typeof pettyCashFloats.$inferInsert;
