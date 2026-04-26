import { sql } from "drizzle-orm";
import { schema, type Database } from "@pettahpro/db";

/**
 * Daily tenant-health-score sweep (#134 / super-admin spec §4.10).
 *
 * For every non-deleted tenant, compute four sub-scores (each 0-25)
 * and persist a new row in tenant_health_scores. The platform UI
 * reads the latest row per tenant.
 *
 * Sub-scores:
 *   * loginScore — penalty grows with days since last login.
 *   * transactionScore — invoice-volume trend over last 30 days vs
 *     the prior 30. A tenant who used to post and stopped is the
 *     most actionable churn signal we have.
 *   * subscriptionScore — derived from subscription state. Active
 *     = full marks; trial near expiry / past_due = half; paused =
 *     low; cancelled = zero.
 *   * setupScore — has the tenant gotten through onboarding?
 *     Has a customer? Has an item? Has posted any invoice?
 *
 * Risk level derived from total:
 *   80-100 healthy, 60-79 medium, 40-59 high, 0-39 critical.
 *
 * Reasons array is built incrementally as each sub-score is computed,
 * so the UI can render specific "why" pills under each tenant. v1
 * keeps it terse — strings under ~80 chars.
 *
 * Idempotent — every run inserts a fresh snapshot. Running daily
 * gives a 365-row history per tenant per year; trend queries can
 * compare any two snapshots without recomputing.
 *
 * All queries run outside RLS — platform-side aggregates need to
 * see every tenant.
 */

