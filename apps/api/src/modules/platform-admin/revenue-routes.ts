import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "@pettahpro/db";
import { requirePlatformSession, requirePlatformRole } from "./routes.js";

/**
 * Revenue analytics dashboard (#131 / super-admin spec §11).
 *
 * Now that L2 ships real subscription / addon / coupon data,
 * super-admin needs a one-page operating view: MRR, ARR, active
 * tenant counts by status, churn this month, MRR by plan, signup
 * trend, addon and coupon impact.
 *
 * Access: any platform staff role can read (super_admin, support,
 * billing — billing especially needs this for forecasts; support
 * for context on tenant calls).
 *
 * v1 scope (deferred to follow-ups):
 *   * Cohort retention curves — needs a calendar of trial→paid
 *     transitions over time, more involved
 *   * Geographic breakdown by city/region — tenants don't carry
 *     city today (only country)
 *   * LTV / CAC — needs acquisition-cost data we don't capture
 *   * Failed-payment trend — needs real billing first
 *
 * All queries run outside RLS — platform tables are platform-only,
 * cross-tenant aggregates are exactly what super-admin needs.
 */

// MRR conversion: yearly cycle prices divide by 12 to monthly
// equivalent. Trial / past_due / paused / cancelled rows excluded
// from MRR — the spec is explicit that MRR counts contracted, paying
// customers. Past-due is in the grace window so technically still
// expected revenue, but spec §11 examples show MRR as
// active-only — match that.
const MRR_SQL = sql`
  COALESCE(SUM(
    CASE
      WHEN s.status = 'active' AND s.billing_cycle = 'yearly'
        THEN p.yearly_price_cents / 12
      WHEN s.status = 'active' AND s.billing_cycle = 'monthly'
        THEN p.monthly_price_cents
      ELSE 0
    END
  ), 0)::bigint
`;

interface RevenuePayload {
  mrrCents: number;
  arrCents: number;
  // Status counts — drives the lifecycle health pill row.
  tenantCountsByStatus: {
    trial: number;
    active: number;
    past_due: number;
    paused: number;
    cancelled: number;
  };
  // Per-plan MRR + active subscriber count, sorted by MRR desc.
  mrrByPlan: Array<{
    planCode: string;
    planName: string;
    activeSubscribers: number;
    mrrCents: number;
  }>;
  // Activity windows — most operators want "this month" + "last 30
  // days" + "12-month trend" all on the same screen.
  signups: {
    last30Days: number;
    last12Months: Array<{ monthStart: string; count: number }>;
  };
  trialConversion: {
    // Trial → active conversions in the last 30 days (last_login
    // in the window, status='active', and previously had a trial).
    // Without a transition log we approximate via subscription
    // updated_at + a JSON marker on platform_audit_log; v1 just
    // shows the simpler "trials that became active in this window."
    last30DaysConverted: number;
    last30DaysExpired: number;
    // Conversion rate over the same window. Null when nothing was
    // resolved yet (avoids divide-by-zero ugliness on a fresh DB).
    rate: number | null;
  };
  churn: {
    // Churned this month = subscriptions cancelled with cancelled_at
    // in the current calendar month.
    thisMonthCount: number;
    thisMonthMrrCents: number;
    // Churn rate = cancelled this month / active-at-month-start. The
    // denominator is the dashboard at the *start* of the month — we
    // approximate with current active + cancelled-this-month, which
    // overcounts slightly but doesn't need an event-log replay. A
    // proper time-travel calc lands when we have a snapshot table.
    rate: number | null;
  };
  addons: {
    // MRR contribution from active add-ons — same monthly-equivalent
    // math as plans.
    mrrCents: number;
    activeCount: number;
  };
  coupons: {
    // Active redemptions = grants that haven't been consumed yet.
    activeRedemptions: number;
    // New redemptions this month — useful for "did the campaign
    // land?" analysis.
    redeemedThisMonth: number;
  };
}

