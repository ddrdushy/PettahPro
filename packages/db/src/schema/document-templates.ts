import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Document templates (roadmap #33) — tenant-scoped per-doc-type
// layout records driving the PDF renderer. See
// docker/postgres/init/79-document-templates.sql for the data shape
// rationale. The `layoutJson` blob is parsed by the web-side
// template-renderer (apps/web/lib/template-renderer.tsx); that file
// is the source of truth for the JSON structure, not this type.
export const documentTemplates = pgTable("document_templates", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  docType: varchar("doc_type", { length: 40 }).notNull(),
  language: varchar("language", { length: 5 }).notNull().default("en"),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  layoutJson: jsonb("layout_json").notNull().default(sql`'{}'::jsonb`),
  version: integer("version").notNull().default(1),
  // 'draft' | 'published' | 'archived'. Enforced at CHECK level.
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  isDefault: boolean("is_default").notNull().default(false),
  libraryKey: varchar("library_key", { length: 80 }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type DocumentTemplate = typeof documentTemplates.$inferSelect;
export type NewDocumentTemplate = typeof documentTemplates.$inferInsert;

// Keep in lockstep with the SQL CHECK constraint.
export const DOCUMENT_TEMPLATE_DOC_TYPES = [
  "invoice",
  "quotation",
  "credit_note",
  "debit_note",
  "delivery_note",
  "proforma_invoice",
  "bill",
  "purchase_order",
  "goods_received_note",
  "stock_transfer",
  "payslip",
  "settlement_letter",
] as const;
export type DocumentTemplateDocType =
  (typeof DOCUMENT_TEMPLATE_DOC_TYPES)[number];

export const DOCUMENT_TEMPLATE_STATUSES = [
  "draft",
  "published",
  "archived",
] as const;
export type DocumentTemplateStatus =
  (typeof DOCUMENT_TEMPLATE_STATUSES)[number];
