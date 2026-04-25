import { sql } from "drizzle-orm";
import { schema, type Database } from "@pettahpro/db";

/**
 * Daily renewal sweep (#124). Fires after the trial-expiry job from
 * #63 and handles the rest of the lifecycle bookkeeping that piles up
 * once subscriptions, addons, and coupons are in motion:
 *
 *   1. Addon `pending_removal` → `cancelled` when current_period_end
 *      has elapsed. Spec §7.1 promises tenants keep features through
 *      the end of the cycle they cancelled in; this is what makes
 *      that promise hold.
 *
 *   2. Coupon redemption ticking. For every `active` redemption:
 *      - applies_for='once': flip to `consumed` (single-shot done).
 *      - applies_for='months': bump months_applied; flip to
 *        `consumed` when months_applied >= applies_for_months.
 *      - applies_for='forever': bump months_applied, never consume.
 *
 *   3. Subscription period rollover. For active / past_due rows
 *      whose current_period_end has elapsed, slide the window
 *      forward by the billing cycle. (Real billing would mint an
 *      invoice here; until then we just advance the clock so
 *      "next billing date" displays correctly.)
 *
 * All three steps are independent; a failure in one doesn't abort
 * the others. Each step writes platform_audit_log rows on success
 * for visibility.
 *
 * Idempotent — re-running a tick that already swept finds nothing
 * to do. Safe under worker outages: a 3-day downtime catches up
 * everything backed up on the next tick.
 *
 * Scope (deferred to follow-ups):
 *   * Real invoice generation per cycle (needs payment provider).
 *   * 60-day notification before grandfathered pricing renews
 *     (pricing-spec §12.1).
 *   * Per-tenant timezone respect — currently runs in server-time
 *     UTC. Fine for SL since it's a single-timezone market; if we
 *     ever go multi-country the rollover-at-tenant-midnight logic
 *     will need a join into `tenants.timezone`.
 */

const SYSTEM_USER_EMAIL = "system@pettahpro.lk";

