import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  smallint,
  text,
  numeric,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { suppliers } from "./suppliers.js";
import { branches } from "./branches.js";
import { items } from "./items.js";
import { purchaseOrders } from "./purchase-orders.js";
import { bills } from "./bills.js";

export const grns = pgTable("grns", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  grnNumber: varchar("grn_number", { length: 48 }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "set null" }),
  billId: uuid("bill_id").references(() => bills.id, { onDelete: "set null" }),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  receiptDate: date("receipt_date").notNull(),
  supplierDeliveryNote: varchar("supplier_delivery_note", { length: 64 }),
  receivedByUserId: uuid("received_by_user_id"),
  conditionNotes: text("condition_notes"),
  notes: text("notes"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Grn = typeof grns.$inferSelect;
export type NewGrn = typeof grns.$inferInsert;

export const grnLines = pgTable("grn_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  grnId: uuid("grn_id").notNull().references(() => grns.id, { onDelete: "cascade" }),
  lineNo: smallint("line_no").notNull(),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  description: varchar("description", { length: 500 }).notNull(),
  quantityOrdered: numeric("quantity_ordered", { precision: 18, scale: 4 }),
  quantityReceived: numeric("quantity_received", { precision: 18, scale: 4 }).notNull(),
  lineNotes: varchar("line_notes", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GrnLine = typeof grnLines.$inferSelect;
export type NewGrnLine = typeof grnLines.$inferInsert;
