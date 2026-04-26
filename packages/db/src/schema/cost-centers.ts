import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Cost centers (#129 / gaps B1) — first dimension on journal lines.
 * Tenant-scoped, RLS-protected, soft-delete supported. Optional
 * parent for hierarchy (recursive rollup is a follow-up; v1 ships
 * single-level filtering).
 *
 * Per-tenant (code, lower-cased) uniqueness enforced via partial
 * unique index that excludes soft-deleted rows so a re-create works.
 */
export const costCenters = pgTable(
  "cost_centers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    parentCostCenterId: uuid("parent_cost_center_id"),
    isActive: boolean("is_active").notNull().default(true),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    // Note: the live SQL has these as partial-unique / partial indexes
    // (WHERE deleted_at IS NULL). Drizzle doesn't model partial
    // indexes cleanly; the migration is the source of truth. Drizzle
    // here just keeps the column-level FKs / types consistent.
    tenantCodeUnique: uniqueIndex("cost_centers_tenant_code_unique").on(
      t.tenantId,
      t.code,
    ),
    tenantActiveIdx: index("cost_centers_tenant_active_idx").on(
      t.tenantId,
      t.isActive,
    ),
  }),
);

export type CostCenter = typeof costCenters.$inferSelect;
export type NewCostCenter = typeof costCenters.$inferInsert;
