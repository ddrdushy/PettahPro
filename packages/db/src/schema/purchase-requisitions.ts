import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  smallint,
  bigint,
  text,
  numeric,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { suppliers } from "./suppliers.js";
import { branches } from "./branches.js";
import { items } from "./items.js";
import { users } from "./users.js";
import { purchaseOrders } from "./purchase-orders.js";

// Purchase Requisitions (roadmap #30) — internal "request to buy"
// document routed through the generic approval engine (#43e pattern)
// and converted to a Purchase Order once approved. Tenant-gated by
// settings.purchaseRequisitionsEnabled.
//
// Lifecycle: draft → [pending_approval] → approved → converted
//                                       ↘ rejected
//                                       ↘ cancelled
// Partial approval: individual lines can be marked rejected at approve
// time; the header flips to 'approved' if at least one line remains,
// else 'rejected'. See apps/api/src/modules/buy/purchase-requisitions.ts
// and docker/postgres/init/72-purchase-requisitions.sql.
export const purchaseRequisitions = pgTable("purchase_requisitions", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  prNumber: varchar("pr_number", { length: 48 }),
  branchId: uuid("branch_id").references(() => branches.id, {
    onDelete: "set null",
  }),
  // Optional preferred supplier hint — becomes the default on convert.
  preferredSupplierId: uuid("preferred_supplier_id").references(
    () => suppliers.id,
    { onDelete: "set null" },
  ),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  neededByDate: date("needed_by_date"),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  estimatedTotalCents: bigint("estimated_total_cents", { mode: "number" })
    .notNull()
    .default(0),
  purpose: text("purpose"),
  notes: text("notes"),

  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  rejectedReason: text("rejected_reason"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  convertedPoId: uuid("converted_po_id").references(() => purchaseOrders.id, {
    onDelete: "set null",
  }),

  // Approval engine linkage (#43e). Non-null iff the PR is owned by the
  // generic engine (parked in pending_approval). Cleared on approve /
  // reject / cancel. No .references() here — avoids the circular import
  // with approval-requests (application-level link, FK enforced by DB).
  approvalRequestId: uuid("approval_request_id"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type PurchaseRequisition = typeof purchaseRequisitions.$inferSelect;
export type NewPurchaseRequisition =
  typeof purchaseRequisitions.$inferInsert;

export const purchaseRequisitionLines = pgTable("purchase_requisition_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  purchaseRequisitionId: uuid("purchase_requisition_id")
    .notNull()
    .references(() => purchaseRequisitions.id, { onDelete: "cascade" }),
  lineNo: smallint("line_no").notNull(),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 })
    .notNull()
    .default("1"),
  estimatedUnitPriceCents: bigint("estimated_unit_price_cents", {
    mode: "number",
  }),
  estimatedLineTotalCents: bigint("estimated_line_total_cents", {
    mode: "number",
  })
    .notNull()
    .default(0),
  lineStatus: varchar("line_status", { length: 16 })
    .notNull()
    .default("pending"),
  lineRejectedReason: text("line_rejected_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PurchaseRequisitionLine =
  typeof purchaseRequisitionLines.$inferSelect;
export type NewPurchaseRequisitionLine =
  typeof purchaseRequisitionLines.$inferInsert;
