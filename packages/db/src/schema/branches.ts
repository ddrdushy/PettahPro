import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp, boolean } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const branches = pgTable("branches", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 16 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  isHeadOffice: boolean("is_head_office").notNull().default(false),
  addressLine1: varchar("address_line1", { length: 255 }),
  addressLine2: varchar("address_line2", { length: 255 }),
  city: varchar("city", { length: 128 }),
  postalCode: varchar("postal_code", { length: 16 }),
  phone: varchar("phone", { length: 32 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
