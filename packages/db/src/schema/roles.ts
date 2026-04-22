import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Custom roles (roadmap #27). v1 is a role catalog with a JSON
// permissions map; each tenant gets 5 system templates seeded at
// bootstrap (Owner, Admin, Accountant, Sales, Read-only) that can be
// cloned and edited.
//
// permissions shape: { "invoices.create": true, "bills.void": false, ... }
// Missing keys = denied. users.is_owner continues to be the
// super-admin bypass — owners can't have a role stripped beneath them.
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 64 }).notNull(),
  description: text("description"),
  permissions: jsonb("permissions").notNull().default(sql`'{}'::jsonb`),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

// Many-to-many user ↔ role. Users can hold multiple roles — effective
// permissions are the union.
export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  assignedByUserId: uuid("assigned_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
