import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  bigint,
  numeric,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { items } from "./items.js";
import { warehouses } from "./warehouses.js";
import { journalEntries } from "./journals.js";

export const itemBalances = pgTable("item_balances", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "cascade" }),
  quantityOnHand: numeric("quantity_on_hand", { precision: 18, scale: 4 }).notNull().default("0"),
  averageCostCents: bigint("average_cost_cents", { mode: "number" }).notNull().default(0),
  totalValueCents: bigint("total_value_cents", { mode: "number" }).notNull().default(0),
  lastMovementAt: timestamp("last_movement_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ItemBalance = typeof itemBalances.$inferSelect;
export type NewItemBalance = typeof itemBalances.$inferInsert;

export const stockLedger = pgTable("stock_ledger", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "restrict" }),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
  movementType: varchar("movement_type", { length: 24 }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
  totalCostCents: bigint("total_cost_cents", { mode: "number" }).notNull(),
  runningQuantity: numeric("running_quantity", { precision: 18, scale: 4 }).notNull(),
  runningValueCents: bigint("running_value_cents", { mode: "number" }).notNull(),
  runningAvgCostCents: bigint("running_avg_cost_cents", { mode: "number" }).notNull(),
  sourceDocumentType: varchar("source_document_type", { length: 32 }),
  sourceDocumentId: uuid("source_document_id"),
  sourceLineId: uuid("source_line_id"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
  memo: varchar("memo", { length: 500 }),
  postedByUserId: uuid("posted_by_user_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StockLedgerEntry = typeof stockLedger.$inferSelect;
export type NewStockLedgerEntry = typeof stockLedger.$inferInsert;
