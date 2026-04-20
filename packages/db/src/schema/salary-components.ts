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
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { employees } from "./employees.js";
import { payrollRunLines } from "./payroll.js";

export const salaryComponents = pgTable("salary_components", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 32 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  calculationBasis: varchar("calculation_basis", { length: 32 }).notNull().default("fixed"),
  defaultAmountCents: bigint("default_amount_cents", { mode: "number" }).notNull().default(0),
  defaultPercentBps: integer("default_percent_bps").notNull().default(0),
  countsForEpf: boolean("counts_for_epf").notNull().default(true),
  countsForEtf: boolean("counts_for_etf").notNull().default(true),
  countsForPaye: boolean("counts_for_paye").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type SalaryComponent = typeof salaryComponents.$inferSelect;
export type NewSalaryComponent = typeof salaryComponents.$inferInsert;

export const employeeSalaryComponents = pgTable("employee_salary_components", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  componentId: uuid("component_id").notNull().references(() => salaryComponents.id, { onDelete: "restrict" }),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
  percentBps: integer("percent_bps").notNull().default(0),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type EmployeeSalaryComponent = typeof employeeSalaryComponents.$inferSelect;
export type NewEmployeeSalaryComponent = typeof employeeSalaryComponents.$inferInsert;

export const payrollRunLineComponents = pgTable("payroll_run_line_components", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  lineId: uuid("line_id").notNull().references(() => payrollRunLines.id, { onDelete: "cascade" }),
  componentId: uuid("component_id").references(() => salaryComponents.id, { onDelete: "set null" }),
  code: varchar("code", { length: 32 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  countsForEpf: boolean("counts_for_epf").notNull(),
  countsForEtf: boolean("counts_for_etf").notNull(),
  countsForPaye: boolean("counts_for_paye").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PayrollRunLineComponent = typeof payrollRunLineComponents.$inferSelect;
export type NewPayrollRunLineComponent = typeof payrollRunLineComponents.$inferInsert;
