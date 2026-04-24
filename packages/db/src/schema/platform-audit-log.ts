import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { platformUsers } from "./platform-users.js";
import { tenants } from "./tenants.js";

/**
 * Platform-scoped audit trail (#54 / gap L1). Insert-only — every action
 * a platform admin takes on a tenant (suspend, reactivate, impersonate
 * once v1 lands) writes one row here with a free-text `reason` captured
 * at action time.
 *
 * `platform_user_email` is denormalised alongside the FK so the trail
 * still reads clearly after a user row is soft-deleted or recycled.
 * `tenant_id` is nullable — platform-scoped actions (login/logout)
 * don't target any tenant.
 */
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    platformUserId: uuid("platform_user_id").references(() => platformUsers.id, {
      onDelete: "set null",
    }),
    platformUserEmail: varchar("platform_user_email", { length: 255 }).notNull(),
    kind: varchar("kind", { length: 64 }).notNull(),
    summary: text("summary").notNull(),
    reason: text("reason"),
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "set null",
    }),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: varchar("user_agent", { length: 512 }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index("idx_platform_audit_log_tenant").on(t.tenantId, t.createdAt),
    createdIdx: index("idx_platform_audit_log_created").on(t.createdAt),
  }),
);

export type PlatformAuditLog = typeof platformAuditLog.$inferSelect;
export type NewPlatformAuditLog = typeof platformAuditLog.$inferInsert;
