import http from "node:http";
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from "prom-client";

/**
 * Worker metrics endpoint (roadmap #46).
 *
 * The API process exposes `/metrics` via Fastify; the worker process has
 * no HTTP surface of its own, so we stand up a tiny `http.createServer`
 * on a dedicated port. Prometheus scrapes both.
 *
 * Port comes from `WORKER_METRICS_PORT` (default 4100). Set to 0 in env
 * to disable the listener entirely — useful when running the worker
 * inside something that doesn't want a spare port bound.
 */

const registry = new Registry();
collectDefaultMetrics({ register: registry, labels: { process: "worker" } });

const scheduledJobsTotal = new Counter({
  name: "worker_scheduled_jobs_total",
  help: "Total scheduled jobs dispatched by the worker, labelled by name and outcome.",
  labelNames: ["name", "outcome"] as const,
  registers: [registry],
});

const scheduledJobDurationSeconds = new Histogram({
  name: "worker_scheduled_job_duration_seconds",
  help: "Duration of scheduled jobs in seconds.",
  labelNames: ["name", "outcome"] as const,
  // Scheduled jobs (depreciation runs, recurring-invoice generation, etc.)
  // can take minutes at high tenant counts — buckets go out to 10min.
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600],
  registers: [registry],
});

export function recordScheduledJob(
  name: string,
  outcome: "ok" | "error" | "skipped",
  durationSeconds: number,
): void {
  scheduledJobsTotal.inc({ name, outcome });
  scheduledJobDurationSeconds.observe({ name, outcome }, durationSeconds);
}

export function startWorkerMetricsServer(logger: {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}): http.Server | null {
  const port = Number(process.env.WORKER_METRICS_PORT ?? 4100);
  if (!port) {
    logger.info({}, "WORKER_METRICS_PORT=0; worker /metrics disabled");
    return null;
  }
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.writeHead(200, { "content-type": registry.contentType });
      res.end(await registry.metrics());
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "pettahpro-worker" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "worker /metrics listening");
  });
  server.on("error", (err) => {
    logger.warn({ err }, "worker /metrics server error");
  });
  return server;
}
