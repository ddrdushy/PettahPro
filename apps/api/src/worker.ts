import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";
import { db } from "@pettahpro/db";
import { runDueRecurringInvoices } from "./modules/sell/recurring-invoices.js";
import { runDueRecurringBills } from "./modules/buy/recurring-bills.js";
import { runDueRecurringJournals } from "./modules/accounting/recurring-journals.js";
import { runScheduledStatementEmails } from "./modules/operations/customer-statement-email-cron.js";
import { runStaleChequeFlagging } from "./modules/cheques/stale-flag.js";
import { runMonthlyDepreciationForAllTenants } from "./modules/accounting/fixed-assets.js";
import { runNotificationDigests } from "./modules/notifications/digest-cron.js";
import { runTrialExpiryJob } from "./modules/subscription/trial-expiry.js";
import { runRenewalCron } from "./modules/subscription/renewal-cron.js";
import { runTenantHealthCron } from "./modules/platform-admin/health-cron.js";
import {
  initErrorTrackingForWorker,
  captureException,
} from "./plugins/error-tracking.js";
import {
  recordScheduledJob,
  startWorkerMetricsServer,
} from "./worker-metrics.js";

// Initialise Sentry before anything else so boot errors get captured too.
// No-op when SENTRY_DSN isn't set.
initErrorTrackingForWorker();

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// Placeholder queues — real queues get registered from their respective modules.
export const defaultQueue = new Queue("default", { connection });

// Scheduled jobs queue. Repeatable BullMQ jobs live here; the worker
// dispatches by job.name.
export const scheduledQueue = new Queue("scheduled", { connection });

