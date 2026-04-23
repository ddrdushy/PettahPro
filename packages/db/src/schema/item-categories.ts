import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  integer,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * Unlimited-depth item category tree (inventory-module-spec §2.4,
 * roadmap #36). Each row can carry defaults that items inherit when
 * assigned — resolved by walking the parent chain via the
 * `item_category_effective_defaults(uuid)` helper in SQL.
 *
 * Cycle prevention + same-tenant parent check live in a DB trigger
 * (migration 65), so the app doesn't need to duplicate that guard.
 */
export const itemCategories = pgTable("item_categories", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => itemCategories.id, {
    onDelete: "restrict",
  }),

  name: varchar("name", { length: 128 }).notNull(),
  codePrefix: varchar("code_prefix", { length: 16 }),

  // All nullable → "unset = inherit from ancestor."
  defaultValuationMethod: varchar("default_valuation_method", { length: 16 }),
  defaultTaxCodeId: uuid("default_tax_code_id"),
  defaultIncomeAccountId: uuid("default_income_account_id"),
  defaultExpenseAccountId: uuid("default_expense_account_id"),
  defaultAssetAccountId: uuid("default_asset_account_id"),
  defaultReorderPoint: integer("default_reorder_point"),

  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ItemCategory = typeof itemCategories.$inferSelect;
export type NewItemCategory = typeof itemCategories.$inferInsert;
