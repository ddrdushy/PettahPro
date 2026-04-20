import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  integer,
  bigint,
  text,
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const items = pgTable("items", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  sku: varchar("sku", { length: 64 }),
  barcode: varchar("barcode", { length: 64 }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  itemType: varchar("item_type", { length: 16 }).notNull().default("product"),
  unit: varchar("unit", { length: 16 }).notNull().default("unit"),
  sellPriceCents: bigint("sell_price_cents", { mode: "number" }).notNull().default(0),
  buyPriceCents: bigint("buy_price_cents", { mode: "number" }).notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  taxCodeId: uuid("tax_code_id"),
  trackInventory: boolean("track_inventory").notNull().default(true),
  valuationMethod: varchar("valuation_method", { length: 16 }).notNull().default("weighted_avg"),
  reorderPoint: integer("reorder_point"),
  incomeAccountId: uuid("income_account_id"),
  expenseAccountId: uuid("expense_account_id"),
  assetAccountId: uuid("asset_account_id"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
