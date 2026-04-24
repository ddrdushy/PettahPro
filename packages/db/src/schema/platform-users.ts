import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp, boolean } from "drizzle-orm/pg-core";

/**
 * Platform-admin account (#54 / gap L1). NOT tenant-scoped — these users
 * live outside RLS and are authenticated through a separate cookie
 * namespace (pp_platform_session) so they can't be confused with tenant
 * users during request handling.
 *
 * v0 has a single role ("Owner"). Finer-grained role splits (Finance
 * Admin, Support Admin, etc.) come in a follow-up — for now every
 * platform user can do everything the console exposes.
 */
export const platformUsers = pgTable("platform_users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
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
