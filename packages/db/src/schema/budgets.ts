import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  smallint,
  bigint,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Budgets (#133 / gaps B2). Per-(account, optional cost_center)
 * annual amounts. Budget vs actual report compares actuals (sum of
 * journal_lines) against budgeted amount, prorated to whatever
 * date window the user picks.
 *
 * Status lifecycle: draft → active → archived. Only one active
 * budget per (tenant, fiscal_year) — enforced by a partial unique
 * index in the migration. Drafts and archives don't count.
 */

export const BUDGET_STATUSES = ["draft", "active", "archived"] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    fiscalYear: smallint("fiscal_year").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id"),
  },
  (t) => ({
    tenantYearIdx: index("budgets_tenant_year_idx").on(t.tenantId, t.fiscalYear),
  }),
);

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;

export const budgetLines = pgTable(
  "budget_lines",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    budgetId: uuid("budget_id").notNull(),
    accountId: uuid("account_id").notNull(),
    costCenterId: uuid("cost_center_id"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueCombo: uniqueIndex("budget_lines_unique_combo").on(
      t.budgetId,
      t.accountId,
      t.costCenterId,
    ),
    budgetIdx: index("budget_lines_budget_idx").on(t.budgetId),
  }),
);

export type BudgetLine = typeof budgetLines.$inferSelect;
export type NewBudgetLine = typeof budgetLines.$inferInsert;