export const revenueAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/revenue", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (
      !(await requirePlatformRole(req, reply, session, [
        "super_admin",
        "support",
        "billing",
      ]))
    ) {
      return;
    }

    // Status counts + MRR in one trip — single GROUP BY across the
    // join. Yearly cycles divide by 12 inline so the response is
    // monthly-equivalent regardless of mix.
    const statusRows = (await db.execute(sql`
      SELECT
        s.status,
        COUNT(*)::int AS n,
        ${MRR_SQL} AS mrr_cents
      FROM tenant_subscriptions s
      LEFT JOIN plans p ON p.id = s.plan_id
      GROUP BY s.status
    `)) as unknown as Array<{
      status: string;
      n: number;
      mrr_cents: number | string;
    }>;

    const tenantCountsByStatus = {
      trial: 0,
      active: 0,
      past_due: 0,
      paused: 0,
      cancelled: 0,
    };
    let mrrCents = 0;
    for (const r of statusRows) {
      if (r.status in tenantCountsByStatus) {
        tenantCountsByStatus[r.status as keyof typeof tenantCountsByStatus] =
          r.n;
      }
      // mrr_cents is only non-zero for active rows (per the SQL
      // CASE), so summing across status rows just picks up active.
      mrrCents += Number(r.mrr_cents);
    }

    // MRR by plan — same conversion, grouped by plan instead of
    // status. Inactive subscriptions excluded by the CASE above.
    const planRows = (await db.execute(sql`
      SELECT
        p.code,
        p.name,
        COUNT(*) FILTER (WHERE s.status = 'active')::int AS active_n,
        ${MRR_SQL} AS mrr_cents
      FROM plans p
      LEFT JOIN tenant_subscriptions s ON s.plan_id = p.id
      GROUP BY p.id, p.code, p.name, p.sort_order
      ORDER BY p.sort_order
    `)) as unknown as Array<{
      code: string;
      name: string;
      active_n: number;
      mrr_cents: number | string;
    }>;

    const mrrByPlan = planRows
      .map((r) => ({
        planCode: r.code,
        planName: r.name,
        activeSubscribers: r.active_n,
        mrrCents: Number(r.mrr_cents),
      }))
      // Sort by MRR contribution desc; plans with no active subs
      // sink to the bottom. UI renders all rows so operators see
      // empty tiers for capacity planning.
      .sort((a, b) => b.mrrCents - a.mrrCents);

    // Signups — last 30 days count + 12-month trend. tenants.created_at
    // is the source of truth for "when did this business sign up."
    const signupCountRow = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM tenants
      WHERE deleted_at IS NULL
        AND created_at >= (CURRENT_DATE - interval '30 days')
    `)) as unknown as Array<{ n: number }>;

    const signupTrendRows = (await db.execute(sql`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', CURRENT_DATE - interval '11 months'),
          date_trunc('month', CURRENT_DATE),
          interval '1 month'
        )::date AS month_start
      )
      SELECT
        m.month_start,
        COUNT(t.id)::int AS n
      FROM months m
      LEFT JOIN tenants t
        ON t.deleted_at IS NULL
        AND date_trunc('month', t.created_at)::date = m.month_start
      GROUP BY m.month_start
      ORDER BY m.month_start
    `)) as unknown as Array<{
      month_start: Date | string;
      n: number;
    }>;

    // Trial conversion — approximated via subscription state in the
    // last 30 days. A proper implementation needs an event log of
    // status transitions; for v1 the heuristic is "subscriptions
    // currently active that were created within the trial window
    // 30+ days ago." Good enough for directional signal.
    const conversionRows = (await db.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE s.status = 'active'
          AND s.updated_at >= (now() - interval '30 days')
          AND s.created_at < (now() - interval '7 days')
        )::int AS converted,
        COUNT(*) FILTER (
          WHERE s.status = 'cancelled'
          AND s.cancelled_at >= (now() - interval '30 days')
          AND s.trial_ends_at IS NOT NULL
        )::int AS expired
      FROM tenant_subscriptions s
    `)) as unknown as Array<{ converted: number; expired: number }>;

    const converted = conversionRows[0]?.converted ?? 0;
    const expired = conversionRows[0]?.expired ?? 0;
    const conversionRate =
      converted + expired > 0 ? converted / (converted + expired) : null;

    // Churn this month
    const churnRow = (await db.execute(sql`
      SELECT
        COUNT(*)::int AS n,
        COALESCE(SUM(
          CASE
            WHEN s.billing_cycle = 'yearly' THEN p.yearly_price_cents / 12
            ELSE p.monthly_price_cents
          END
        ), 0)::bigint AS mrr_lost_cents
      FROM tenant_subscriptions s
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE s.status = 'cancelled'
        AND s.cancelled_at >= date_trunc('month', CURRENT_DATE)
    `)) as unknown as Array<{
      n: number;
      mrr_lost_cents: number | string;
    }>;

    const churnedCount = churnRow[0]?.n ?? 0;
    const churnedMrr = Number(churnRow[0]?.mrr_lost_cents ?? 0);
    const denom = churnedCount + tenantCountsByStatus.active;
    const churnRate = denom > 0 ? churnedCount / denom : null;

    // Addons MRR — same conversion logic as plans, on tenant_addons.
    const addonRow = (await db.execute(sql`
      SELECT
        COUNT(*)::int AS n,
        COALESCE(SUM(
          CASE
            WHEN ta.billing_cycle = 'yearly' THEN a.yearly_price_cents / 12
            ELSE a.monthly_price_cents
          END
        ), 0)::bigint AS mrr_cents
      FROM tenant_addons ta
      LEFT JOIN addons a ON a.id = ta.addon_id
      WHERE ta.status IN ('active', 'pending_removal')
    `)) as unknown as Array<{ n: number; mrr_cents: number | string }>;

    const addonsMrr = Number(addonRow[0]?.mrr_cents ?? 0);
    const addonsActive = addonRow[0]?.n ?? 0;

    // Coupon impact
    const couponRow = (await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE r.status = 'active')::int AS active_n,
        COUNT(*) FILTER (
          WHERE r.redeemed_at >= date_trunc('month', CURRENT_DATE)
        )::int AS this_month_n
      FROM coupon_redemptions r
    `)) as unknown as Array<{ active_n: number; this_month_n: number }>;

    const totalMrrCents = mrrCents + addonsMrr;

    const payload: RevenuePayload = {
      mrrCents: totalMrrCents,
      arrCents: totalMrrCents * 12,
      tenantCountsByStatus,
      mrrByPlan,
      signups: {
        last30Days: signupCountRow[0]?.n ?? 0,
        last12Months: signupTrendRows.map((r) => ({
          monthStart:
            r.month_start instanceof Date
              ? r.month_start.toISOString().slice(0, 10)
              : String(r.month_start).slice(0, 10),
          count: r.n,
        })),
      },
      trialConversion: {
        last30DaysConverted: converted,
        last30DaysExpired: expired,
        rate: conversionRate,
      },
      churn: {
        thisMonthCount: churnedCount,
        thisMonthMrrCents: churnedMrr,
        rate: churnRate,
      },
      addons: { mrrCents: addonsMrr, activeCount: addonsActive },
      coupons: {
        activeRedemptions: couponRow[0]?.active_n ?? 0,
        redeemedThisMonth: couponRow[0]?.this_month_n ?? 0,
      },
    };

    return reply.send(payload);
  });
};
