import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp, boolean } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { branches } from "./branches.js";

export const warehouses = pgTable("warehouses", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  code: varchar("code", { length: 16 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Warehouse = typeof warehouses.$inferSelect;
export type NewWarehouse = typeof warehouses.$inferInsert;
