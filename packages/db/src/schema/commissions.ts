import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  boolean,
  bigint,
  integer,
  smallint,
  text,
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { employees } from "./employees.js";
import { customers } from "./customers.js";
import { payrollRuns } from "./payroll.js";

// Commission engine — see docker/postgres/init/59-commissions.sql for the
// full shape and engine semantics. The drizzle types track the SQL 1:1.

export const commissionSalespeople = pgTable("commission_salespeople", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  defaultRateBps: integer("default_rate_bps"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommissionSalesperson = typeof commissionSalespeople.$inferSelect;
export type NewCommissionSalesperson = typeof commissionSalespeople.$inferInsert;

export const commissionRules = pgTable("commission_rules", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 12 }).notNull().default("active"),
  triggerEvent: varchar("trigger_event", { length: 24 }).notNull(),
  formula: varchar("formula", { length: 24 }).notNull(),
  config: jsonb("config").notNull().default({}),
  salespersonUserIds: jsonb("salesperson_user_ids"),
  itemIds: jsonb("item_ids"),
  customerIds: jsonb("customer_ids"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  priority: smallint("priority").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type CommissionRule = typeof commissionRules.$inferSelect;
export type NewCommissionRule = typeof commissionRules.$inferInsert;

export const commissionEarnings = pgTable("commission_earnings", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  ruleId: uuid("rule_id").notNull().references(() => commissionRules.id, { onDelete: "restrict" }),
  salespersonUserId: uuid("salesperson_user_id").notNull(),
  sourceType: varchar("source_type", { length: 20 }).notNull(),
  sourceId: uuid("source_id").notNull(),
  sourceNumber: varchar("source_number", { length: 48 }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  baseCents: bigint("base_cents", { mode: "number" }).notNull(),
  rateBps: integer("rate_bps").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("accrued"),
  earnedAt: date("earned_at").notNull(),
  paidInRunId: uuid("paid_in_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
  clawbackOfEarningId: uuid("clawback_of_earning_id"),
  memo: text("memo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommissionEarning = typeof commissionEarnings.$inferSelect;
export type NewCommissionEarning = typeof commissionEarnings.$inferInsert;
