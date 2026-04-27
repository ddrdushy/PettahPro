import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  bigint,
  smallint,
  index,
} from "drizzle-orm/pg-core";

/**
 * One row per subscription charge attempt — stub or real, success or
 * failure. The full history of every attempt is preserved so analytics
 * on dunning effectiveness, gateway failure patterns, and per-tenant
 * payment health are all queryable from a single table.
 *
 * Status flow:
 *   pending  → succeeded | failed | skipped
 *
 * `pending` rows are short-lived — the worker writes a row in `pending`,
 * calls the gateway, then flips to one of the three terminal states
 * within the same job run. A row stuck in `pending` is a worker crash
 * footprint and should be alerted on (left for follow-up).
 *
 * `skipped` is used when the worker decides not to charge — paused
 * dunning policy, manual mark-paid, etc. Distinguishing skipped from
 * succeeded matters for the failed-payment counter (skips don't
 * increment).
 */
export const CHARGE_ATTEMPT_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type ChargeAttemptStatus = (typeof CHARGE_ATTEMPT_STATUSES)[number];

export const subscriptionChargeAttempts = pgTable(
  "subscription_charge_attempts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    subscriptionId: uuid("subscription_id").notNull(),
    // 1-indexed within the current billing period. Resets when the
    // period rolls over.
    attemptNumber: smallint("attempt_number").notNull(),
    // LKR cents (or whatever currency the subscription is in — the
    // currency lives on the plan, not here). bigint mode "number"
    // is fine: 2^53 cents is enormous.
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Free-form. For real gateways, the response body or a structured
    // subset. For the stub: "stub:success" or "stub:forced_failure".
    gatewayResponse: varchar("gateway_response", { length: 2000 }),
    failureCode: varchar("failure_code", { length: 64 }),
    failureReason: varchar("failure_reason", { length: 500 }),
    triggeredByPlatformUserId: uuid("triggered_by_platform_user_id"),
    dunningPolicyId: uuid("dunning_policy_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index("charge_attempts_tenant_idx_drizzle").on(t.tenantId),
    subscriptionIdx: index("charge_attempts_subscription_idx_drizzle").on(
      t.subscriptionId,
    ),
    statusIdx: index("charge_attempts_status_idx_drizzle").on(t.status),
  }),
);

export type SubscriptionChargeAttempt =
  typeof subscriptionChargeAttempts.$inferSelect;
export type NewSubscriptionChargeAttempt =
  typeof subscriptionChargeAttempts.$inferInsert;
