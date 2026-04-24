import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp, boolean } from "drizzle-orm/pg-core";

/**
 * Platform-admin account (#54 / gap L1). NOT tenant-scoped — these users
 * live outside RLS and are authenticated through a separate cookie
 * namespace (pp_platform_session) so they can't be confused with tenant
 * users during request handling.
 *
 * #56 added `role` — one of super_admin / support / billing (enum
 * enforced by CHECK constraint in 84-platform-user-roles.sql). A staff
 * member has exactly one role; permissions flow from the role, not from
 * a flexible key map. The role is cached on the platform session so
 * every request can gate without a DB round-trip; changing a user's
 * role invalidates all of their active sessions so the new gate takes
 * effect immediately.
 */
export const PLATFORM_ROLES = ["super_admin", "support", "billing"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const platformUsers = pgTable("platform_users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 32 }).notNull().default("super_admin"),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type PlatformUser = typeof platformUsers.$inferSelect;
export type NewPlatformUser = typeof platformUsers.$inferInsert;
