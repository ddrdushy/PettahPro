import { sql } from "drizzle-orm";
import { schema, type Database } from "@pettahpro/db";

/**
 * Dunning cron — failed-payment retry workflow (pricing-plan-architecture
 * spec §10). Runs daily after the renewal-cron sweep.
 *
 * Purpose: take subscriptions whose period has rolled over (or whose
 * last charge failed and is due for a retry), attempt the charge,
 * and either record the success or schedule the next retry. After
 * the configured number of failed attempts, the subscription is
 * cancelled.
 *
 * The gateway call is currently a stub (see `attemptCharge` below).
 * `SUBSCRIPTION_PAYMENT_STUB=1` makes it a no-op success — the path
 * the existing self-serve flow already trusts. To exercise the
 * failure path without a real gateway, list tenant UUIDs in
 * `SUBSCRIPTION_STUB_FAILURE_TENANTS` (comma-separated) — those
 * tenants always fail. This is what lets us QA the retry +
 * escalation logic end-to-end before wiring PayHere / FriMi etc.
 *
 * State machine driven from this cron:
 *
 *     active (period rolls) ───► charge attempt
 *         │ success                    │ failure
 *         ▼                            ▼
 *     period rolled forward      past_due
 *     attempts counter zeroed       │
 *         next_charge_attempt_at    │ next_retry_at scheduled
 *         set to new period_end     ▼
 *                              charge attempt (retry)
 *                                  │ success     │ failure
 *                                  ▼             ▼
 *                              active       past_due (or cancelled
 *                                            if attempts == suspend_after)
 *
 * Audit logged on every transition (charge succeeded / failed /
 * subscription auto-suspended). Uses the same platform-audit-log
 * pattern as renewal-cron.
 *
 * Idempotent: re-running a tick that has nothing due is a no-op.
 * The worker queues a fresh row in `pending` only after taking the
 * subscription's `next_charge_attempt_at` into the past — so two
 * overlapping runs can't double-charge.
 *
 * Outside RLS — subscription rows are platform-owned. The cron uses
 * the system DB connection.
 */

const SYSTEM_USER_EMAIL = "system@pettahpro.lk";

