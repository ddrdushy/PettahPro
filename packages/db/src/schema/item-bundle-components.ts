import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  numeric,
  smallint,
  timestamp,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { items } from "./items.js";

// Bundle/kit components (roadmap #35). One row per (bundle, component)
// pair. Bundle items themselves never carry stock; at invoice post
// each component is issued for (line qty × component qty) and its
// weighted-average cost rolls into the invoice's total COGS. The
// bundle stays one invoice line — we never disaggregate into
// component lines on the document. See
// `docker/postgres/init/74-item-bundle-components.sql` for the full
// design rationale.
export const itemBundleComponents = pgTable("item_bundle_components", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  // Parent bundle. Cascade-delete on a hard item delete; bundles are
  // normally soft-deleted so the component rows survive.
  bundleItemId: uuid("bundle_item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  // Component. RESTRICT on hard delete — a component referenced by a
  // bundle can't disappear from under it. Soft-delete via
  // `items.deleted_at` is fine; the explosion at sale time filters it
  // out.
  componentItemId: uuid("component_item_id")
    .notNull()
    .references(() => items.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  sortOrder: smallint("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ItemBundleComponent = typeof itemBundleComponents.$inferSelect;
export type NewItemBundleComponent = typeof itemBundleComponents.$inferInsert;
