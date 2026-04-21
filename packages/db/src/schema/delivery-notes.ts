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
import { customers } from "./customers.js";
import { branches } from "./branches.js";
import { items } from "./items.js";
import { salesOrders } from "./sales-orders.js";
import { invoices } from "./invoices.js";

export const deliveryNotes = pgTable("delivery_notes", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  dnNumber: varchar("dn_number", { length: 48 }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  salesOrderId: uuid("sales_order_id").references(() => salesOrders.id, { onDelete: "set null" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  deliveryDate: date("delivery_date").notNull(),
  shippingAddressLine1: varchar("shipping_address_line1", { length: 255 }),
  shippingAddressLine2: varchar("shipping_address_line2", { length: 255 }),
  shippingCity: varchar("shipping_city", { length: 128 }),
  shippingPostalCode: varchar("shipping_postal_code", { length: 16 }),
  carrier: varchar("carrier", { length: 128 }),
  trackingNumber: varchar("tracking_number", { length: 64 }),
  receivedByName: varchar("received_by_name", { length: 128 }),
  notes: text("notes"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type DeliveryNote = typeof deliveryNotes.$inferSelect;
export type NewDeliveryNote = typeof deliveryNotes.$inferInsert;

export const deliveryNoteLines = pgTable("delivery_note_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  deliveryNoteId: uuid("delivery_note_id").notNull().references(() => deliveryNotes.id, { onDelete: "cascade" }),
  lineNo: smallint("line_no").notNull(),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeliveryNoteLine = typeof deliveryNoteLines.$inferSelect;
export type NewDeliveryNoteLine = typeof deliveryNoteLines.$inferInsert;
