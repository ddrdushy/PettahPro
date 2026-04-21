import { sql } from "drizzle-orm";
import { pgTable, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: uuid("updated_by_user_id"),
});

export type TenantSettingsRow = typeof tenantSettings.$inferSelect;
export type NewTenantSettingsRow = typeof tenantSettings.$inferInsert;
