import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp, text } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { customers } from "./customers.js";

/**
 * One-time login codes for the customer portal (sell-module-spec §14.1).
 *
 * A code is minted per matching (tenant, customer) pair — not per email —
 * so a single person with buyer relationships at multiple tenants resolves
 * to exactly one tenant/customer after verify.
 *
 * The stored `code_hash` is SHA-256 of the 6-digit numeric code; the API
 * never persists the plaintext. Rate limiting is enforced in the API via
 * Redis, not here; this table is the audit + consumption record.
 *
 * Cross-tenant access (pre-login lookup, verify, consume) goes through
 * SECURITY DEFINER helpers in docker/postgres/init/63-customer-portal.sql
 * because the handler runs before we have tenant context for RLS.
 */
export const portalOtps = pgTable("portal_otps", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  requesterIp: varchar("requester_ip", { length: 64 }),
  userAgent: text("user_agent"),
});

export type PortalOtp = typeof portalOtps.$inferSelect;
export type NewPortalOtp = typeof portalOtps.$inferInsert;
