import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  timestamp,
  numeric,
  bigint,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { stockLedger } from "./stock.js";
import { itemBatches } from "./item-batches.js";

// Records which batches contributed what qty to a single outbound
// movement. A stock issue that spans two batches (FIFO crossed a
// boundary) creates two allocation rows sharing the same
// stock_ledger_id. Recall report reads this table to enumerate every
// invoice/DN that issued from a specific batch.
export const stockMovementBatchAllocations = pgTable(
  "stock_movement_batch_allocations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    stockLedgerId: uuid("stock_ledger_id")
      .notNull()
      .references(() => stockLedger.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => itemBatches.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type StockMovementBatchAllocation =
  typeof stockMovementBatchAllocations.$inferSelect;
export type NewStockMovementBatchAllocation =
  typeof stockMovementBatchAllocations.$inferInsert;