async function registerSchedules() {
  // Hourly recurring-invoice generation. BullMQ dedupes repeatable jobs by
  // (name, cron/every, jobId?) so re-adding on every worker boot is safe.
  await scheduledQueue.add(
    "generate-recurring-invoices",
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // 1h
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  log.info("scheduled: generate-recurring-invoices (hourly)");

  await scheduledQueue.add(
    "generate-recurring-bills",
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // 1h
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  log.info("scheduled: generate-recurring-bills (hourly)");

  await scheduledQueue.add(
    "generate-recurring-journals",
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // 1h
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  log.info("scheduled: generate-recurring-journals (hourly)");

  // Daily statement-email dispatcher. The SQL helper already filters by
  // day-of-month + dedupes, so running this every 6h (not 24h) gives us
  // resilience against a worker that was down during the canonical "1st of
  // the month" window — it just retries throughout the day.
  await scheduledQueue.add(
    "send-scheduled-statement-emails",
    {},
    {
      repeat: { every: 6 * 60 * 60 * 1000 }, // 6h
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  log.info("scheduled: send-scheduled-statement-emails (every 6h)");

  // Daily stale-cheque flagger. SL cheques go stale at 6 months — well
  // beyond typical clearing timelines — so we don't need sub-daily cadence.
  // Running every 24h fits the business cycle and keeps notification
  // noise down (we only emit on the day a cheque first goes stale).
  await scheduledQueue.add(
    "flag-stale-cheques",
    {},
    {
      repeat: { every: 24 * 60 * 60 * 1000 }, // 24h
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  log.info("scheduled: flag-stale-cheques (daily)");

  // Monthly depreciation run. Fires every 24h but only does work on the
  // 1st of the month — see runMonthlyDepreciationForAllTenants. Running
  // daily gives the scheduler a chance to catch up if the worker was down
  // at the canonical first-of-month moment (idempotent on re-entry via
  // the fixed_asset_depreciation_entries (year,month) dedup).
  await scheduledQueue.add(
    "run-monthly-depreciation",
    {},
    {
      repeat: { every: 24 * 60 * 60 * 1000 }, // 24h
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  log.info("scheduled: run-monthly-depreciation (daily; fires on 1st)");

  // Trial expiry + grace-period runner (#63). Fires daily — flips
  // `trial` rows whose trial_ends_at has passed to `past_due` with a
  // 7-day grace window, then cancels `past_due` rows whose grace
  // window has elapsed. Idempotent, so running daily (rather than
  // hourly) keeps platform_audit_log noise-free while being plenty
  // responsive for a billing cycle measured in days.
  await scheduledQueue.add(
    "expire-trials",
    {},
    {
      repeat: { every: 24 * 60 * 60 * 1000 }, // 24h
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  log.info("scheduled: expire-trials (daily)");

  // Subscription renewal sweep (#124). Fires daily after expire-trials
  // and handles the rest of the lifecycle bookkeeping: addon
  // pending_removal → cancelled at period end, coupon redemption
  // ticking, subscription period rollover. See renewal-cron.ts for
  // full sequence + idempotency notes.
  await scheduledQueue.add(
    "subscription-renewal-sweep",
    {},
    {
      repeat: { every: 24 * 60 * 60 * 1000 }, // 24h
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  log.info("scheduled: subscription-renewal-sweep (daily)");

  // Tenant-health-score sweep (#134). Computes per-tenant churn-risk
  // signal daily and persists to tenant_health_scores. Platform UI
  // reads the latest row per tenant for the at-risk dashboard.
  await scheduledQueue.add(
    "tenant-health-score-sweep",
    {},
    {
      repeat: { every: 24 * 60 * 60 * 1000 }, // 24h
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  log.info("scheduled: tenant-health-score-sweep (daily)");

  // Notification digest dispatcher (roadmap #45). Fires hourly because the
  // tenant-local hour gate is checked inside the runner — one cron cadence
  // across every tenant regardless of timezone. The runner dedupes via
  // notification_digest_emails so two ticks in the same tenant-local hour
  // won't double-send.
  await scheduledQueue.add(
    "send-notification-digests",
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // 1h
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  log.info("scheduled: send-notification-digests (hourly)");
}

const defaultWorker = new Worker(
  "default",
  async (job) => {
    log.info({ id: job.id, name: job.name, data: job.data }, "processing job");
    return { ok: true };
  },
  { connection },
);

async function runScheduledJob(name: string): Promise<unknown> {
  if (name === "generate-recurring-invoices") {
    return runDueRecurringInvoices(db, log);
  }
  if (name === "generate-recurring-bills") {
    return runDueRecurringBills(db, log);
  }
  if (name === "generate-recurring-journals") {
    return runDueRecurringJournals(db, log);
  }
  if (name === "send-scheduled-statement-emails") {
    return runScheduledStatementEmails(db, log);
  }
  if (name === "flag-stale-cheques") {
    return runStaleChequeFlagging(db, log);
  }
  if (name === "run-monthly-depreciation") {
    return runMonthlyDepreciationForAllTenants(db, log);
  }
  if (name === "send-notification-digests") {
    return runNotificationDigests(db, log);
  }
  if (name === "expire-trials") {
    return runTrialExpiryJob(db, log);
  }
  if (name === "subscription-renewal-sweep") {
    return runRenewalCron(db, log);
  }
  if (name === "tenant-health-score-sweep") {
    return runTenantHealthCron(db, log);
  }
  return null; // unknown
}

const scheduledWorker = new Worker(
  "scheduled",
  async (job) => {
    log.info({ id: job.id, name: job.name }, "scheduled job fired");
    const start = process.hrtime();
    try {
      const result = await runScheduledJob(job.name);
      const [sec, nsec] = process.hrtime(start);
      const duration = sec + nsec / 1e9;
      if (result === null) {
        log.warn({ name: job.name }, "unknown scheduled job");
        recordScheduledJob(job.name, "skipped", duration);
        return { ok: false, reason: "unknown-job" };
      }
      log.info({ name: job.name, result }, "scheduled job complete");
      recordScheduledJob(job.name, "ok", duration);
      return result;
    } catch (err) {
      const [sec, nsec] = process.hrtime(start);
      recordScheduledJob(job.name, "error", sec + nsec / 1e9);
      captureException(err, { jobName: job.name });
      throw err;
    }
  },
  { connection },
);

for (const w of [defaultWorker, scheduledWorker]) {
  w.on("completed", (job) => log.info({ id: job.id, name: job.name }, "job completed"));
  w.on("failed", (job, err) => log.error({ id: job?.id, name: job?.name, err }, "job failed"));
}

await registerSchedules();
startWorkerMetricsServer(log);

log.info("PettahPro worker started");
