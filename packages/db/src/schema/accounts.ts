import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  integer,
  date,
  smallint,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const chartOfAccounts = pgTable("chart_of_accounts", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 16 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  accountType: varchar("account_type", { length: 16 }).notNull(),
  accountSubtype: varchar("account_subtype", { length: 32 }),
  parentId: uuid("parent_id"),
  normalSide: varchar("normal_side", { length: 2 }).notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Account = typeof chartOfAccounts.$inferSelect;
export type NewAccount = typeof chartOfAccounts.$inferInsert;

export const taxCodes = pgTable("tax_codes", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 16 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  taxKind: varchar("tax_kind", { length: 16 }).notNull(),
  rateBps: integer("rate_bps").notNull(),
  isInclusive: boolean("is_inclusive").notNull().default(false),
  appliesTo: varchar("applies_to", { length: 16 }).notNull().default("both"),
  payableAccountId: uuid("payable_account_id"),
  receivableAccountId: uuid("receivable_account_id"),
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type TaxCode = typeof taxCodes.$inferSelect;
export type NewTaxCode = typeof taxCodes.$inferInsert;

export const fiscalPeriods = pgTable("fiscal_periods", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  fiscalYear: smallint("fiscal_year").notNull(),
  periodNo: smallint("period_no").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("open"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedByUserId: uuid("closed_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FiscalPeriod = typeof fiscalPeriods.$inferSelect;
export type NewFiscalPeriod = typeof fiscalPeriods.$inferInsert;
