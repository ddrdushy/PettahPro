import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

/**
 * Observability plugin (roadmap #46).
 *
 * - Exposes `/metrics` in Prometheus text format for a sibling Prometheus
 *   container to scrape. Process-level metrics (heap, GC pause, event-loop
 *   lag, resident memory, CPU seconds) come from `collectDefaultMetrics`.
 *   On top of those we record three HTTP-level series:
 *
 *     http_requests_total{method, route, status_code}
 *     http_request_duration_seconds{method, route, status_code}  (histogram)
 *     http_requests_in_flight{method}                            (gauge)
 *
 *   Route labels use Fastify's matched route template (`req.routeOptions.url`)
 *   rather than the raw URL — that keeps cardinality bounded at one series
 *   per handler instead of one per distinct `:id`.
 *
 * - No auth on `/metrics`. Scraping is controlled at the network layer
 *   (the Prometheus container runs on the same docker network as the API)
 *   and we don't bind the API's port to the host in prod deploys for
 *   anything other than the reverse proxy. If you expose the API port
 *   publicly, add a reverse-proxy allowlist on `/metrics` — we don't try
 *   to handle that in code because it's a deployment concern.
 */

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests processed, labelled by method, route, and status.",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry],
});

const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds, labelled by method, route, and status.",
  labelNames: ["method", "route", "status_code"] as const,
  // Bucket boundaries tuned for an API with mostly sub-500ms requests
  // and a long tail up to ~10s (PDF renders, report exports).
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const httpRequestsInFlight = new Gauge({
  name: "http_requests_in_flight",
  help: "Number of HTTP requests currently being processed, labelled by method.",
  labelNames: ["method"] as const,
  registers: [registry],
});

declare module "fastify" {
  interface FastifyRequest {
    // Hi-res start timestamp for latency calc. Set by `onRequest` hook below.
    // Named with a leading underscore to signal "plugin-internal, don't read
    // from route handlers."
    _telemetryStart?: [number, number];
  }
}

export const telemetryPlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    fastify.addHook("onRequest", async (req) => {
      req._telemetryStart = process.hrtime();
      httpRequestsInFlight.inc({ method: req.method });
    });

    fastify.addHook("onResponse", async (req, reply) => {
      const start = req._telemetryStart;
      httpRequestsInFlight.dec({ method: req.method });
      if (!start) return;
      const [sec, nsec] = process.hrtime(start);
      const durationSeconds = sec + nsec / 1e9;

      // Prefer the matched route template over raw URL — keeps cardinality
      // bounded at one series per handler. Falls back to "unmatched" for
      // 404s so we still see a blip when routes go missing.
      const route =
        (req.routeOptions?.url as string | undefined) ??
        (req as unknown as { routerPath?: string }).routerPath ??
        "unmatched";
      const labels = {
        method: req.method,
        route,
        status_code: String(reply.statusCode),
      };
      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, durationSeconds);
    });

    // The scrape endpoint. No auth — see file-level note above.
    fastify.get("/metrics", async (_req, reply) => {
      reply.header("content-type", registry.contentType);
      return registry.metrics();
    });
  },
  { name: "telemetry" },
);

/** Exposed so worker.ts can register the same default-metrics collector
 *  against its own HTTP-less process — we expose a `/metrics` endpoint on
 *  a separate port from the worker. Re-exporting the registry keeps the
 *  metric names consistent across processes. */
export const telemetryRegistry = registry;
