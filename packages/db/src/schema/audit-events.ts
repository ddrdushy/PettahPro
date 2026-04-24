import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// See docker/postgres/init/50-audit-events.sql for the full rationale.
// Append-only stream for governance-sensitive actions: posting/voiding
// documents, closing periods, approving journal entries, employee exits,
// login/logout.
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 64 }).notNull(),
  refType: varchar("ref_type", { length: 64 }),
  refId: uuid("ref_id"),
  summary: text("summary").notNull(),
  diff: jsonb("diff"),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: varchar("user_agent", { length: 512 }),
  // #57 / gap L1 v1 — dual-actor attribution for impersonation.
  // Populated automatically by recordAuditEvent when an impersonation
  // AsyncLocalStorage context is active; null for ordinary tenant
  // writes. Email is denormalised alongside the FK so the row still
  // reads cleanly after a platform user is soft-deleted.
  impersonatedByPlatformUserId: uuid("impersonated_by_platform_user_id"),
  impersonatedByPlatformUserEmail: varchar(
    "impersonated_by_platform_user_email",
    { length: 255 },
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
