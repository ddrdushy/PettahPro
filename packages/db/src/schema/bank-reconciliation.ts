import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  bigint,
  integer,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { chartOfAccounts } from "./accounts.js";

export const bankStatementImports = pgTable("bank_statement_imports", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  statementFromDate: date("statement_from_date").notNull(),
  statementToDate: date("statement_to_date").notNull(),
  openingBalanceCents: bigint("opening_balance_cents", { mode: "number" }),
  closingBalanceCents: bigint("closing_balance_cents", { mode: "number" }),
  totalLines: integer("total_lines").notNull().default(0),
  matchedLines: integer("matched_lines").notNull().default(0),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  notes: text("notes"),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  reconciledByUserId: uuid("reconciled_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id"),
});

export type BankStatementImport = typeof bankStatementImports.$inferSelect;
export type NewBankStatementImport = typeof bankStatementImports.$inferInsert;

export const bankStatementLines = pgTable("bank_statement_lines", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  importId: uuid("import_id").notNull().references(() => bankStatementImports.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull(),
  transactionDate: date("transaction_date").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  reference: varchar("reference", { length: 128 }),
  matchStatus: varchar("match_status", { length: 16 }).notNull().default("unmatched"),
  matchedRefType: varchar("matched_ref_type", { length: 32 }),
  matchedRefId: uuid("matched_ref_id"),
  matchNotes: text("match_notes"),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  matchedByUserId: uuid("matched_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BankStatementLine = typeof bankStatementLines.$inferSelect;
export type NewBankStatementLine = typeof bankStatementLines.$inferInsert;
