import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const connectionString =
  process.env.DATABASE_URL ??
  (() => {
    throw new Error("DATABASE_URL is not set");
  })();

// Transaction-mode PgBouncer needs prepare=false.
export const queryClient = postgres(connectionString, {
  prepare: false,
  max: 20,
});

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;

/**
 * Run a block of work inside a DB transaction with the tenant context set.
 * RLS policies read `app.tenant_id` via the `current_tenant_id()` function.
 *
 * Usage:
 *   await withTenant(tenantId, async (tx) => {
 *     return tx.select().from(schema.invoices);
 *   });
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as Database);
  });
}

export { schema };