interface Log {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface DunningRunResult {
  attempted: number;
  succeeded: number;
  failed: number;
  suspended: number;
  skipped: number;
  errors: number;
}

/**
 * Test-mode gateway stub. Returns success unless the tenant is in the
 * `SUBSCRIPTION_STUB_FAILURE_TENANTS` env list (comma-separated UUIDs).
 *
 * Returning `success: false` with a reason is what the rest of the
 * dunning path is designed around. When a real gateway lands, this
 * function gets replaced (or wrapped) with one that calls the
 * provider's API and translates the response.
 */
async function attemptCharge(
  tenantId: string,
  amountCents: number,
): Promise<{
  success: boolean;
  gatewayResponse: string;
  failureCode?: string;
  failureReason?: string;
}> {
  const failureList = (process.env.SUBSCRIPTION_STUB_FAILURE_TENANTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (failureList.includes(tenantId)) {
    return {
      success: false,
      gatewayResponse: "stub:forced_failure",
      failureCode: "stub_forced",
      failureReason:
        "Stub gateway forced failure for this tenant via SUBSCRIPTION_STUB_FAILURE_TENANTS env",
    };
  }

  // Default stub behaviour: success, regardless of amount. Real gateways
  // would reach out and get back a payment-intent / charge response;
  // we synthesise one to keep the audit trail meaningful.
  return {
    success: true,
    gatewayResponse: `stub:success:${amountCents}cents`,
  };
}

interface DueSubscription {
  subscription_id: string;
  tenant_id: string;
  plan_id: string;
  monthly_price_cents: string; // bigint comes back as string
  yearly_price_cents: string;
  billing_cycle: string;
  status: string;
  current_period_start: Date;
  current_period_end: Date;
  consecutive_failed_attempts: number;
}

interface EffectivePolicy {
  id: string;
  retry_intervals_days: number[];
  suspend_after_attempts: number;
  is_paused: boolean;
}

/**
 * Resolve the dunning policy for a subscription's plan. Falls back to
 * the platform default (plan_id IS NULL) if the plan doesn't have
 * its own policy. The default row is seeded at migration time, so it
 * always exists.
 */
async function resolvePolicy(
  db: Database,
  planId: string,
): Promise<EffectivePolicy> {
  const rows = (await db.execute(sql`
    SELECT id,
           retry_intervals_days,
           suspend_after_attempts,
           is_paused
      FROM dunning_policies
     WHERE plan_id = ${planId}
        OR plan_id IS NULL
     ORDER BY plan_id NULLS LAST
     LIMIT 1
  `)) as unknown as Array<{
    id: string;
    retry_intervals_days: unknown;
    suspend_after_attempts: number;
    is_paused: boolean;
  }>;

  // Default row is seeded by 100-dunning.sql, so this is unreachable in
  // a migrated DB. Defensive fallback in case the seed is missing.
  if (rows.length === 0) {
    return {
      id: "00000000-0000-0000-0000-000000000000",
      retry_intervals_days: [1, 3, 7, 14],
      suspend_after_attempts: 5,
      is_paused: false,
    };
  }

  const policy = rows[0]!;
  return {
    id: policy.id,
    retry_intervals_days: Array.isArray(policy.retry_intervals_days)
      ? (policy.retry_intervals_days as number[])
      : [1, 3, 7, 14],
    suspend_after_attempts: policy.suspend_after_attempts,
    is_paused: policy.is_paused,
  };
}

export async function runDunningCron(
  db: Database,
  log: Log,
): Promise<DunningRunResult> {
  const result: DunningRunResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    suspended: 0,
    skipped: 0,
    errors: 0,
  };

  // Find subscriptions due for a charge attempt:
  //   * status active or past_due (paused/cancelled don't get charged)
  //   * next_charge_attempt_at is in the past
  //
  // Active subs that just rolled over have next_charge_attempt_at set
  // to their new period_start by the renewal-cron extension below;
  // past_due subs have it set by the previous failed attempt.
  let dueSubs: DueSubscription[];
  try {
    dueSubs = (await db.execute(sql`
      SELECT s.id           AS subscription_id,
             s.tenant_id,
             s.plan_id,
             p.monthly_price_cents,
             p.yearly_price_cents,
             s.billing_cycle,
             s.status,
             s.current_period_start,
             s.current_period_end,
             s.consecutive_failed_attempts
        FROM tenant_subscriptions s
        JOIN plans p ON p.id = s.plan_id
       WHERE s.status IN ('active', 'past_due')
         AND s.next_charge_attempt_at IS NOT NULL
         AND s.next_charge_attempt_at <= now()
       ORDER BY s.next_charge_attempt_at ASC
       LIMIT 500
    `)) as unknown as DueSubscription[];
  } catch (err) {
    result.errors++;
    log.error({ err }, "dunning-cron: failed to fetch due subscriptions");
    return result;
  }

  if (dueSubs.length === 0) {
    return result;
  }

  log.info({ count: dueSubs.length }, "dunning-cron: due subscriptions found");

  for (const sub of dueSubs) {
    try {
      const policy = await resolvePolicy(db, sub.plan_id);

      // If dunning is paused for this policy, just slide the next
      // attempt forward by 24h and skip. Don't increment fail counter.
      if (policy.is_paused) {
        await db.execute(sql`
          UPDATE tenant_subscriptions
             SET next_charge_attempt_at = now() + interval '24 hours',
                 updated_at = now()
           WHERE id = ${sub.subscription_id}
        `);
        await db.insert(schema.subscriptionChargeAttempts).values({
          tenantId: sub.tenant_id,
          subscriptionId: sub.subscription_id,
          attemptNumber: sub.consecutive_failed_attempts + 1,
          amountCents: amountForCycle(sub),
          periodStart: sub.current_period_start,
          periodEnd: sub.current_period_end,
          status: "skipped",
          completedAt: new Date(),
          gatewayResponse: "skipped:dunning_paused",
          dunningPolicyId: policy.id,
        });
        result.skipped++;
        continue;
      }

      const amountCents = amountForCycle(sub);
      const attemptNumber = sub.consecutive_failed_attempts + 1;

      // Insert the pending row first. If the gateway call below
      // crashes, the pending row is the trace of what happened.
      const [pending] = await db
        .insert(schema.subscriptionChargeAttempts)
        .values({
          tenantId: sub.tenant_id,
          subscriptionId: sub.subscription_id,
          attemptNumber,
          amountCents,
          periodStart: sub.current_period_start,
          periodEnd: sub.current_period_end,
          status: "pending",
          dunningPolicyId: policy.id,
        })
        .returning({ id: schema.subscriptionChargeAttempts.id });

      result.attempted++;

      const charge = await attemptCharge(sub.tenant_id, amountCents);

      if (charge.success) {
        // Success path: mark attempt succeeded, clear retry state, push
        // next charge to the next period boundary.
        await db.execute(sql`
          UPDATE subscription_charge_attempts
             SET status = 'succeeded',
                 completed_at = now(),
                 gateway_response = ${charge.gatewayResponse}
           WHERE id = ${pending!.id}
        `);

        // Compute the next billing period's end. This subscription's
        // current_period_end is "now" (or just elapsed), so the next
        // period_end is current + cycle.
        const cycleDays = sub.billing_cycle === "yearly" ? 365 : 30;
        await db.execute(sql`
          UPDATE tenant_subscriptions
             SET status = 'active',
                 consecutive_failed_attempts = 0,
                 next_charge_attempt_at = current_period_end +
                   interval '${sql.raw(String(cycleDays))} days',
                 updated_at = now()
           WHERE id = ${sub.subscription_id}
        `);

        await writeAudit(db, {
          tenantId: sub.tenant_id,
          kind: "subscription.charge_succeeded",
          summary: `Charge attempt ${attemptNumber} succeeded`,
          metadata: {
            subscriptionId: sub.subscription_id,
            attemptId: pending!.id,
            amountCents,
            attemptNumber,
          },
        });
        result.succeeded++;
        continue;
      }

      // Failure path. Three sub-cases:
      //   (a) attempts < suspend_after — schedule next retry
      //   (b) attempts == suspend_after - 1 (one more would suspend) —
      //       schedule final retry
      //   (c) attempts >= suspend_after - 1 AND no more retries
      //       configured — suspend now
      //
      // The retry interval is retry_intervals_days[attemptNumber - 1]
      // (zero-indexed; attempt 1 looks at index 0 = first retry gap).
      // If attemptNumber > length, there's no more retries — suspend.
      const newFailedCount = attemptNumber;
      const retryIdx = attemptNumber - 1;
      const willSuspend =
        newFailedCount >= policy.suspend_after_attempts ||
        retryIdx >= policy.retry_intervals_days.length;

      await db.execute(sql`
        UPDATE subscription_charge_attempts
           SET status = 'failed',
               completed_at = now(),
               gateway_response = ${charge.gatewayResponse},
               failure_code = ${charge.failureCode ?? null},
               failure_reason = ${charge.failureReason ?? null}
         WHERE id = ${pending!.id}
      `);

      if (willSuspend) {
        await db.execute(sql`
          UPDATE tenant_subscriptions
             SET status = 'cancelled',
                 cancelled_at = now(),
                 cancel_reason = 'Suspended after exhausting dunning retries',
                 next_charge_attempt_at = NULL,
                 consecutive_failed_attempts = ${newFailedCount},
                 updated_at = now()
           WHERE id = ${sub.subscription_id}
        `);

        await writeAudit(db, {
          tenantId: sub.tenant_id,
          kind: "subscription.suspended_dunning",
          summary: `Subscription cancelled — exhausted dunning retries (${newFailedCount} failed attempts)`,
          metadata: {
            subscriptionId: sub.subscription_id,
            failedAttempts: newFailedCount,
            policyId: policy.id,
            lastAttemptId: pending!.id,
          },
        });
        result.suspended++;
        result.failed++;
      } else {
        const retryDays = policy.retry_intervals_days[retryIdx]!;
        await db.execute(sql`
          UPDATE tenant_subscriptions
             SET status = 'past_due',
                 consecutive_failed_attempts = ${newFailedCount},
                 next_charge_attempt_at =
                   now() + interval '${sql.raw(String(retryDays))} days',
                 updated_at = now()
           WHERE id = ${sub.subscription_id}
        `);

        await writeAudit(db, {
          tenantId: sub.tenant_id,
          kind: "subscription.charge_failed",
          summary: `Charge attempt ${attemptNumber} failed; next retry in ${retryDays} day(s)`,
          metadata: {
            subscriptionId: sub.subscription_id,
            attemptId: pending!.id,
            failedAttempts: newFailedCount,
            nextRetryDays: retryDays,
            failureCode: charge.failureCode,
            failureReason: charge.failureReason,
            policyId: policy.id,
          },
        });
        result.failed++;
      }
    } catch (err) {
      result.errors++;
      log.error(
        { err, subscriptionId: sub.subscription_id },
        "dunning-cron: failed to process subscription",
      );
    }
  }

  log.info({ ...result }, "dunning-cron run complete");
  return result;
}

function amountForCycle(sub: DueSubscription): number {
  // bigint comes back as string from drizzle; parse defensively.
  const raw =
    sub.billing_cycle === "yearly"
      ? sub.yearly_price_cents
      : sub.monthly_price_cents;
  return Number(raw);
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
    // Match renewal-cron: a failed audit write doesn't roll back the
    // state change above. Missing audit rows are findable from the
    // resulting state diff anyway.
    // eslint-disable-next-line no-console
    console.error("dunning-cron audit write failed", err);
  }
}
