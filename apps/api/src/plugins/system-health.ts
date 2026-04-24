import IORedis from "ioredis";
import { db } from "@pettahpro/db";
import { sql } from "drizzle-orm";
import { telemetryRegistry } from "./telemetry.js";

/**
 * System health collector (roadmap #60).
 *
 * Sits next to the Prom telemetry plugin and reuses its in-process
 * Registry — no extra scrape needed. We add one thing Prom can't give
 * us cheaply from a single process: a minute-by-minute ring buffer of
 * request + error counts for the dashboard sparkline.
 *
 * Why a ring buffer instead of querying Prometheus: the platform
 * health page is server-rendered by the same API process. Round-
 * tripping to an external Prom just to draw a 60-point sparkline is
 * operationally heavier than keeping 60 ints in RAM. Prom still wins
 * for ad-hoc alerting and cross-service roll-ups — this is a
 * lightweight read-out for the console only.
 *
 * Caveats:
 *   - Per-API-process. If we ever run >1 replica, each shows its own
 *     slice. Good enough until we need HA; then plumb it through
 *     Redis or just query Prom.
 *   - 60 slots × 60s = exactly one hour. Tail beyond the hour is lost.
 */

const BUCKET_SIZE_MS = 60 * 1000;
const BUCKET_COUNT = 60;

interface HttpBucket {
  /** Epoch ms of the bucket's start. */
  tsMs: number;
  requests: number;
  errors: number;
}

// Ring buffer. Index = floor(now / BUCKET_SIZE_MS) % BUCKET_COUNT.
// We also carry tsMs on the slot so a stale slot (from ≥1h ago) gets
// zeroed on first write in its new era, avoiding a fake "spike" when
// the ring wraps round after quiet periods.
const httpBuckets: HttpBucket[] = Array.from(
  { length: BUCKET_COUNT },
  () => ({ tsMs: 0, requests: 0, errors: 0 }),
);

const serverStartedAtMs = Date.now();

