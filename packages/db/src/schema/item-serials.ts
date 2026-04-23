import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  bigint,
  date,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { items } from "./items.js";
import { warehouses } from "./warehouses.js";
import { suppliers } from "./suppliers.js";
import { customers } from "./customers.js";
import { itemBatches } from "./item-batches.js";

// Serial-tracked units (roadmap #34). One row per physical unit of a
// serial-tracked item. State machine:
//   in_stock → sold (issued on an invoice)
//   sold → returned (credit note; deferred to follow-up)
//   in_stock → scrapped (stock count variance / damage)
// See `docker/postgres/init/78-batch-serial-expiry.sql` for full
// design rationale.
export const itemSerials = pgTable("item_serials", {
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
  serialNumber: varchar("serial_number", { length: 128 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("in_stock"),
  batchId: uuid("batch_id").references(() => itemBatches.id, {
    onDelete: "set null",
  }),
  unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
  acquiredDocumentType: varchar("acquired_document_type", { length: 32 }),
  acquiredDocumentId: uuid("acquired_document_id"),
  acquiredLineId: uuid("acquired_line_id"),
  acquiredAt: timestamp("acquired_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  supplierId: uuid("supplier_id").references(() => suppliers.id, {
    onDelete: "set null",
  }),
  soldDocumentType: varchar("sold_document_type", { length: 32 }),
  soldDocumentId: uuid("sold_document_id"),
  soldLineId: uuid("sold_line_id"),
  soldCustomerId: uuid("sold_customer_id").references(() => customers.id, {
    onDelete: "set null",
  }),
  soldAt: timestamp("sold_at", { withTimezone: true }),
  warrantyExpiresAt: date("warranty_expires_at"),
  notes: varchar("notes", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ItemSerial = typeof itemSerials.$inferSelect;
export type NewItemSerial = typeof itemSerials.$inferInsert;
