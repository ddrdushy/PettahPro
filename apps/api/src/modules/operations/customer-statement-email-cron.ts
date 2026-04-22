import { sql } from "drizzle-orm";
import type { Database } from "@pettahpro/db";
import { sendCustomerStatementEmail } from "./customer-statement-email.js";

/**
 * Monthly statement-email dispatcher.
 *
 * Fired from the BullMQ scheduled queue every few hours. The SQL helper
 * `list_customers_for_statement_email` returns (customer_id, tenant_id) pairs
 * for every customer where:
 *   · auto_statement_email = true
 *   · statement_email_day = EXTRACT(day FROM today)
 *   · and no scheduled email has already gone out today (dedup)
 *
 * For each match we send the statement for the calendar month that just
 * ended — e.g. cron firing on May 1 with day 1 emails the April 1–30
 * statement. If day_of_month is mid-month (e.g. 15), the period is the
 * trailing 30-day window ending yesterday.
 */
export async function runScheduledStatementEmails(
  dbClient: Database,
  log: {
    info: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  },
): Promise<{ sent: number; failed: number; skipped: number }> {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Discover candidates across all tenants. SECURITY DEFINER bypasses RLS
  // so we can see every tenant's customer rows without cycling through
  // tenant contexts to enumerate.
  const candidates = (await dbClient.execute(sql`
    SELECT customer_id, tenant_id FROM list_customers_for_statement_email(${todayStr}::date)
  `)) as unknown as Array<{ customer_id: string; tenant_id: string }>;

  if (candidates.length === 0) {
    log.info({ count: 0 }, "no customers scheduled for statement email today");
    return { sent: 0, failed: 0, skipped: 0 };
  }

  // Period = trailing calendar month. If cron fires on day 1, this is the
  // previous month in full. On any other day it's the 30-day window ending
  // yesterday — a reasonable default for mid-month billing cycles.
  const { from, to } = computeCronRange(today);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of candidates) {
    try {
      const r = await sendCustomerStatementEmail({
        tenantId: row.tenant_id,
        userId: null,
        customerId: row.customer_id,
        from,
        to,
        triggerKind: "scheduled",
      });
      if (r.status === "sent") sent++;
      else if (r.status === "failed") failed++;
      else skipped++;

      log.info(
        {
          tenantId: row.tenant_id,
          customerId: row.customer_id,
          status: r.status,
          toEmail: r.toEmail,
        },
        "scheduled statement email processed",
      );
    } catch (err) {
      failed++;
      log.error(
        { tenantId: row.tenant_id, customerId: row.customer_id, err },
        "scheduled statement email crashed",
      );
    }
  }

  return { sent, failed, skipped };
}

export function computeCronRange(today: Date): { from: string; to: string } {
  const day = today.getDate();
  if (day === 1) {
    // First of the month — use the prior calendar month in full.
    const y = today.getFullYear();
    const m = today.getMonth(); // 0-indexed; prior month naturally clamps
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0); // day 0 of current month = last day of prior
    return {
      from: toISODate(first),
      to: toISODate(last),
    };
  }
  // Mid-month send — 30-day trailing window ending yesterday.
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const start = new Date(yesterday);
  start.setDate(start.getDate() - 29);
  return { from: toISODate(start), to: toISODate(yesterday) };
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
