import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Per-tenant subscription row (#61). One row per tenant (UNIQUE on
 * tenant_id). Status transitions are:
 *
 *     trial ──────── user upgrades ────► active
 *       │                                   │
 *       │ trial ends, no payment             │ payment fails
 *       ▼                                    ▼
 *     past_due ◄─────────────────────── past_due
 *       │
 *       │ N days past due (default 7)
 *       ▼
 *     cancelled (terminal)
 *
 * The trial-expiry job (#63) drives the first two automated transitions;
 * platform-admin can force any of them manually (audited via
 * platform_audit_events).
 */
export const SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "past_due",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ["monthly", "yearly"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const tenantSubscriptions = pgTable(
  "tenant_subscriptions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    planId: uuid("plan_id").notNull(),
    // Bound at signup or change-plan to a specific plan_versions row
    // (#119). Edits to the plan catalogue do NOT touch existing
    // subscriptions — they stay on their bound version until an
    // explicit migrate-to-current action. Nullable for back-compat
    // with rows created before the versioning migration; the app
    // populates it on every write going forward.
    planVersionId: uuid("plan_version_id"),
    status: varchar("status", { length: 16 }).notNull(),
    billingCycle: varchar("billing_cycle", { length: 8 })
      .notNull()
      .default("monthly"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
    })
      .notNull()
      .default(sql`(now() + interval '30 days')`),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: varchar("cancel_reason", { length: 500 }),
    // Per-tenant quota overrides (#71). NULL = "use the plan's cap";
    // an integer overrides the plan cap for this tenant. Lets ops
    // honor custom contracts ("Starter pricing, 5,000 invoices/mo")
    // without polluting the shared plan catalogue.
    customMaxUsers: integer("custom_max_users"),
    customMaxInvoicesMonthly: integer("custom_max_invoices_monthly"),
    customMaxBranches: integer("custom_max_branches"),
    customMaxWarehouses: integer("custom_max_warehouses"),
    customLimitsNote: varchar("custom_limits_note", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantUnique: uniqueIndex("tenant_subscriptions_tenant_id_key").on(
      t.tenantId,
    ),
    planIdx: index("tenant_subscriptions_plan_idx").on(t.planId),
    planVersionIdx: index("tenant_subscriptions_plan_version_idx").on(
      t.planVersionId,
    ),
    statusIdx: index("tenant_subscriptions_status_idx").on(t.status),
  }),
);

export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;
export type NewTenantSubscription = typeof tenantSubscriptions.$inferInsert;
