import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  smallint,
  bigint,
  integer,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { chartOfAccounts } from "./accounts.js";
import { suppliers } from "./suppliers.js";
import { bills } from "./bills.js";
import { journalEntries } from "./journals.js";

export const fixedAssets = pgTable("fixed_assets", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 32 }),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 32 }).notNull().default("equipment"),
  assetAccountId: uuid("asset_account_id").references(() => chartOfAccounts.id, { onDelete: "set null" }),
  accumulatedDepreciationAccountId: uuid("accumulated_depreciation_account_id").references(() => chartOfAccounts.id, { onDelete: "set null" }),
  depreciationExpenseAccountId: uuid("depreciation_expense_account_id").references(() => chartOfAccounts.id, { onDelete: "set null" }),
  acquisitionDate: date("acquisition_date").notNull(),
  depreciationStartDate: date("depreciation_start_date").notNull(),
  costCents: bigint("cost_cents", { mode: "number" }).notNull(),
  salvageCents: bigint("salvage_cents", { mode: "number" }).notNull().default(0),
  usefulLifeMonths: integer("useful_life_months").notNull(),
  depreciationMethod: varchar("depreciation_method", { length: 24 }).notNull().default("straight_line"),
  accumulatedDepreciationCents: bigint("accumulated_depreciation_cents", { mode: "number" }).notNull().default(0),
  lastDepreciationRunDate: date("last_depreciation_run_date"),
  // --- Tax schedule (dual depreciation, #40) -----------------------------
  // Runs in parallel to the book schedule but never touches the GL. Used by
  // the tax-computation workflow. Backfilled to mirror the book values; the
  // CA overrides on a per-asset basis when SL IRD rates differ from book.
  taxDepreciationMethod: varchar("tax_depreciation_method", { length: 24 }).notNull().default("straight_line"),
  taxUsefulLifeMonths: integer("tax_useful_life_months").notNull(),
  taxSalvageCents: bigint("tax_salvage_cents", { mode: "number" }).notNull().default(0),
  // Annual rate in basis points (2000 = 20.00%) — used by WDV.
  taxAnnualRateBps: integer("tax_annual_rate_bps"),
  taxDepreciationStartDate: date("tax_depreciation_start_date").notNull(),
  taxAccumulatedDepreciationCents: bigint("tax_accumulated_depreciation_cents", { mode: "number" }).notNull().default(0),
  taxLastDepreciationRunDate: date("tax_last_depreciation_run_date"),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  billId: uuid("bill_id").references(() => bills.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type FixedAsset = typeof fixedAssets.$inferSelect;
export type NewFixedAsset = typeof fixedAssets.$inferInsert;

export const fixedAssetDepreciationEntries = pgTable("fixed_asset_depreciation_entries", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  fixedAssetId: uuid("fixed_asset_id").notNull().references(() => fixedAssets.id, { onDelete: "cascade" }),
  runDate: date("run_date").notNull(),
  periodYear: smallint("period_year").notNull(),
  periodMonth: smallint("period_month").notNull(),
  depreciationCents: bigint("depreciation_cents", { mode: "number" }).notNull(),
  accumulatedAfterCents: bigint("accumulated_after_cents", { mode: "number" }).notNull(),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FixedAssetDepreciationEntry = typeof fixedAssetDepreciationEntries.$inferSelect;
export type NewFixedAssetDepreciationEntry = typeof fixedAssetDepreciationEntries.$inferInsert;

// Tax schedule entries — same shape as book entries minus the JE linkage
// (tax depreciation is memo-only and never posts to GL). Unique on
// (tenant, asset, period_year, period_month) so tax runs are idempotent.
export const fixedAssetTaxDepreciationEntries = pgTable("fixed_asset_tax_depreciation_entries", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  fixedAssetId: uuid("fixed_asset_id").notNull().references(() => fixedAssets.id, { onDelete: "cascade" }),
  runDate: date("run_date").notNull(),
  periodYear: smallint("period_year").notNull(),
  periodMonth: smallint("period_month").notNull(),
  depreciationCents: bigint("depreciation_cents", { mode: "number" }).notNull(),
  accumulatedAfterCents: bigint("accumulated_after_cents", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FixedAssetTaxDepreciationEntry = typeof fixedAssetTaxDepreciationEntries.$inferSelect;
export type NewFixedAssetTaxDepreciationEntry = typeof fixedAssetTaxDepreciationEntries.$inferInsert;
