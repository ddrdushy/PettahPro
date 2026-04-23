import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  numeric,
  bigint,
  date,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { items } from "./items.js";
import { warehouses } from "./warehouses.js";
import { suppliers } from "./suppliers.js";

// Batches / lots for batch- or expiry-tracked items (roadmap #34).
// One row per inbound lot. remaining_qty floats as outbound movements
// consume it; original_qty is immutable audit. FIFO consumption
// orders by expiry_date (nulls last) then received_at ascending — see
// `item_batches_fifo_idx` in 78-batch-serial-expiry.sql.
export const itemBatches = pgTable("item_batches", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "restrict" }),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "restrict" }),
  batchNumber: varchar("batch_number", { length: 64 }).notNull(),
  mfgDate: date("mfg_date"),
  expiryDate: date("expiry_date"),
  originalQty: numeric("original_qty", { precision: 18, scale: 4 }).notNull(),
  remainingQty: numeric("remaining_qty", { precision: 18, scale: 4 }).notNull(),
  unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  sourceDocumentType: varchar("source_document_type", { length: 32 }),
  sourceDocumentId: uuid("source_document_id"),
  sourceLineId: uuid("source_line_id"),
  supplierId: uuid("supplier_id").references(() => suppliers.id, {
    onDelete: "set null",
  }),
  notes: varchar("notes", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ItemBatch = typeof itemBatches.$inferSelect;
export type NewItemBatch = typeof itemBatches.$inferInsert;
