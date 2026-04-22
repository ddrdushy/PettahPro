import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  numeric,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

// FX rate history — manual entry in v1, sourced from cbsl.gov.lk / bank
// advice / exchangerate.host etc. Used for display lookup on new txns and
// future revaluation runs. Uniqueness on (tenant, from, to, date) blocks
// the same-day double-entry mistake.
export const fxRates = pgTable("fx_rates", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  fromCurrency: varchar("from_currency", { length: 3 }).notNull(),
  toCurrency: varchar("to_currency", { length: 3 }).notNull(),
  rateDate: date("rate_date").notNull(),
  rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
  source: varchar("source", { length: 32 }).notNull().default("manual"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
});

export type FxRate = typeof fxRates.$inferSelect;
export type NewFxRate = typeof fxRates.$inferInsert;
