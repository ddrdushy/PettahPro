import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer as _integer,
  bigint,
  smallint,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// _integer kept as an unused import alias so the file template matches
// the plans.ts pattern; no integer columns on addons today (cap-delta
// addons are deferred — see 92-addons.sql).
void _integer;

/**
 * Add-ons catalogue (#120 / pricing-spec §7). Tenants on a lower tier
 * buy individual gated features without paying for a tier upgrade.
 *
 * Same shape as the plans catalogue — code, prices in LKR cents,
 * is_public + is_archived flags, sort_order. The two interesting
 * add-on-specific fields:
 *   * grantsFeatures — plan-feature codes added to the tenant's
 *     effective set when this addon is active.
 *   * eligiblePlanCodes — UI-only restriction on which plans this
 *     addon is sellable under (empty = anyone). Doesn't affect the
 *     gate; once granted, it works.
 */
export const addons = pgTable(
  "addons",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    code: varchar("code", { length: 48 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    tagline: varchar("tagline", { length: 200 }).notNull().default(""),
    monthlyPriceCents: bigint("monthly_price_cents", { mode: "number" }).notNull(),
    yearlyPriceCents: bigint("yearly_price_cents", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
    grantsFeatures: jsonb("grants_features")
      .$type<string[]>()
      .notNull()
      .default([]),
    eligiblePlanCodes: jsonb("eligible_plan_codes")
      .$type<string[]>()
      .notNull()
      .default([]),
    isPublic: boolean("is_public").notNull().default(true),
    isArchived: boolean("is_archived").notNull().default(false),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    codeUnique: uniqueIndex("addons_code_key").on(t.code),
    codeIdx: index("addons_code_idx").on(t.code),
  }),
);

export type Addon = typeof addons.$inferSelect;
export type NewAddon = typeof addons.$inferInsert;

export const ADDON_STATUSES = [
  "active",
  "pending_removal",
  "cancelled",
] as const;
export type AddonStatus = (typeof ADDON_STATUSES)[number];

/**
 * Per-tenant add-on subscription. Lifecycle:
 *   active → pending_removal → cancelled
 *   active → cancelled (auto_removed_at set on tier upgrade)
 *
 * Partial unique on (tenant_id, addon_id) WHERE status <> 'cancelled'
 * lets a tenant re-purchase an addon they previously cancelled
 * without violating uniqueness.
 */
export const tenantAddons = pgTable(
  "tenant_addons",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    addonId: uuid("addon_id").notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    billingCycle: varchar("billing_cycle", { length: 8 })
      .notNull()
      .default("monthly"),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true })
      .notNull()
      .default(sql`(now() + interval '30 days')`),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    activatedByPlatformUserId: uuid("activated_by_platform_user_id"),
    activatedByUserId: uuid("activated_by_user_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: varchar("cancel_reason", { length: 500 }),
    autoRemovedAt: timestamp("auto_removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index("tenant_addons_tenant_status_idx").on(
      t.tenantId,
      t.status,
    ),
  }),
);

export type TenantAddon = typeof tenantAddons.$inferSelect;
export type NewTenantAddon = typeof tenantAddons.$inferInsert;
