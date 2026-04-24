import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { SystemHealthPayload } from "@/lib/platform-api";

export const metadata: Metadata = {
  title: "Health · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

// #60 — System health read-out. Server-rendered on every request; the
// underlying endpoint is cheap (in-process data + two small SQL/Redis
// probes) so cache:"no-store" is fine. No client-side refresh loop —
// one-shot reload gives the operator an obvious "that was the state at
// T" anchor instead of a ticker whose last-refresh time is easy to miss.

async function fetchMe(): Promise<{
  email: string;
  fullName: string;
  role: string;
} | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/platform/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      user: { email: string; fullName: string; role: string };
    };
    return body.user;
  } catch {
    return null;
  }
}

async function fetchHealth(): Promise<SystemHealthPayload | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/platform/system-health`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as SystemHealthPayload;
  } catch {
    return null;
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return `${h}h ${mm}m`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return `${d}d ${hh}h`;
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

// Inline SVG sparkline. Keeps the page free of a charting dep, and
// since each timeline has at most 60 points, hand-drawing polyline
// coordinates is a few lines of arithmetic.
function Sparkline({
  values,
  color,
  height = 40,
  width = 320,
}: {
  values: number[];
  color: string;
  height?: number;
  width?: number;
}) {
  if (values.length === 0) {
    return (
      <div className="flex h-10 items-center justify-center text-caption text-white/30">
        no data yet
      </div>
    );
  }
  const max = Math.max(...values, 1); // floor of 1 so an all-zero line still renders
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - (v / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  // Area fill under the line — cheap extra affordance for seeing
  // magnitude at a glance.
  const areaPoints = `0,${height} ${points} ${(values.length - 1) * step},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className="block"
    >
      <polygon points={areaPoints} fill={color} fillOpacity={0.15} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-mint"
      : tone === "warn"
        ? "text-amber-200"
        : tone === "bad"
          ? "text-red-300"
          : "text-white";
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="text-caption uppercase tracking-wide text-white/50">
        {label}
      </div>
      <div className={`mt-1 text-h2 ${toneCls}`}>{value}</div>
      {hint && <div className="mt-1 text-caption text-white/40">{hint}</div>}
    </div>
  );
}

