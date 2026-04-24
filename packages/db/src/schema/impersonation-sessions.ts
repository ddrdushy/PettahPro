import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { platformUsers } from "./platform-users.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";
import { impersonationRequests } from "./impersonation-requests.js";

/**
 * Impersonation sessions (#57 / gap L1 v1). One row per minted tenant
 * session where the actor is a platform staffer standing behind a
 * tenant user. Separate from impersonation_requests because the
 * request is "permission slip" and the session is "actually logged in."
 *
 * session_id mirrors the Redis session blob id (identity/sessions.ts)
 * — force-end nukes the blob via that key.
 *
 * ends_at is the hard deadline. sessions.ts checks impersonation
 * sessions and refuses to slide the TTL, so an impersonation session
 * expires cleanly even if the admin keeps clicking around.
 */
export const impersonationSessions = pgTable(
  "impersonation_sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    requestId: uuid("request_id")
      .notNull()
      .references(() => impersonationRequests.id, { onDelete: "cascade" }),
    platformUserId: uuid("platform_user_id").references(
      () => platformUsers.id,
      { onDelete: "set null" },
    ),
    platformUserEmail: varchar("platform_user_email", {
      length: 255,
    }).notNull(),
    targetTenantId: uuid("target_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserEmail: varchar("target_user_email", { length: 255 }).notNull(),
    sessionId: varchar("session_id", { length: 64 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: varchar("ended_by", { length: 16 }),
    endedReason: text("ended_reason"),
  },
  (t) => ({
    tenantActiveIdx: index("idx_imp_sess_tenant_active").on(t.targetTenantId),
    platformIdx: index("idx_imp_sess_platform").on(
      t.platformUserId,
      t.startedAt,
    ),
    startedIdx: index("idx_imp_sess_started").on(t.startedAt),
    sessionUnique: uniqueIndex("idx_imp_sess_session_unique").on(t.sessionId),
  }),
);

export type ImpersonationSession = typeof impersonationSessions.$inferSelect;
export type NewImpersonationSession =
  typeof impersonationSessions.$inferInsert;

export type ImpersonationEndedBy = "platform" | "tenant" | "expired";
