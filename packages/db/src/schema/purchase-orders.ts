import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  smallint,
  bigint,
  integer,
  text,
  numeric,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { suppliers } from "./suppliers.js";
import { branches } from "./branches.js";
import { items } from "./items.js";
import { taxCodes, chartOfAccounts } from "./accounts.js";
import { bills } from "./bills.js";

// PO lifecycle: `draft → [pending_approval] → sent → acknowledged →
// converted` (with `cancelled` terminal from most points). The
// `pending_approval` state is only reached when a matching
// `document_type='purchase_order'` approval policy exists — see
// apps/api/.../approval-engine.ts and migration 69
// (69-approval-engine-purchase-orders.sql).
export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  poNumber: varchar("po_number", { length: 48 }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  orderDate: date("order_date").notNull(),
  expectedDeliveryDate: date("expected_delivery_date"),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
  discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
  totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
  reference: varchar("reference", { length: 64 }),
  supplierReference: varchar("supplier_reference", { length: 64 }),
  notes: text("notes"),
  terms: text("terms"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),
  convertedBillId: uuid("converted_bill_id").references(() => bills.id, { onDelete: "set null" }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  // Approval engine linkage (roadmap #43c). Non-null iff the PO is
  // owned by the generic engine (parked in `pending_approval`). Cleared
  // on approve (PO moves to 'sent') and on reject/cancel (PO flips back
  // to 'draft'). The FK has ON DELETE SET NULL.
  approvalRequestId: uuid("approval_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  lineNo: smallint("line_no").notNull(),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("1"),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull().default(0),
  lineSubtotalCents: bigint("line_subtotal_cents", { mode: "number" }).notNull().default(0),
  discountPctBps: integer("discount_pct_bps").notNull().default(0),
  discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
  taxCodeId: uuid("tax_code_id").references(() => taxCodes.id, { onDelete: "set null" }),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
  lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull().default(0),
  expenseAccountId: uuid("expense_account_id").references(() => chartOfAccounts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
export type NewPurchaseOrderLine = typeof purchaseOrderLines.$inferInsert;
