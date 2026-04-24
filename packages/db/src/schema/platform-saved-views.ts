import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Per-platform-user saved filter/sort bundles for the console (#59).
 * A saved view is just `scope + name → querystring`. We keep the QS
 * verbatim instead of per-page columns so the table stays generic —
 * tenants and audit today, reports/billing/etc. tomorrow, all without
 * a schema migration.
 *
 * Outside RLS. Every query MUST filter by platformUserId; enforced at
 * the API layer (see /platform/saved-views routes).
 */
export const PLATFORM_SAVED_VIEW_SCOPES = ["tenants", "audit"] as const;
export type PlatformSavedViewScope =
  (typeof PLATFORM_SAVED_VIEW_SCOPES)[number];

export const platformUserSavedViews = pgTable(
  "platform_user_saved_views",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    platformUserId: uuid("platform_user_id").notNull(),
    scope: varchar("scope", { length: 32 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    queryString: varchar("query_string", { length: 2000 })
      .notNull()
      .default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Mirrors the UNIQUE constraint in 87-platform-saved-views.sql.
    // Drizzle needs it spelled out here so migrations stay in sync.
    nameUnique: uniqueIndex("platform_user_saved_views_unique_name").on(
      t.platformUserId,
      t.scope,
      t.name,
    ),
    userScopeIdx: index("platform_user_saved_views_user_scope_idx").on(
      t.platformUserId,
      t.scope,
      t.name,
    ),
  }),
);

export type PlatformUserSavedView = typeof platformUserSavedViews.$inferSelect;
export type NewPlatformUserSavedView =
  typeof platformUserSavedViews.$inferInsert;
