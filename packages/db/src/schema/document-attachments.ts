import { sql } from "drizzle-orm";
import { pgTable, uuid, text, bigint, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Document attachments (roadmap #32) — shared file-attachment store
// across every transactional document type. One table; `entity_type`
// discriminates. Files live in an S3-compatible object store under
// a tenant-prefixed key; rows here are the metadata + retention
// record. See `docker/postgres/init/73-document-attachments.sql`.
//
// Retention: default 7 years from upload (padded past the 6-year
// statutory floor). Soft-delete sets `deletedAt`; the bytes stay in
// object storage until `retentionUntil` passes so an audit can still
// defend what was uploaded even after a user "deleted" it.
export const documentAttachments = pgTable("document_attachments", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(),
  sha256: text("sha256"),
  uploadedByUserId: uuid("uploaded_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  retentionUntil: timestamp("retention_until", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '7 years'`),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
});

export type DocumentAttachment = typeof documentAttachments.$inferSelect;
export type NewDocumentAttachment = typeof documentAttachments.$inferInsert;

// Allow-list of entity types matches the CHECK constraint in the
// migration. Keep them in sync when extending.
export const DOCUMENT_ATTACHMENT_ENTITY_TYPES = [
  "invoice",
  "sales_order",
  "quotation",
  "credit_note",
  "bill",
  "purchase_order",
  "purchase_requisition",
  "goods_received_note",
  "expense_claim",
  "payment",
  "receipt",
  "final_settlement",
  "journal_entry",
  // Widened in migration 75 (roadmap #38 petty cash). Expense /
  // advance / top-up rows attach receipts here via the shared
  // <AttachmentsPanel />.
  "petty_cash_transaction",
  // Widened in migration 76 (roadmap #39 attendance capture).
  // Geofence photos and manual muster sheet scans attach to
  // individual attendance rows.
  "attendance_record",
] as const;

export type DocumentAttachmentEntityType =
  (typeof DOCUMENT_ATTACHMENT_ENTITY_TYPES)[number];
