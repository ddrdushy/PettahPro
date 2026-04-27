import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  smallint,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * Per-plan dunning policy (pricing-spec §10). One row per plan, plus
 * exactly one platform-default row (plan_id IS NULL) used as the
 * fallback when a plan doesn't have its own policy.
 *
 * The policy answers three questions about a failed charge:
 *   1. When do we retry?  (retry_intervals_days)
 *   2. When do we give up? (suspend_after_attempts + grace_period_days)
 *   3. When do we email?   (email_after_attempts)
 *
 * Super-admin can pause an individual policy (is_paused=true) when a
 * customer is in a billing dispute and shouldn't be retried while the
 * issue is being resolved.
 */
export const dunningPolicies = pgTable(
  "dunning_policies",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    // NULL = platform default. The application code resolves a
    // subscription's effective policy by looking up the plan's policy
    // first, then falling back to the default.
    planId: uuid("plan_id"),
    name: varchar("name", { length: 80 }).notNull().default("Default"),
    // jsonb array of integers (days). Default [1, 3, 7, 14] = retry
    // 1, 3, 7, 14 days after first failure. Length determines retry
    // count; suspend_after_attempts must be >= length + 1.
    retryIntervalsDays: jsonb("retry_intervals_days")
      .notNull()
      .default(sql`'[1, 3, 7, 14]'::jsonb`),
    suspendAfterAttempts: smallint("suspend_after_attempts")
      .notNull()
      .default(5),
    gracePeriodDays: smallint("grace_period_days").notNull().default(7),
    // Negative values = days BEFORE the charge (e.g. -3 = three days
    // before). NULL = no pre-charge reminder.
    preChargeReminderDays: smallint("pre_charge_reminder_days"),
    showInAppBanner: boolean("show_in_app_banner").notNull().default(true),
    // Attempt-numbers (1-indexed) AFTER which to send a payment-failed
    // email. Default [1, 3, 5] = email after attempts 1, 3, and 5.
    emailAfterAttempts: jsonb("email_after_attempts")
      .notNull()
      .default(sql`'[1, 3, 5]'::jsonb`),
    isPaused: boolean("is_paused").notNull().default(false),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Partial unique indexes on plan_id (one for NULL = platform
    // default, one for non-NULL = per-plan) live in the SQL migration
    // — Drizzle's uniqueIndex doesn't generate WHERE clauses cleanly
    // and we don't want to fight the introspection. Just a regular
    // lookup index here for lookups by plan.
    planIdx: index("dunning_policies_plan_idx_drizzle").on(t.planId),
  }),
);

export type DunningPolicy = typeof dunningPolicies.$inferSelect;
export type NewDunningPolicy = typeof dunningPolicies.$inferInsert;
