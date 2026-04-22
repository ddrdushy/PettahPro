import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";
import { db } from "@pettahpro/db";
import { runDueRecurringInvoices } from "./modules/sell/recurring-invoices.js";
import { runDueRecurringBills } from "./modules/buy/recurring-bills.js";
import { runDueRecurringJournals } from "./modules/accounting/recurring-journals.js";
import { runScheduledStatementEmails } from "./modules/operations/customer-statement-email-cron.js";
import { runStaleChequeFlagging } from "./modules/cheques/stale-flag.js";

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
}

const defaultWorker = new Worker(
  "default",
  async (job) => {
    log.info({ id: job.id, name: job.name, data: job.data }, "processing job");
    return { ok: true };
  },
  { connection },
);

const scheduledWorker = new Worker(
  "scheduled",
  async (job) => {
    log.info({ id: job.id, name: job.name }, "scheduled job fired");
    if (job.name === "generate-recurring-invoices") {
      const result = await runDueRecurringInvoices(db, log);
      log.info(result, "recurring-invoice run complete");
      return result;
    }
    if (job.name === "generate-recurring-bills") {
      const result = await runDueRecurringBills(db, log);
      log.info(result, "recurring-bill run complete");
      return result;
    }
    if (job.name === "generate-recurring-journals") {
      const result = await runDueRecurringJournals(db, log);
      log.info(result, "recurring-journal run complete");
      return result;
    }
    if (job.name === "send-scheduled-statement-emails") {
      const result = await runScheduledStatementEmails(db, log);
      log.info(result, "scheduled statement emails run complete");
      return result;
    }
    if (job.name === "flag-stale-cheques") {
      const result = await runStaleChequeFlagging(db, log);
      log.info(result, "stale-cheque flagging run complete");
      return result;
    }
    log.warn({ name: job.name }, "unknown scheduled job");
    return { ok: false, reason: "unknown-job" };
  },
  { connection },
);

for (const w of [defaultWorker, scheduledWorker]) {
  w.on("completed", (job) => log.info({ id: job.id, name: job.name }, "job completed"));
  w.on("failed", (job, err) => log.error({ id: job?.id, name: job?.name, err }, "job failed"));
}

await registerSchedules();

log.info("PettahPro worker started");
