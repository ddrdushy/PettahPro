import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id"),
  kind: varchar("kind", { length: 48 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: varchar("body", { length: 500 }),
  refType: varchar("ref_type", { length: 32 }),
  refId: uuid("ref_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
