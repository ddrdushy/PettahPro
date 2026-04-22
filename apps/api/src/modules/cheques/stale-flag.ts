import { sql } from "drizzle-orm";
import { schema, withTenant, type Database } from "@pettahpro/db";
import { emitNotification } from "../notifications/emit.js";

/**
 * Daily stale-cheque flagger.
 *
 * Runs once per day from the BullMQ scheduled queue (see worker.ts).
 * Calls the SQL function flag_stale_cheques() per-tenant — the function
 * flips any cheque in an active state (drafted/issued/presented for issued
 * direction; received/deposited/in_clearing for received direction) to
 * status='stale' when stale_at <= CURRENT_DATE.
 *
 * Per SL banking convention cheques go stale 6 months from the cheque date
 * — banks refuse to present past that. Keeping them in "active" state after
 * that point pollutes AR/AP reports and gives users a false sense of
 * "payment still coming".
 *
 * For each flipped cheque we emit a notification so:
 *   · received cheques: whoever's chasing collections sees "the cheque you
 *     booked hasn't cleared in 6 months — chase the customer for a replacement".
 *   · issued cheques: AP sees "our cheque never cleared — reach out to the
 *     supplier, we may need to reissue".
 *
 * Broadcast notifications (userId: null) land in every user's bell — we
 * don't know who specifically is watching AR/AP at this tenant, and stale
 * cheques are cheap (a handful per tenant per month in practice).
 */
export async function runStaleChequeFlagging(
  db: Database,
  log: {
    info: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  },
): Promise<{ flagged: number; tenants: number; errors: number }> {
  // Step 1: find every tenant that has at least one cheque due to go stale.
  // A bypass-RLS query against the partial index is effectively free.
  const tenantRows = (await db.execute(sql`
    SELECT DISTINCT tenant_id
      FROM cheques
     WHERE status IN (
             'drafted','issued','presented',
             'received','deposited','in_clearing'
           )
       AND stale_at IS NOT NULL
       AND stale_at <= CURRENT_DATE
  `)) as unknown as Array<{ tenant_id: string }>;

  if (tenantRows.length === 0) {
    log.info({ tenants: 0 }, "no stale cheques to flag today");
    return { flagged: 0, tenants: 0, errors: 0 };
  }

  let flagged = 0;
  let errors = 0;

  for (const row of tenantRows) {
    try {
      const result = await runStaleFlaggingForTenant(db, row.tenant_id);
      flagged += result.flagged;
      log.info(
        { tenantId: row.tenant_id, flagged: result.flagged },
        "stale cheques flagged for tenant",
      );
    } catch (err) {
      errors++;
      log.error(
        { tenantId: row.tenant_id, err },
        "stale cheque flagging failed for tenant",
      );
    }
  }

  return { flagged, tenants: tenantRows.length, errors };
}

interface FlaggedRow {
  id: string;
  tenant_id: string;
  cheque_number: string;
  direction: "received" | "issued";
  amount_cents: string | number;
  stale_at: string;
  customer_id: string | null;
  supplier_id: string | null;
  bank_account_id: string | null;
}

/**
 * Per-tenant flagger. Runs inside a withTenant tx so RLS applies and the
 * SQL function's UPDATE only touches this tenant's rows. Returns the
 * flipped cheques for optional re-use (the manual trigger endpoint uses
 * this to show a summary).
 */
export async function runStaleFlaggingForTenant(
  db: Database,
  tenantId: string,
): Promise<{ flagged: number; rows: FlaggedRow[] }> {
  const rows = await withTenant(tenantId, async (tx) => {
    const flipped = (await tx.execute(sql`
      SELECT id, tenant_id, cheque_number, direction, amount_cents,
             stale_at, customer_id, supplier_id, bank_account_id
        FROM flag_stale_cheques()
    `)) as unknown as FlaggedRow[];

    for (const row of flipped) {
      const amountLkr = (Number(row.amount_cents) / 100).toLocaleString("en", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const direction = row.direction;
      const title =
        direction === "received"
          ? `Cheque ${row.cheque_number} is stale`
          : `Our cheque ${row.cheque_number} is stale`;
      const body =
        direction === "received"
          ? `A customer cheque for LKR ${amountLkr} hasn't cleared in 6 months. Request a replacement.`
          : `An issued cheque for LKR ${amountLkr} hasn't cleared in 6 months. Reissue if the supplier still expects payment.`;

      await emitNotification(tx, {
        tenantId: row.tenant_id,
        userId: null, // broadcast to the tenant
        kind: "cheque.stale",
        title,
        body,
        refType: "cheque",
        refId: row.id,
      });
    }

    return flipped;
  });

  return { flagged: rows.length, rows };
}
