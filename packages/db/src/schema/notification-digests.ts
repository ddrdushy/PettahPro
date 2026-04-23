import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Pending events waiting for the next digest email. Row is created by
// emitNotification() when the user's cadence for a kind is daily/weekly,
// then consumed (delivered_at + digest_email_id stamped) by the digest
// cron.
export const notificationDigestQueue = pgTable("notification_digest_queue", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 64 }).notNull(),
  // 'daily' | 'weekly' — snapshot of the user's cadence at emit time.
  // If the user later flips to 'immediate' we still honour the original
  // cadence on already-queued rows so they aren't orphaned.
  cadence: varchar("cadence", { length: 16 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body"),
  refType: varchar("ref_type", { length: 32 }),
  refId: uuid("ref_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  digestEmailId: uuid("digest_email_id"),
});

// Send-side log — parallel to customer_statement_emails. One row per
// attempt, so status=failed rows remain visible for retry inspection.
// Dedupe source: the cron checks for a recent status='sent' row before
// composing a fresh digest to guard against multi-fire windows.
export const notificationDigestEmails = pgTable("notification_digest_emails", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  toEmail: varchar("to_email", { length: 255 }).notNull(),
  cadence: varchar("cadence", { length: 16 }).notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  eventCount: integer("event_count").notNull().default(0),
  // { "invoice_posted": 4, "low_stock": 2, ... } — handy for the UI
  // and for future per-kind tuning without re-joining the queue table.
  kindBreakdown: jsonb("kind_breakdown").$type<Record<string, number>>().notNull().default({}),
  // 'sent' | 'failed' | 'skipped'
  status: varchar("status", { length: 16 }).notNull(),
  errorMessage: text("error_message"),
  messageId: varchar("message_id", { length: 255 }),
  transport: varchar("transport", { length: 16 }).notNull().default("smtp"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationDigestQueueRow =
  typeof notificationDigestQueue.$inferSelect;
export type NewNotificationDigestQueueRow =
  typeof notificationDigestQueue.$inferInsert;
export type NotificationDigestEmail =
  typeof notificationDigestEmails.$inferSelect;
export type NewNotificationDigestEmail =
  typeof notificationDigestEmails.$inferInsert;
