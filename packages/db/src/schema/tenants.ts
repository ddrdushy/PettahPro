import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp, text } from "drizzle-orm/pg-core";

/**
 * Top-level tenant record. Every row in every other tenant-scoped table
 * carries a `tenant_id` FK back to this table, and RLS enforces isolation.
 *
 * Note: the `tenants` table itself has no RLS — Super Admin and provisioning
 * code need to read it cross-tenant. Access is gated at the application layer.
 */
export const tenants = pgTable("tenants", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  slug: varchar("slug", { length: 63 }).notNull().unique(),
  businessName: varchar("business_name", { length: 255 }).notNull(),
  country: varchar("country", { length: 2 }).notNull().default("LK"),
  timezone: varchar("timezone", { length: 63 }).notNull().default("Asia/Colombo"),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  notes: text("notes"),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