export function recordHttpSample(statusCode: number): void {
  const now = Date.now();
  const minuteStart = Math.floor(now / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
  const idx = Math.floor(now / BUCKET_SIZE_MS) % BUCKET_COUNT;
  const slot = httpBuckets[idx];
  if (!slot) return; // impossible, but keeps TS happy
  if (slot.tsMs !== minuteStart) {
    // stale — wrapping round from the previous hour
    slot.tsMs = minuteStart;
    slot.requests = 0;
    slot.errors = 0;
  }
  slot.requests += 1;
  // "Error" for the purpose of an ops dashboard = 5xx. 4xx is client
  // noise (bad input, missing tokens) and would drown the signal.
  if (statusCode >= 500) slot.errors += 1;
}

function snapshotBuckets(): HttpBucket[] {
  // Order: oldest → newest. Sort by tsMs, drop slots that were never
  // written (tsMs=0) so the caller doesn't render pre-history bars.
  return httpBuckets
    .filter((b) => b.tsMs > 0)
    .slice()
    .sort((a, b) => a.tsMs - b.tsMs);
}

interface RouteStat {
  route: string;
  method: string;
  count: number;
  errors: number;
  avgLatencyMs: number;
}

/**
 * Pull per-route stats out of the Prom registry. We aggregate
 * `http_requests_total` (by route/method/status) + the histogram
 * sum/count series that prom-client emits for `http_request_duration_seconds`.
 * Avg latency is good enough for a dashboard leaderboard — real
 * p95/p99 needs bucket maths that isn't worth the code here.
 */
async function collectRouteStats(): Promise<RouteStat[]> {
  const metrics = await telemetryRegistry.getMetricsAsJSON();
  const totalByRoute = new Map<
    string,
    { route: string; method: string; count: number; errors: number }
  >();
  const sumByRoute = new Map<string, number>();
  const countByRoute = new Map<string, number>();

  for (const m of metrics) {
    if (m.name === "http_requests_total") {
      for (const v of m.values) {
        const labels = v.labels as Record<string, string>;
        const route = labels.route ?? "unmatched";
        const method = labels.method ?? "GET";
        const statusCode = Number(labels.status_code ?? 0);
        const key = `${method} ${route}`;
        const existing = totalByRoute.get(key) ?? {
          route,
          method,
          count: 0,
          errors: 0,
        };
        existing.count += v.value;
        if (statusCode >= 500) existing.errors += v.value;
        totalByRoute.set(key, existing);
      }
    }
    if (m.name === "http_request_duration_seconds") {
      for (const v of m.values) {
        const labels = v.labels as Record<string, string>;
        const route = labels.route ?? "unmatched";
        const method = labels.method ?? "GET";
        const key = `${method} ${route}`;
        // prom-client emits one value per bucket plus _sum and _count
        // series. The `metricName` field only exists on histogram/summary
        // children and isn't in the base MetricValue type — cast narrowly.
        const vWithName = v as { metricName?: string };
        if (vWithName.metricName === "http_request_duration_seconds_sum") {
          sumByRoute.set(key, (sumByRoute.get(key) ?? 0) + v.value);
        } else if (
          vWithName.metricName === "http_request_duration_seconds_count"
        ) {
          countByRoute.set(key, (countByRoute.get(key) ?? 0) + v.value);
        }
      }
    }
  }

  const out: RouteStat[] = [];
  for (const [key, total] of totalByRoute) {
    const sum = sumByRoute.get(key) ?? 0;
    const count = countByRoute.get(key) ?? 0;
    const avgLatencyMs = count > 0 ? (sum / count) * 1000 : 0;
    out.push({
      route: total.route,
      method: total.method,
      count: total.count,
      errors: total.errors,
      avgLatencyMs,
    });
  }
  return out;
}

interface DbStats {
  activeConnections: number;
  idleConnections: number;
  totalConnections: number;
  maxConnections: number | null;
}

async function collectDbStats(): Promise<DbStats> {
  // pg_stat_activity gives us live connection state. We scope by
  // application_name so other tools (psql, Drizzle Studio, PgBouncer
  // admin shell) don't pollute the gauge.
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE state = 'active')::int   AS active,
        COUNT(*) FILTER (WHERE state = 'idle')::int     AS idle,
        COUNT(*)::int                                   AS total,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
        FROM pg_stat_activity
       WHERE datname = current_database();
    `);
    const r = rows[0] as unknown as {
      active: number;
      idle: number;
      total: number;
      max_conn: number | null;
    };
    return {
      activeConnections: r.active ?? 0,
      idleConnections: r.idle ?? 0,
      totalConnections: r.total ?? 0,
      maxConnections: r.max_conn ?? null,
    };
  } catch {
    return {
      activeConnections: 0,
      idleConnections: 0,
      totalConnections: 0,
      maxConnections: null,
    };
  }
}

interface RedisStats {
  connected: boolean;
  memoryUsedBytes: number | null;
  uptimeSeconds: number | null;
  queueDepths: Record<string, number>;
}

// Small per-process Redis client for health lookups. Separate from the
// many other IORedis instances in the codebase so a status probe
// can't starve production reads of connection slots.
const healthRedis = new IORedis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  },
);

// The BullMQ queue names we want to surface. Keep in sync with
// apps/api/src/worker.ts — if you add a queue there, list it here so
// the dashboard shows it, otherwise it's invisible.
const KNOWN_QUEUES = ["default", "scheduled"] as const;

async function collectRedisStats(): Promise<RedisStats> {
  if (healthRedis.status === "wait" || healthRedis.status === "end") {
    try {
      await healthRedis.connect();
    } catch {
      return {
        connected: false,
        memoryUsedBytes: null,
        uptimeSeconds: null,
        queueDepths: {},
      };
    }
  }
  try {
    const info = await healthRedis.info("memory");
    const memMatch = /used_memory:(\d+)/.exec(info);
    const memoryUsedBytes = memMatch ? Number(memMatch[1]) : null;

    const serverInfo = await healthRedis.info("server");
    const upMatch = /uptime_in_seconds:(\d+)/.exec(serverInfo);
    const uptimeSeconds = upMatch ? Number(upMatch[1]) : null;

    // BullMQ stores jobs under `bull:<queue>:*`. Summing `waiting +
    // active + delayed + prioritized` is the classic "backlog" gauge.
    // LLEN on the waiting list is the cheapest approximation — we
    // show that plus `active` count.
    const depths: Record<string, number> = {};
    for (const q of KNOWN_QUEUES) {
      try {
        const waiting = await healthRedis.llen(`bull:${q}:wait`);
        const activeList = await healthRedis.llen(`bull:${q}:active`);
        depths[q] = (waiting ?? 0) + (activeList ?? 0);
      } catch {
        depths[q] = 0;
      }
    }
    return {
      connected: true,
      memoryUsedBytes,
      uptimeSeconds,
      queueDepths: depths,
    };
  } catch {
    return {
      connected: false,
      memoryUsedBytes: null,
      uptimeSeconds: null,
      queueDepths: {},
    };
  }
}

