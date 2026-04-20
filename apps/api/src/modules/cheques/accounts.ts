import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { schema } from "@pettahpro/db";

/**
 * Resolves the three cheque-lifecycle GL accounts for a tenant:
 *   - bank_transit   — cheques issued, not yet cleared at payee's bank
 *   - bank_clearing  — cheques received, not yet cleared at our bank
 *   - bank_fees      — bounce charges from the bank
 */
export async function resolveChequeGLAccounts(
  tx: PostgresJsDatabase<typeof schema>,
  tenantId: string,
): Promise<{
  bankTransitAccountId: string | null;
  bankClearingAccountId: string | null;
  bankFeesAccountId: string | null;
}> {
  const rows = await tx
    .select()
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        isNull(schema.chartOfAccounts.deletedAt),
      ),
    );
  const byKey = new Map(rows.map((r) => [`${r.accountType}:${r.accountSubtype}`, r.id]));
  return {
    bankTransitAccountId: byKey.get("asset:bank_transit") ?? null,
    bankClearingAccountId: byKey.get("asset:bank_clearing") ?? null,
    bankFeesAccountId: byKey.get("expense:bank_fees") ?? null,
  };
}
