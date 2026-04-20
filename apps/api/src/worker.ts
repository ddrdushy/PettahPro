import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";

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

const worker = new Worker(
  "default",
  async (job) => {
    log.info({ id: job.id, name: job.name, data: job.data }, "processing job");
    // Route to the right handler based on job.name once modules land.
    return { ok: true };
  },
  { connection },
);

worker.on("completed", (job) => log.info({ id: job.id }, "job completed"));
worker.on("failed", (job, err) => log.error({ id: job?.id, err }, "job failed"));

log.info("PettahPro worker started");