export interface SystemHealthPayload {
  server: {
    uptimeSeconds: number;
    startedAt: string;
    nodeVersion: string;
    pid: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  };
  http: {
    totalRequests: number;
    errorRequests: number;
    errorRate5m: number;
    errorRate1h: number;
    ratePerMin5m: number;
    ratePerMin1h: number;
    timeline: Array<{ tsMs: number; requests: number; errors: number }>;
    topSlowRoutes: RouteStat[];
    topErrorRoutes: RouteStat[];
  };
  db: DbStats;
  redis: RedisStats;
}

export async function buildSystemHealthPayload(): Promise<SystemHealthPayload> {
  const nowMs = Date.now();
  const timeline = snapshotBuckets();

  const last5 = timeline.filter((b) => nowMs - b.tsMs <= 5 * 60 * 1000);
  const last60 = timeline; // already capped to ≤60m

  const sum5m = last5.reduce(
    (a, b) => ({ r: a.r + b.requests, e: a.e + b.errors }),
    { r: 0, e: 0 },
  );
  const sum1h = last60.reduce(
    (a, b) => ({ r: a.r + b.requests, e: a.e + b.errors }),
    { r: 0, e: 0 },
  );

  // Avoid division-by-zero when the server was idle. Shows 0% rather
  // than NaN.
  const errorRate5m = sum5m.r > 0 ? sum5m.e / sum5m.r : 0;
  const errorRate1h = sum1h.r > 0 ? sum1h.e / sum1h.r : 0;
  const ratePerMin5m = last5.length > 0 ? sum5m.r / last5.length : 0;
  const ratePerMin1h = last60.length > 0 ? sum1h.r / last60.length : 0;

  const routeStats = await collectRouteStats();

  const topSlowRoutes = [...routeStats]
    .filter((r) => r.count >= 5) // ignore singletons
    .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
    .slice(0, 10);

  const topErrorRoutes = [...routeStats]
    .filter((r) => r.errors > 0)
    .sort((a, b) => b.errors - a.errors)
    .slice(0, 10);

  const totalRequests = routeStats.reduce((a, r) => a + r.count, 0);
  const errorRequests = routeStats.reduce((a, r) => a + r.errors, 0);

  const [dbStats, redisStats] = await Promise.all([
    collectDbStats(),
    collectRedisStats(),
  ]);

  const mem = process.memoryUsage();

  return {
    server: {
      uptimeSeconds: Math.floor((nowMs - serverStartedAtMs) / 1000),
      startedAt: new Date(serverStartedAtMs).toISOString(),
      nodeVersion: process.version,
      pid: process.pid,
      memory: {
        rssMb: +(mem.rss / 1024 / 1024).toFixed(1),
        heapUsedMb: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        heapTotalMb: +(mem.heapTotal / 1024 / 1024).toFixed(1),
      },
    },
    http: {
      totalRequests,
      errorRequests,
      errorRate5m,
      errorRate1h,
      ratePerMin5m,
      ratePerMin1h,
      timeline,
      topSlowRoutes,
      topErrorRoutes,
    },
    db: dbStats,
    redis: redisStats,
  };
}