export default async function PlatformHealthPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const data = await fetchHealth();

  if (!data) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-h1 text-white">Health</h1>
        <p className="mt-2 text-body text-red-300">
          Failed to load health payload. The API may be down or the session
          expired.
        </p>
      </div>
    );
  }

  const errorTone5m =
    data.http.errorRate5m >= 0.05
      ? "bad"
      : data.http.errorRate5m >= 0.01
        ? "warn"
        : "good";
  const dbLoadPct =
    data.db.maxConnections && data.db.maxConnections > 0
      ? data.db.totalConnections / data.db.maxConnections
      : 0;
  const dbTone = dbLoadPct >= 0.8 ? "bad" : dbLoadPct >= 0.5 ? "warn" : "good";

  // Fill the timeline up to 60 minutes with zeros for gaps so the
  // sparkline has a consistent x-axis density. Without this, a short
  // idle window renders as a compressed chart that misleads the eye.
  const nowMinute = Math.floor(Date.now() / 60_000) * 60_000;
  const timelineBucketsByTs = new Map(
    data.http.timeline.map((b) => [b.tsMs, b]),
  );
  const paddedTimeline: Array<{
    tsMs: number;
    requests: number;
    errors: number;
  }> = [];
  for (let i = 59; i >= 0; i--) {
    const ts = nowMinute - i * 60_000;
    const existing = timelineBucketsByTs.get(ts);
    paddedTimeline.push({
      tsMs: ts,
      requests: existing?.requests ?? 0,
      errors: existing?.errors ?? 0,
    });
  }
  const rateSeries = paddedTimeline.map((b) => b.requests);
  const errorSeries = paddedTimeline.map((b) => b.errors);

  return (
    <div className="px-6 py-10">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 text-caption text-white/50">
            <Link href="/platform" className="hover:text-white">
              Overview
            </Link>
            <span aria-hidden>›</span>
            <span className="text-white/70">Health</span>
          </div>
          <h1 className="mt-2 text-h1 text-white">System health</h1>
          <p className="mt-1 text-small text-white/60">
            API process + infrastructure read-out. Snapshot at{" "}
            {new Date().toLocaleTimeString("en-GB")}.
          </p>
        </div>
        <div className="text-right">
          <Link
            href="/platform/health"
            className="inline-block rounded-md border border-white/10 bg-white/10 px-4 py-2 text-small text-white hover:bg-white/20"
          >
            Refresh
          </Link>
        </div>
      </div>

      {/* Top gauges */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="API uptime"
          value={formatUptime(data.server.uptimeSeconds)}
          hint={`pid ${data.server.pid} · node ${data.server.nodeVersion}`}
        />
        <Stat
          label="Requests / min (5m)"
          value={data.http.ratePerMin5m.toFixed(1)}
          hint={`${data.http.ratePerMin1h.toFixed(1)} over last hour`}
        />
        <Stat
          label="Error rate (5m)"
          value={formatPct(data.http.errorRate5m)}
          hint={`${formatPct(data.http.errorRate1h)} over last hour`}
          tone={errorTone5m}
        />
        <Stat
          label="Postgres connections"
          value={`${data.db.totalConnections}${data.db.maxConnections ? ` / ${data.db.maxConnections}` : ""}`}
          hint={`${data.db.activeConnections} active · ${data.db.idleConnections} idle`}
          tone={dbTone}
        />
        <Stat
          label="Redis"
          value={data.redis.connected ? "connected" : "down"}
          hint={
            data.redis.connected
              ? `${formatBytes(data.redis.memoryUsedBytes)} used · up ${formatUptime(data.redis.uptimeSeconds ?? 0)}`
              : "no connection"
          }
          tone={data.redis.connected ? "good" : "bad"}
        />
      </div>

      {/* Sparklines */}
      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <div className="text-caption uppercase tracking-wide text-white/50">
              Requests per minute (last hour)
            </div>
            <div className="text-small text-white/70">
              total {data.http.totalRequests.toLocaleString()}
            </div>
          </div>
          <div className="mt-3">
            <Sparkline values={rateSeries} color="#5eead4" />
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <div className="text-caption uppercase tracking-wide text-white/50">
              5xx errors per minute (last hour)
            </div>
            <div className="text-small text-white/70">
              total {data.http.errorRequests.toLocaleString()}
            </div>
          </div>
          <div className="mt-3">
            <Sparkline values={errorSeries} color="#fca5a5" />
          </div>
        </div>
      </div>

      {/* Queue depths */}
      <div className="mt-6">
        <div className="text-caption uppercase tracking-wide text-white/50">
          Job queue depth (waiting + active)
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.keys(data.redis.queueDepths).length === 0 ? (
            <div className="col-span-full rounded-md border border-white/10 bg-white/5 p-3 text-caption text-white/40">
              No queue data.
            </div>
          ) : (
            Object.entries(data.redis.queueDepths).map(([q, n]) => (
              <div
                key={q}
                className="rounded-md border border-white/10 bg-white/5 p-3"
              >
                <div className="text-caption text-white/50">{q}</div>
                <div
                  className={`mt-1 text-h3 ${
                    n > 100 ? "text-amber-200" : "text-white"
                  }`}
                >
                  {n.toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Route leaderboards */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-h3 text-white">Slowest routes</h2>
          <p className="mt-1 text-caption text-white/50">
            Average latency since the API started, filtered to routes with ≥ 5
            hits.
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-small">
              <thead className="bg-white/5 text-caption uppercase tracking-wide text-white/50">
                <tr>
                  <th className="px-3 py-2 text-left">Route</th>
                  <th className="px-3 py-2 text-right">Avg</th>
                  <th className="px-3 py-2 text-right">Hits</th>
                </tr>
              </thead>
              <tbody>
                {data.http.topSlowRoutes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-3 py-4 text-center text-caption text-white/40"
                    >
                      Not enough traffic yet.
                    </td>
                  </tr>
                ) : (
                  data.http.topSlowRoutes.map((r) => (
                    <tr
                      key={`${r.method} ${r.route}`}
                      className="border-t border-white/10"
                    >
                      <td className="px-3 py-2">
                        <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-caption text-white/60">
                          {r.method}
                        </span>
                        <span className="font-mono text-white/90">
                          {r.route}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-white/80">
                        {r.avgLatencyMs.toFixed(0)}ms
                      </td>
                      <td className="px-3 py-2 text-right text-white/60">
                        {r.count.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-h3 text-white">Top error routes</h2>
          <p className="mt-1 text-caption text-white/50">
            5xx counts since the API started. Empty is good.
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-small">
              <thead className="bg-white/5 text-caption uppercase tracking-wide text-white/50">
                <tr>
                  <th className="px-3 py-2 text-left">Route</th>
                  <th className="px-3 py-2 text-right">5xx</th>
                  <th className="px-3 py-2 text-right">Hits</th>
                </tr>
              </thead>
              <tbody>
                {data.http.topErrorRoutes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-3 py-4 text-center text-caption text-mint"
                    >
                      No 5xx errors recorded. ✨
                    </td>
                  </tr>
                ) : (
                  data.http.topErrorRoutes.map((r) => (
                    <tr
                      key={`${r.method} ${r.route}`}
                      className="border-t border-white/10"
                    >
                      <td className="px-3 py-2">
                        <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-caption text-white/60">
                          {r.method}
                        </span>
                        <span className="font-mono text-white/90">
                          {r.route}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-red-300">
                        {r.errors.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-white/60">
                        {r.count.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Process memory footer */}
      <div className="mt-8 rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="text-caption uppercase tracking-wide text-white/50">
          API process memory
        </div>
        <div className="mt-2 flex flex-wrap gap-6 text-small text-white/80">
          <div>
            <span className="text-white/50">RSS </span>
            {data.server.memory.rssMb.toFixed(1)} MB
          </div>
          <div>
            <span className="text-white/50">Heap used </span>
            {data.server.memory.heapUsedMb.toFixed(1)} MB
          </div>
          <div>
            <span className="text-white/50">Heap total </span>
            {data.server.memory.heapTotalMb.toFixed(1)} MB
          </div>
          <div>
            <span className="text-white/50">Started </span>
            {new Date(data.server.startedAt).toLocaleString("en-GB")}
          </div>
        </div>
      </div>
    </div>
  );
}
