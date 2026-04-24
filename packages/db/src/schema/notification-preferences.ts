import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp, boolean } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Per-user opt-out + cadence for notification kinds (roadmap #25 + #45).
// Absence of a row means "enabled=immediate" — emit.ts drops the event
// when enabled=false OR cadence='off', and routes daily/weekly into the
// digest queue instead of the in-app bell.
export const notificationPreferences = pgTable("notification_preferences", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 64 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  // Roadmap #45. 'off' | 'immediate' | 'daily' | 'weekly'. CHECK in SQL.
  // 'immediate' preserves pre-PR behaviour; 'daily' / 'weekly' divert
  // into notification_digest_queue for rollup emails.
  cadence: varchar("cadence", { length: 16 }).notNull().default("immediate"),
  // Roadmap #53 / gap D1. When cadence='immediate', this flag controls
  // whether emitNotification also sends an email in addition to the
  // in-app bell row. Default false for back-compat — pre-#53 users
  // keep bell-only delivery until they explicitly opt in. For
  // 'daily'/'weekly' cadences the flag is moot because email is
  // implicit via the digest cron; for 'off' the server forces it false.
  emailEnabled: boolean("email_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
