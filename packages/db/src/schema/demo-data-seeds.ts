import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Demo-data seed tracking (#136 / gaps I1).
 *
 * One row per record inserted by `seed_demo_data()` so
 * `clear_demo_data()` can find and remove just the demo records
 * without scanning every table for naming conventions or tags.
 * RLS-isolated like every other tenant-scoped table.
 */
export const demoDataSeeds = pgTable(
  "demo_data_seeds",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    tableName: text("table_name").notNull(),
    recordId: uuid("record_id").notNull(),
    seededAt: timestamp("seeded_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    tenantIdx: index("demo_data_seeds_tenant_idx").on(t.tenantId, t.seededAt),
  }),
);
