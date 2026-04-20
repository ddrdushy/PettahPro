import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * Tenant user — a human with access to one tenant. RLS enforces that
 * `tenant_id = current_tenant_id()` on every query.
 *
 * A single human with access to multiple tenants has multiple rows here,
 * one per tenant, federated by `email` at the application layer.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }),
    isActive: boolean("is_active").notNull().default(true),
    isOwner: boolean("is_owner").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    tenantEmailUnique: index("users_tenant_email_unique")
      .on(t.tenantId, t.email)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
