import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  smallint,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * Tenant health score snapshots (#134 / super-admin spec §4.10).
 * One row per (tenant, calculated_at). Latest row per tenant drives
 * the at-risk dashboard; older rows kept for trend (v2).
 *
 * Sub-scores stored separately so the UI can drill into the "why"
 * rather than just the aggregate.
 */
export const tenantHealthScores = pgTable(
  "tenant_health_scores",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    score: smallint("score").notNull(),
    riskLevel: varchar("risk_level", { length: 16 }).notNull(),
    loginScore: smallint("login_score").notNull(),
    transactionScore: smallint("transaction_score").notNull(),
    subscriptionScore: smallint("subscription_score").notNull(),
    setupScore: smallint("setup_score").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    calculatedAt: timestamp("calculated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantLatestIdx: index("tenant_health_scores_tenant_latest_idx").on(
      t.tenantId,
      t.calculatedAt,
    ),
    riskCalcIdx: index("tenant_health_scores_risk_calc_idx").on(
      t.riskLevel,
      t.calculatedAt,
    ),
  }),
);

export type TenantHealthScore = typeof tenantHealthScores.$inferSelect;
export type NewTenantHealthScore = typeof tenantHealthScores.$inferInsert;
