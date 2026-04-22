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
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { customers } from "./customers.js";
import { users } from "./users.js";

export const customerStatementEmails = pgTable("customer_statement_emails", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  toEmail: varchar("to_email", { length: 255 }).notNull(),
  ccEmails: jsonb("cc_emails").$type<string[]>().notNull().default([]),
  subject: varchar("subject", { length: 500 }).notNull(),
  statementFrom: date("statement_from"),
  statementTo: date("statement_to").notNull(),
  openingBalanceCents: bigint("opening_balance_cents", { mode: "number" })
    .notNull()
    .default(0),
  closingBalanceCents: bigint("closing_balance_cents", { mode: "number" })
    .notNull()
    .default(0),
  transactionCount: integer("transaction_count").notNull().default(0),
  status: varchar("status", { length: 16 }).notNull(),
  errorMessage: text("error_message"),
  messageId: varchar("message_id", { length: 255 }),
  transport: varchar("transport", { length: 16 }).notNull().default("smtp"),
  triggerKind: varchar("trigger_kind", { length: 16 })
    .notNull()
    .default("manual"),
  triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CustomerStatementEmail =
  typeof customerStatementEmails.$inferSelect;
export type NewCustomerStatementEmail =
  typeof customerStatementEmails.$inferInsert;
