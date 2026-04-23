import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  bigint,
  numeric,
  date,
  smallint,
  boolean,
  text,
  integer,
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
  // Batch / serial quick-access pointers (roadmap #34). Set on
  // single-batch / single-serial movements; null when the movement
  // spans multiple batches (the allocations table is authoritative).
  // Typed as plain uuid here to avoid a circular import with
  // `item-batches` / `item-serials`.
  batchId: uuid("batch_id"),
  serialId: uuid("serial_id"),
  memo: varchar("memo", { length: 500 }),
  postedByUserId: uuid("posted_by_user_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StockLedgerEntry = typeof stockLedger.$inferSelect;
export type NewStockLedgerEntry = typeof stockLedger.$inferInsert;

export const stockTransfers = pgTable("stock_transfers", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  transferNumber: varchar("transfer_number", { length: 48 }),
  sourceWarehouseId: uuid("source_warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
  destinationWarehouseId: uuid("destination_warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  requestedDate: date("requested_date").notNull(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),
  dispatchedByUserId: uuid("dispatched_by_user_id"),
  receivedByUserId: uuid("received_by_user_id"),
  notes: text("notes"),
  hasDiscrepancy: boolean("has_discrepancy").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type StockTransfer = typeof stockTransfers.$inferSelect;
export type NewStockTransfer = typeof stockTransfers.$inferInsert;

export const stockTransferLines = pgTable("stock_transfer_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  transferId: uuid("transfer_id").notNull().references(() => stockTransfers.id, { onDelete: "cascade" }),
  lineNo: smallint("line_no").notNull(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "restrict" }),
  quantityRequested: numeric("quantity_requested", { precision: 18, scale: 4 }).notNull(),
  quantityDispatched: numeric("quantity_dispatched", { precision: 18, scale: 4 }),
  quantityReceived: numeric("quantity_received", { precision: 18, scale: 4 }),
  unitCostCentsAtDispatch: bigint("unit_cost_cents_at_dispatch", { mode: "number" }),
  notes: varchar("notes", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StockTransferLine = typeof stockTransferLines.$inferSelect;
export type NewStockTransferLine = typeof stockTransferLines.$inferInsert;

// ---------------------------------------------------------------------------
// Stock counts (physical count / cycle count)
// ---------------------------------------------------------------------------
export const stockCounts = pgTable("stock_counts", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  countNumber: varchar("count_number", { length: 48 }),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
  scopeType: varchar("scope_type", { length: 16 }).notNull().default("warehouse"),
  countDate: date("count_date").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  blindCount: boolean("blind_count").notNull().default(true),
  varianceThresholdBps: integer("variance_threshold_bps").notNull().default(100),
  maxVarianceBps: integer("max_variance_bps"),
  totalVarianceValueCents: bigint("total_variance_value_cents", { mode: "number" }),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  countedAt: timestamp("counted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postedByUserId: uuid("posted_by_user_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByUserId: uuid("approved_by_user_id"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type StockCount = typeof stockCounts.$inferSelect;
export type NewStockCount = typeof stockCounts.$inferInsert;

export const stockCountLines = pgTable("stock_count_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  stockCountId: uuid("stock_count_id").notNull().references(() => stockCounts.id, { onDelete: "cascade" }),
  lineNo: smallint("line_no").notNull(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "restrict" }),
  systemQty: numeric("system_qty", { precision: 18, scale: 4 }).notNull(),
  systemAvgCostCents: bigint("system_avg_cost_cents", { mode: "number" }).notNull(),
  countedQty: numeric("counted_qty", { precision: 18, scale: 4 }),
  varianceQty: numeric("variance_qty", { precision: 18, scale: 4 }),
  varianceValueCents: bigint("variance_value_cents", { mode: "number" }),
  reasonCode: varchar("reason_code", { length: 32 }),
  notes: varchar("notes", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StockCountLine = typeof stockCountLines.$inferSelect;
export type NewStockCountLine = typeof stockCountLines.$inferInsert;
