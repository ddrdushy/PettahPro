import { sql } from "drizzle-orm";
import { schema, type Database } from "@pettahpro/db";

/**
 * Daily trial-expiry + grace-period runner (#63).
 *
 * Two transitions, run back-to-back in one pass:
 *
 *   1.  trial    →  past_due     when trial_ends_at < now()
 *                                 current_period_{start,end} slide to the
 *                                 grace window (now .. now + 7 days).
 *
 *   2.  past_due →  cancelled    when current_period_end < now() AND the
 *                                 subscription got to past_due via trial
 *                                 expiry (i.e. the grace window ran out
 *                                 without a manual plan change).
 *
 * Both transitions write a row to platform_audit_log so operators can see
 * what the system did and when. platformUserId is NULL for system-driven
 * events; we use a sentinel "system@pettahpro.lk" email so the existing
 * rendering (which shows the email alongside each event) degrades cleanly.
 *
 * Idempotent — each tick re-scans from scratch. If the worker is down for
 * a day, the next run catches up whatever backed up. No "last run" marker
 * needed because the conditions are cheap to recompute and the transitions
 * themselves are absorbing.
 *
 * Deliberately keeps past_due → active transitions out of scope: we don't
 * have a payment flow to hook into yet. When #64 ships the self-serve
 * upgrade, the change-plan endpoint will flip past_due → active as a side
 * effect; this job will leave those rows alone.
 *
 * The grace window length is configurable via env so ops can stretch it
 * for a weekend outage without a deploy. Defaults to 7 days — long enough
 * for a human to notice the "past due" banner and follow up, short enough
 * that a forgotten tenant doesn't squat indefinitely on a dead trial.
 */

const GRACE_DAYS = Number(process.env.SUBSCRIPTION_GRACE_DAYS ?? "7");
const SYSTEM_USER_EMAIL = "system@pettahpro.lk";

interface Log {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

interface RunResult {
  expiredTrials: number;
  cancelledPastDue: number;
  errors: number;
}

export async function runTrialExpiryJob(
  db: Database,
  log: Log,
): Promise<RunResult> {
  let expiredTrials = 0;
  let cancelledPastDue = 0;
  let errors = 0;

  // Step 1 — flip expired trials to past_due. RETURNING tenant_id so we
  // can write one audit row per transition. The grace window starts
  // *now*, not at trial_ends_at, so a worker that ran a day late still
  // gives the tenant the full GRACE_DAYS to react.
  try {
    const rows = (await db.execute(sql`
      UPDATE tenant_subscriptions
         SET status = 'past_due',
             current_period_start = now(),
             current_period_end = now() + (${GRACE_DAYS} || ' days')::interval,
             updated_at = now()
       WHERE status = 'trial'
         AND trial_ends_at IS NOT NULL
         AND trial_ends_at < now()
       RETURNING id, tenant_id, plan_id
    `)) as unknown as Array<{ id: string; tenant_id: string; plan_id: string }>;

    for (const row of rows) {
      expiredTrials++;
      await writeAudit(db, {
        tenantId: row.tenant_id,
        kind: "subscription.trial_expired",
        summary: "Trial expired; moved to past_due with grace window",
        metadata: {
          subscriptionId: row.id,
          planId: row.plan_id,
          graceDays: GRACE_DAYS,
        },
      });
    }

    if (expiredTrials > 0) {
      log.info({ count: expiredTrials }, "expired trials flipped to past_due");
    }
  } catch (err) {
    errors++;
    log.error({ err }, "trial-expiry: step 1 (trial → past_due) failed");
  }

  // Step 2 — cancel past_due subscriptions whose grace window has elapsed.
  // We only cancel rows that reached past_due via step 1; a manual
  // platform-admin flip to past_due for unrelated reasons (e.g. a billing
  // anomaly) should NOT auto-cancel. Distinguishing: current_period_end
  // was set by us in step 1, so if trial_ends_at is NOT NULL (trial
  // happened) AND cancelled_at IS NULL AND status='past_due' AND
  // current_period_end < now(), this is our row.
  try {
    const rows = (await db.execute(sql`
      UPDATE tenant_subscriptions
         SET status = 'cancelled',
             cancelled_at = now(),
             cancel_reason = 'Trial expired; payment not received within grace period',
             updated_at = now()
       WHERE status = 'past_due'
         AND trial_ends_at IS NOT NULL
         AND cancelled_at IS NULL
         AND current_period_end < now()
       RETURNING id, tenant_id, plan_id
    `)) as unknown as Array<{ id: string; tenant_id: string; plan_id: string }>;

    for (const row of rows) {
      cancelledPastDue++;
      await writeAudit(db, {
        tenantId: row.tenant_id,
        kind: "subscription.cancelled_past_due",
        summary:
          "Past-due grace window elapsed; subscription auto-cancelled",
        metadata: {
          subscriptionId: row.id,
          planId: row.plan_id,
          graceDays: GRACE_DAYS,
        },
      });
    }

    if (cancelledPastDue > 0) {
      log.info(
        { count: cancelledPastDue },
        "past-due grace elapsed; subscriptions auto-cancelled",
      );
    }
  } catch (err) {
    errors++;
    log.error(
      { err },
      "trial-expiry: step 2 (past_due → cancelled) failed",
    );
  }

  return { expiredTrials, cancelledPastDue, errors };
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
    // Mirror the hand-written recordPlatformAuditEvent helper: don't let
    // an audit write failure abort the batch. The state change itself
    // already committed above.
    // eslint-disable-next-line no-console
    console.error("trial-expiry audit write failed", err);
  }
}
