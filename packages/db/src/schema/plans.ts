import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  bigint,
  smallint,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Plan catalogue (#61). Seeded from docker/postgres/init/88-pricing-plans.sql
 * with the three public tiers (starter / growth / scale). `features`
 * is a loose string[] of capability codes — kept free-form so adding
 * a gate doesn't require a schema migration, just a requirePlan call.
 *
 * Stored prices are LKR cents. Do the division at the edge (UI /
 * invoice rendering) — never in business logic.
 */
export const PLAN_CODES = ["starter", "growth", "scale"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const plans = pgTable(
  "plans",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    tagline: varchar("tagline", { length: 200 }).notNull().default(""),
    // bigint in drizzle returns a string by default to avoid JS-number
    // overflow. Mode "number" is safe here because LKR cents for a
    // plan list price never exceeds 2^53; if that ever changes we
    // swap to bigint strings at the API layer.
    monthlyPriceCents: bigint("monthly_price_cents", { mode: "number" }).notNull(),
    yearlyPriceCents: bigint("yearly_price_cents", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
    maxUsers: integer("max_users"),
    maxInvoicesMonthly: integer("max_invoices_monthly"),
    maxBranches: integer("max_branches"),
    maxWarehouses: integer("max_warehouses"),
    // Loose-typed string[] — the SQL column is jsonb. See note above
    // about keeping the gate vocabulary free-form.
    features: jsonb("features").$type<string[]>().notNull().default([]),
    isPublic: boolean("is_public").notNull().default(true),
    // Archived plans aren't picked anymore, but tenants currently on
    // them stay grandfathered. Distinct from isPublic — see migration
    // 90-plans-archive.sql for the rationale.
    isArchived: boolean("is_archived").notNull().default(false),
    sortOrder: smallint("sort_order").notNull().default(0),
    // Pointer at the current plan_versions row. Editing the plan
    // creates a new plan_versions row and updates this pointer; old
    // versions stay around for any subscription bound to them. See
    // migration 91-plan-versions.sql.
    currentVersionId: uuid("current_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    codeUnique: uniqueIndex("plans_code_key").on(t.code),
    codeIdx: index("plans_code_idx").on(t.code),
    sortOrderIdx: index("plans_sort_order_idx").on(t.sortOrder),
  }),
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;

/**
 * Plan version snapshots (#119). Immutable history — each row is the
 * value-bearing fields at a point in time. Editing a plan inserts a
 * new row here, advances plans.current_version_id, and leaves prior
 * versions intact for any subscription bound to them.
 *
 * The `plans` row keeps the latest values denormalised so reads
 * against `plans.*` see the current snapshot without a join. The
 * gate (apps/api/src/lib/plan-gate.ts) and billing path read
 * effective values via `tenant_subscriptions.plan_version_id` so
 * grandfathered subscribers see *their* version, not the latest.
 */
export const planVersions = pgTable(
  "plan_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    planId: uuid("plan_id").notNull(),
    versionNumber: integer("version_number").notNull(),

    name: varchar("name", { length: 80 }).notNull(),
    tagline: varchar("tagline", { length: 200 }).notNull().default(""),
    monthlyPriceCents: bigint("monthly_price_cents", { mode: "number" }).notNull(),
    yearlyPriceCents: bigint("yearly_price_cents", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
    maxUsers: integer("max_users"),
    maxInvoicesMonthly: integer("max_invoices_monthly"),
    maxBranches: integer("max_branches"),
    maxWarehouses: integer("max_warehouses"),
    features: jsonb("features").$type<string[]>().notNull().default([]),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByPlatformUserId: uuid("created_by_platform_user_id"),
    notes: varchar("notes", { length: 1000 }),
  },
  (t) => ({
    planIdx: index("plan_versions_plan_idx").on(t.planId),
    planVersionDescIdx: index("plan_versions_plan_version_desc_idx").on(
      t.planId,
      t.versionNumber,
    ),
    planVersionUnique: uniqueIndex("plan_versions_unique").on(
      t.planId,
      t.versionNumber,
    ),
  }),
);

export type PlanVersion = typeof planVersions.$inferSelect;
export type NewPlanVersion = typeof planVersions.$inferInsert;
