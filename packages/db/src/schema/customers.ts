import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  integer,
  bigint,
  text,
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 32 }),
  name: varchar("name", { length: 255 }).notNull(),
  legalName: varchar("legal_name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 32 }),
  whatsapp: varchar("whatsapp", { length: 32 }),
  addressLine1: varchar("address_line1", { length: 255 }),
  addressLine2: varchar("address_line2", { length: 255 }),
  city: varchar("city", { length: 128 }),
  postalCode: varchar("postal_code", { length: 16 }),
  country: varchar("country", { length: 2 }).notNull().default("LK"),
  tin: varchar("tin", { length: 32 }),
  vatNo: varchar("vat_no", { length: 32 }),
  brNo: varchar("br_no", { length: 32 }),
  paymentTermsDays: integer("payment_terms_days").notNull().default(0),
  creditLimitCents: bigint("credit_limit_cents", { mode: "number" }).notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("LKR"),
  priceListId: uuid("price_list_id"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