interface Log {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface HealthRunResult {
  tenantsScored: number;
  byRisk: { low: number; medium: number; high: number; critical: number };
  errors: number;
}

interface PerTenantStats {
  tenant_id: string;
  // login
  last_login_at: Date | null;
  // transactions
  invoices_last_30d: number | string;
  invoices_prior_30d: number | string;
  invoices_lifetime: number | string;
  // subscription
  sub_status: string | null;
  trial_ends_at: Date | null;
  // setup
  customer_count: number | string;
  item_count: number | string;
}

export async function runTenantHealthCron(
  db: Database,
  log: Log,
): Promise<HealthRunResult> {
  const result: HealthRunResult = {
    tenantsScored: 0,
    byRisk: { low: 0, medium: 0, high: 0, critical: 0 },
    errors: 0,
  };

  try {
    // One trip pulls every signal we need. The LATERAL joins keep
    // the per-tenant aggregates O(rows-touched) without a Cartesian
    // explosion across the unrelated counts. Tenants with zero rows
    // in any subtable get 0 from the COALESCE.
    const rows = (await db.execute(sql`
      SELECT
        t.id AS tenant_id,
        (
          SELECT MAX(u.last_login_at)
          FROM users u
          WHERE u.tenant_id = t.id AND u.deleted_at IS NULL
        ) AS last_login_at,
        (
          SELECT COUNT(*)::bigint
          FROM invoices i
          WHERE i.tenant_id = t.id
            AND i.deleted_at IS NULL
            AND i.issue_date >= (CURRENT_DATE - interval '30 days')
        ) AS invoices_last_30d,
        (
          SELECT COUNT(*)::bigint
          FROM invoices i
          WHERE i.tenant_id = t.id
            AND i.deleted_at IS NULL
            AND i.issue_date >= (CURRENT_DATE - interval '60 days')
            AND i.issue_date <  (CURRENT_DATE - interval '30 days')
        ) AS invoices_prior_30d,
        (
          SELECT COUNT(*)::bigint
          FROM invoices i
          WHERE i.tenant_id = t.id AND i.deleted_at IS NULL
        ) AS invoices_lifetime,
        s.status AS sub_status,
        s.trial_ends_at,
        (
          SELECT COUNT(*)::bigint
          FROM customers c
          WHERE c.tenant_id = t.id AND c.deleted_at IS NULL
        ) AS customer_count,
        (
          SELECT COUNT(*)::bigint
          FROM items it
          WHERE it.tenant_id = t.id AND it.deleted_at IS NULL
        ) AS item_count
      FROM tenants t
      LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
      WHERE t.deleted_at IS NULL
    `)) as unknown as PerTenantStats[];

    for (const row of rows) {
      try {
        const reasons: string[] = [];

        // -----------------------------------------------------------
        // loginScore (0-25). 25 = logged in today; drops linearly
        // through 14 days; 0 by 30+ days. Never logged in = 5
        // (could be a fresh signup, give the benefit of the doubt
        // for the first day).
        // -----------------------------------------------------------
        let loginScore: number;
        if (!row.last_login_at) {
          loginScore = 5;
          reasons.push("Owner has never logged in");
        } else {
          const daysSinceLogin =
            (Date.now() - new Date(row.last_login_at).getTime()) /
            (24 * 60 * 60 * 1000);
          if (daysSinceLogin <= 1) loginScore = 25;
          else if (daysSinceLogin <= 7) loginScore = 22;
          else if (daysSinceLogin <= 14) loginScore = 15;
          else if (daysSinceLogin <= 30) loginScore = 8;
          else {
            loginScore = 0;
            reasons.push(
              `No login in ${Math.floor(daysSinceLogin)} days`,
            );
          }
          if (daysSinceLogin > 14 && daysSinceLogin <= 30) {
            reasons.push(
              `Last login ${Math.floor(daysSinceLogin)} days ago`,
            );
          }
        }

        // -----------------------------------------------------------
        // transactionScore (0-25). 25 = healthy invoice posting in
        // last 30 days. 0 = nothing in 60 days. Trend matters: a
        // tenant who used to post and stopped scores worse than one
        // who never started.
        // -----------------------------------------------------------
        const last30 = Number(row.invoices_last_30d);
        const prior30 = Number(row.invoices_prior_30d);
        let transactionScore: number;
        if (last30 >= 10) transactionScore = 25;
        else if (last30 >= 5) transactionScore = 20;
        else if (last30 >= 1) transactionScore = 15;
        else if (prior30 > 0) {
          transactionScore = 0;
          reasons.push(
            `Stopped invoicing — ${prior30} in prior 30d, 0 last 30d`,
          );
        } else {
          // Never invoiced. New signup grace.
          transactionScore = Number(row.invoices_lifetime) === 0 ? 8 : 5;
          if (Number(row.invoices_lifetime) === 0) {
            // Don't add a reason — "never invoiced" is the trial
            // default, not a churn signal on its own.
          }
        }
        if (last30 > 0 && prior30 > 0 && last30 < prior30 * 0.5) {
          // Volume dropped >50% — flag even if score is non-zero
          // because the trend is the signal.
          const drop = Math.round(((prior30 - last30) / prior30) * 100);
          reasons.push(`Invoice volume down ${drop}%`);
        }

        // -----------------------------------------------------------
        // subscriptionScore (0-25). State machine maps directly.
        // Trial near expiry (≤7d) is the "convert or churn" moment.
        // -----------------------------------------------------------
        let subscriptionScore: number;
        const status = row.sub_status ?? "trial";
        if (status === "active") subscriptionScore = 25;
        else if (status === "trial") {
          const trialEnds = row.trial_ends_at
            ? new Date(row.trial_ends_at).getTime()
            : null;
          const daysToExpiry = trialEnds
            ? (trialEnds - Date.now()) / (24 * 60 * 60 * 1000)
            : null;
          if (daysToExpiry == null) subscriptionScore = 18;
          else if (daysToExpiry <= 0) {
            subscriptionScore = 5;
            reasons.push("Trial expired");
          } else if (daysToExpiry <= 3) {
            subscriptionScore = 10;
            reasons.push(`Trial ends in ${Math.ceil(daysToExpiry)} days`);
          } else if (daysToExpiry <= 7) {
            subscriptionScore = 15;
            reasons.push(`Trial ends in ${Math.ceil(daysToExpiry)} days`);
          } else subscriptionScore = 18;
        } else if (status === "past_due") {
          subscriptionScore = 8;
          reasons.push("Subscription past due");
        } else if (status === "paused") {
          subscriptionScore = 10;
          reasons.push("Subscription paused");
        } else if (status === "cancelled") {
          subscriptionScore = 0;
          reasons.push("Subscription cancelled");
        } else {
          subscriptionScore = 5;
        }

        // -----------------------------------------------------------
        // setupScore (0-25). Has the tenant actually gotten started?
        // Three checkpoints (8/9/8 = 25 max): customers, items, posted
        // any invoice ever.
        // -----------------------------------------------------------
        let setupScore = 0;
        const customerCount = Number(row.customer_count);
        const itemCount = Number(row.item_count);
        const lifetimeInvoices = Number(row.invoices_lifetime);
        if (customerCount > 0) setupScore += 8;
        if (itemCount > 0) setupScore += 9;
        if (lifetimeInvoices > 0) setupScore += 8;
        if (setupScore < 8 && status === "trial") {
          // Trial tenant who hasn't even added a customer is the
          // classic "looked, didn't engage" pattern.
          reasons.push("Onboarding stalled — no customers yet");
        }

        const total =
          loginScore +
          transactionScore +
          subscriptionScore +
          setupScore;
        const riskLevel: "low" | "medium" | "high" | "critical" =
          total >= 80
            ? "low"
            : total >= 60
              ? "medium"
              : total >= 40
                ? "high"
                : "critical";

        await db.insert(schema.tenantHealthScores).values({
          tenantId: row.tenant_id,
          score: total,
          riskLevel,
          loginScore,
          transactionScore,
          subscriptionScore,
          setupScore,
          reasons,
        });

        result.tenantsScored++;
        result.byRisk[riskLevel]++;
      } catch (err) {
        result.errors++;
        log.error(
          { err, tenantId: row.tenant_id },
          "tenant-health-cron: per-tenant compute failed",
        );
      }
    }

    log.info(
      {
        scored: result.tenantsScored,
        byRisk: result.byRisk,
      },
      "tenant-health-cron: completed",
    );
  } catch (err) {
    result.errors++;
    log.error({ err }, "tenant-health-cron: outer query failed");
  }

  return result;
}
