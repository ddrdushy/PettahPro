import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { platformUsers } from "./platform-users.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * Impersonation requests (#57 / gap L1 v1). One row per "platform
 * staff member asked to log in AS a tenant user." Lives outside RLS —
 * same pattern as platform_audit_log — because both sides (platform +
 * tenant) need to read it and the scope is enforced at the API layer
 * via req.tenantId / req.platformUserId.
 *
 * Lifecycle: pending → approved | refused | expired | cancelled.
 * An approved request can then mint an impersonation_session; once
 * that session exists, the request is "spent" (status stays approved
 * as a historical marker).
 *
 * expires_at: hard deadline on the pending state. We default to
 * +24h at insert time so a tenant Owner is never looking at a wall
 * of stale requests. The lazy impersonation_sweep_expired() helper
 * flips rows past this.
 */
export const impersonationRequests = pgTable(
  "impersonation_requests",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    requestingPlatformUserId: uuid("requesting_platform_user_id").references(
      () => platformUsers.id,
      { onDelete: "set null" },
    ),
    requestingPlatformUserEmail: varchar("requesting_platform_user_email", {
      length: 255,
    }).notNull(),
    targetTenantId: uuid("target_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    requestedMinutes: integer("requested_minutes").notNull(),
    reason: text("reason").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByUserEmail: varchar("approved_by_user_email", { length: 255 }),
    approvedMinutes: integer("approved_minutes"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    refusedAt: timestamp("refused_at", { withTimezone: true }),
    refusedByUserId: uuid("refused_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    refusedReason: text("refused_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index("idx_imp_req_tenant_status").on(
      t.targetTenantId,
      t.status,
      t.createdAt,
    ),
    requesterIdx: index("idx_imp_req_requester").on(
      t.requestingPlatformUserId,
      t.createdAt,
    ),
    createdIdx: index("idx_imp_req_created").on(t.createdAt),
  }),
);

export type ImpersonationRequest = typeof impersonationRequests.$inferSelect;
export type NewImpersonationRequest =
  typeof impersonationRequests.$inferInsert;

export type ImpersonationRequestStatus =
  | "pending"
  | "approved"
  | "refused"
  | "expired"
  | "cancelled";
