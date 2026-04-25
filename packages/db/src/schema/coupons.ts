import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Promotional coupon catalog (#121 / pricing-spec §8). Each row is one
 * redeemable code with discount type, eligibility, validity window,
 * and usage caps. Mirrors the plans / addons catalog shape — code is
 * the stable handle, prices/values stored in cents (or bps for
 * percent-off), is_active/is_archived flags drive availability.
 *
 * v1 supports two discount types — `percent_off` (bps in
 * `discountValue`, e.g. 2000 = 20%) and `amount_off_cents` (LKR cents).
 * Both are recorded at redemption time; real billing applies them when
 * the renewal worker lands. `first_n_months_free` and
 * `trial_days_extension` are spec'd but deferred — schema accommodates
 * via the same discount_type CHECK widening.
 */

export const COUPON_DISCOUNT_TYPES = ["percent_off", "amount_off_cents"] as const;
export type CouponDiscountType = (typeof COUPON_DISCOUNT_TYPES)[number];

export const COUPON_APPLIES_FOR = ["once", "forever", "months"] as const;
export type CouponAppliesFor = (typeof COUPON_APPLIES_FOR)[number];

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    discountType: varchar("discount_type", { length: 32 }).notNull(),
    // bigint mode "number" — bps (≤ 10_000) and LKR cents are well
    // within JS-safe-integer range; if we ever model an amount-off
    // coupon larger than 2^53 cents we have bigger problems.
    discountValue: bigint("discount_value", { mode: "number" }).notNull(),
    appliesFor: varchar("applies_for", { length: 16 })
      .notNull()
      .default("once"),
    appliesForMonths: integer("applies_for_months"),
    eligiblePlanCodes: jsonb("eligible_plan_codes")
      .$type<string[]>()
      .notNull()
      .default([]),
    newSignupsOnly: boolean("new_signups_only").notNull().default(false),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    maxRedemptions: integer("max_redemptions"),
    redemptionCount: integer("redemption_count").notNull().default(0),
    onePerTenant: boolean("one_per_tenant").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    isArchived: boolean("is_archived").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByPlatformUserId: uuid("created_by_platform_user_id"),
  },
  (t) => ({
    codeUnique: uniqueIndex("coupons_code_key").on(t.code),
    codeLowerIdx: index("coupons_code_lower_idx").on(sql`LOWER(${t.code})`),
  }),
);

export type Coupon = typeof coupons.$inferSelect;
export type NewCoupon = typeof coupons.$inferInsert;

export const COUPON_REDEMPTION_STATUSES = [
  "active",
  "consumed",
  "cancelled",
] as const;
export type CouponRedemptionStatus = (typeof COUPON_REDEMPTION_STATUSES)[number];

/**
 * One row per (coupon, tenant) successful redemption. Snapshots the
 * coupon's discount fields at redemption time so a later catalog edit
 * doesn't change what the tenant already received. Partial unique on
 * (coupon_id, tenant_id) WHERE status <> 'cancelled' enforces
 * one-per-tenant when the coupon's `onePerTenant` flag is true; the
 * route-layer code reads the coupon's flag and 409s on duplicate
 * attempts before the index does, for a friendlier error.
 */
export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    couponId: uuid("coupon_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    discountType: varchar("discount_type", { length: 32 }).notNull(),
    discountValue: bigint("discount_value", { mode: "number" }).notNull(),
    appliesFor: varchar("applies_for", { length: 16 }).notNull(),
    appliesForMonths: integer("applies_for_months"),
    planId: uuid("plan_id"),
    planVersionId: uuid("plan_version_id"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    monthsApplied: integer("months_applied").notNull().default(0),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    redeemedByUserId: uuid("redeemed_by_user_id"),
    redeemedByPlatformUserId: uuid("redeemed_by_platform_user_id"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: varchar("cancel_reason", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    couponIdx: index("coupon_redemptions_coupon_idx").on(t.couponId),
    tenantIdx: index("coupon_redemptions_tenant_idx").on(t.tenantId),
  }),
);

export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type NewCouponRedemption = typeof couponRedemptions.$inferInsert;