interface Log {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface RenewalRunResult {
  addonsCancelled: number;
  couponsConsumed: number;
  couponsTicked: number;
  subscriptionsRolledOver: number;
  subscriptionsAutoResumed: number;
  errors: number;
}

export async function runRenewalCron(
  db: Database,
  log: Log,
): Promise<RenewalRunResult> {
  const result: RenewalRunResult = {
    addonsCancelled: 0,
    couponsConsumed: 0,
    couponsTicked: 0,
    subscriptionsRolledOver: 0,
    subscriptionsAutoResumed: 0,
    errors: 0,
  };

  // -----------------------------------------------------------------
  // Step 0 — Auto-resume paused subscriptions whose resume_at has
  // elapsed (#125). Slides currentPeriodStart to now and pushes
  // current_period_end out by the billing cycle so the next cycle
  // starts cleanly. Runs FIRST so the rollover step below gets a
  // chance to advance the just-resumed sub if it lands a couple of
  // ticks behind.
  // -----------------------------------------------------------------
  try {
    const rows = (await db.execute(sql`
      UPDATE tenant_subscriptions
         SET status = 'active',
             resume_at = NULL,
             current_period_start = now(),
             current_period_end = now() +
               (CASE billing_cycle
                  WHEN 'yearly' THEN interval '365 days'
                  ELSE interval '30 days'
                END),
             updated_at = now()
       WHERE status = 'paused'
         AND resume_at IS NOT NULL
         AND resume_at < now()
       RETURNING id, tenant_id
    `)) as unknown as Array<{ id: string; tenant_id: string }>;

    for (const row of rows) {
      result.subscriptionsAutoResumed++;
      await writeAudit(db, {
        tenantId: row.tenant_id,
        kind: "subscription.auto_resumed",
        summary: "Subscription auto-resumed after scheduled pause window",
        metadata: { subscriptionId: row.id },
      });
    }

    if (result.subscriptionsAutoResumed > 0) {
      log.info(
        { count: result.subscriptionsAutoResumed },
        "subscriptions auto-resumed",
      );
    }
  } catch (err) {
    result.errors++;
    log.error({ err }, "renewal-cron: step 0 (auto-resume) failed");
  }

  // -----------------------------------------------------------------
  // Step 1 — Addon pending_removal → cancelled when period elapsed.
  // -----------------------------------------------------------------
  try {
    const rows = (await db.execute(sql`
      UPDATE tenant_addons
         SET status = 'cancelled',
             cancelled_at = COALESCE(cancelled_at, now()),
             cancel_reason = COALESCE(cancel_reason, 'Period ended after scheduled removal'),
             updated_at = now()
       WHERE status = 'pending_removal'
         AND current_period_end < now()
       RETURNING id, tenant_id, addon_id
    `)) as unknown as Array<{
      id: string;
      tenant_id: string;
      addon_id: string;
    }>;

    for (const row of rows) {
      result.addonsCancelled++;
      await writeAudit(db, {
        tenantId: row.tenant_id,
        kind: "subscription.addon.cancelled_after_period",
        summary: "Add-on cancelled after period end (scheduled removal)",
        metadata: { tenantAddonId: row.id, addonId: row.addon_id },
      });
    }

    if (result.addonsCancelled > 0) {
      log.info(
        { count: result.addonsCancelled },
        "addons cancelled after pending_removal period elapsed",
      );
    }
  } catch (err) {
    result.errors++;
    log.error({ err }, "renewal-cron: step 1 (addon cancellation) failed");
  }

  // -----------------------------------------------------------------
  // Step 2a — Tick `applies_for='once'` redemptions: bump
  // months_applied to 1 and flip to consumed in one statement.
  // Only redemptions whose subscription's current_period_end has
  // elapsed have actually been billed (in the future, with real
  // billing); for now we treat once-coupons as consumed on the next
  // sweep after redemption, as long as a billing cycle elapsed.
  //
  // To avoid prematurely consuming a coupon redeemed yesterday on
  // a sub whose period_end is still 28 days out, we join to the
  // subscription and gate on the period boundary.
  // -----------------------------------------------------------------
  try {
    const rows = (await db.execute(sql`
      UPDATE coupon_redemptions r
         SET status = 'consumed',
             months_applied = 1,
             consumed_at = now(),
             updated_at = now()
        FROM tenant_subscriptions s
       WHERE r.tenant_id = s.tenant_id
         AND r.status = 'active'
         AND r.applies_for = 'once'
         AND s.current_period_end < now()
       RETURNING r.id, r.tenant_id, r.coupon_id
    `)) as unknown as Array<{
      id: string;
      tenant_id: string;
      coupon_id: string;
    }>;

    for (const row of rows) {
      result.couponsConsumed++;
      await writeAudit(db, {
        tenantId: row.tenant_id,
        kind: "subscription.coupon.consumed",
        summary: "Coupon (once) consumed after billing period",
        metadata: {
          redemptionId: row.id,
          couponId: row.coupon_id,
          appliesFor: "once",
        },
      });
    }

    if (result.couponsConsumed > 0) {
      log.info(
        { count: result.couponsConsumed },
        "once-coupons consumed after billing period",
      );
    }
  } catch (err) {
    result.errors++;
    log.error({ err }, "renewal-cron: step 2a (once coupons) failed");
  }

  // -----------------------------------------------------------------
  // Step 2b — Tick `applies_for='months'` redemptions: bump
  // months_applied; if it now equals applies_for_months, flip to
  // consumed. Single statement using a CASE expression so the flip
  // and the increment land atomically per row.
  //
  // Same period-elapsed gate as 2a so we don't tick a redemption
  // whose subscription period hasn't actually rolled over yet.
  // -----------------------------------------------------------------
  try {
    const rows = (await db.execute(sql`
      UPDATE coupon_redemptions r
         SET months_applied = r.months_applied + 1,
             status = CASE
                 WHEN r.applies_for_months IS NOT NULL
                  AND r.months_applied + 1 >= r.applies_for_months
                 THEN 'consumed'
                 ELSE 'active'
               END,
             consumed_at = CASE
                 WHEN r.applies_for_months IS NOT NULL
                  AND r.months_applied + 1 >= r.applies_for_months
                 THEN now()
                 ELSE r.consumed_at
               END,
             updated_at = now()
        FROM tenant_subscriptions s
       WHERE r.tenant_id = s.tenant_id
         AND r.status = 'active'
         AND r.applies_for = 'months'
         AND s.current_period_end < now()
       RETURNING r.id, r.tenant_id, r.coupon_id, r.status, r.months_applied
    `)) as unknown as Array<{
      id: string;
      tenant_id: string;
      coupon_id: string;
      status: string;
      months_applied: number;
    }>;

    for (const row of rows) {
      result.couponsTicked++;
      if (row.status === "consumed") result.couponsConsumed++;
      await writeAudit(db, {
        tenantId: row.tenant_id,
        kind:
          row.status === "consumed"
            ? "subscription.coupon.consumed"
            : "subscription.coupon.month_applied",
        summary:
          row.status === "consumed"
            ? "Coupon (months) consumed after final billing period"
            : "Coupon (months) advanced one billing period",
        metadata: {
          redemptionId: row.id,
          couponId: row.coupon_id,
          appliesFor: "months",
          monthsApplied: row.months_applied,
        },
      });
    }

    if (result.couponsTicked > 0) {
      log.info(
        { count: result.couponsTicked },
        "months-coupons ticked one period",
      );
    }
  } catch (err) {
    result.errors++;
    log.error({ err }, "renewal-cron: step 2b (months coupons) failed");
  }

  // Step 2c — `forever` coupons just bump the counter, never consume.
  // Same gate; no audit per tick (would be too noisy across years).
  try {
    await db.execute(sql`
      UPDATE coupon_redemptions r
         SET months_applied = r.months_applied + 1,
             updated_at = now()
        FROM tenant_subscriptions s
       WHERE r.tenant_id = s.tenant_id
         AND r.status = 'active'
         AND r.applies_for = 'forever'
         AND s.current_period_end < now()
    `);
  } catch (err) {
    result.errors++;
    log.error({ err }, "renewal-cron: step 2c (forever coupons) failed");
  }

  // -----------------------------------------------------------------
  // Step 3 — Subscription period rollover. Slide the window forward
  // by the billing cycle for active / past_due rows whose period has
  // elapsed. Important: this MUST run after the coupon-ticking steps
  // so the redemption sweep sees the OLD period_end as elapsed
  // (otherwise we'd never tick anything — the rollover would always
  // race ahead).
  //
  // Math: 30 days for monthly, 365 for yearly. A leap year off-by-one
  // is fine for v1; real billing will compute proper calendar deltas
  // when invoice generation lands.
  // -----------------------------------------------------------------
  try {
    const rows = (await db.execute(sql`
      UPDATE tenant_subscriptions
         SET current_period_start = current_period_end,
             current_period_end = current_period_end +
               (CASE billing_cycle
                  WHEN 'yearly' THEN interval '365 days'
                  ELSE interval '30 days'
                END),
             updated_at = now()
       WHERE status IN ('active', 'past_due')
         AND current_period_end < now()
       RETURNING id, tenant_id, billing_cycle
    `)) as unknown as Array<{
      id: string;
      tenant_id: string;
      billing_cycle: string;
    }>;

    for (const row of rows) {
      result.subscriptionsRolledOver++;
      await writeAudit(db, {
        tenantId: row.tenant_id,
        kind: "subscription.period_rolled_over",
        summary: `Billing period rolled forward (${row.billing_cycle})`,
        metadata: {
          subscriptionId: row.id,
          billingCycle: row.billing_cycle,
        },
      });
    }

    if (result.subscriptionsRolledOver > 0) {
      log.info(
        { count: result.subscriptionsRolledOver },
        "subscription periods rolled over",
      );
    }
  } catch (err) {
    result.errors++;
    log.error({ err }, "renewal-cron: step 3 (period rollover) failed");
  }

  return result;
}

async function writeAudit(
  db: Database,
  input: {
    tenantId: string;
    kind: string;
    summary: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.insert(schema.platformAuditLog).values({
      platformUserId: null,
      platformUserEmail: SYSTEM_USER_EMAIL,
      kind: input.kind,
      summary: input.summary,
      reason: null,
      tenantId: input.tenantId,
      ipAddress: null,
      userAgent: null,
      metadata: input.metadata,
    });
  } catch (err) {
    // Match trial-expiry: a failed audit write doesn't roll back the
    // state change above. Missing audit rows are findable from the
    // resulting state diff anyway.
    // eslint-disable-next-line no-console
    console.error("renewal-cron audit write failed", err);
  }
}
