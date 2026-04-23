# Observability

Operator-facing guide to the PettahPro telemetry stack. Shipped in PR #46 (roadmap #46 — `_gaps.md` K1 + K2).

Everything here is **self-hosted OSS** (aligns with the stack preference). The whole stack is one docker-compose file you bring up alongside the main compose file.

## What's in the box

| Service | Port (loopback) | Role |
|---|---|---|
| Prometheus | 9090 | Metrics aggregation. Scrapes `/metrics` on the API + worker. 30-day TSDB retention. |
| Grafana | 3001 | Dashboards. Datasources (Prometheus + Loki) auto-provisioned on boot. |
| Loki | 3100 | Log aggregation. Grafana-compatible. 7-day default retention. |
| Promtail | — | Tails docker container stdout/stderr into Loki. Labels by container + compose service. |
| GlitchTip | 8000 | Sentry-protocol-compatible error tracker. Drop-in replacement for Sentry. |
| GlitchTip Postgres | — | Isolated from tenant database. |

All ports bind to `127.0.0.1` — the observability stack is operator tooling, not tenant-facing.

## Bring it up

```bash
# From repo root:
docker compose \
  -f docker-compose.yml \
  -f docker-compose.observability.yml \
  up -d
```

Wait ~20 seconds for GlitchTip's Django migrations to finish on first boot.

Visit:
- Prometheus → http://localhost:9090
- Grafana → http://localhost:3001 (default login `admin` / `admin` — change via `GRAFANA_ADMIN_PASSWORD` env)
- GlitchTip → http://localhost:8000 (create your first user via the signup form; disable open signup in prod via GlitchTip admin)

## Wiring the app to GlitchTip

1. In GlitchTip, create a team + project (name it "PettahPro").
2. Copy the DSN from the project settings.
3. Set the DSN in the app's environment. Example `.env.local`:

```bash
# API + worker
SENTRY_DSN=http://<public_key>@localhost:8000/1
SENTRY_RELEASE=pettahpro-api@$(git rev-parse --short HEAD)

# Web (client)
NEXT_PUBLIC_SENTRY_DSN=http://<public_key>@localhost:8000/1
NEXT_PUBLIC_SENTRY_RELEASE=pettahpro-web@$(git rev-parse --short HEAD)

# Web (server)
SENTRY_DSN=http://<public_key>@localhost:8000/1
```

When the DSN is empty **every SDK call is a no-op** — safe default for dev boxes.

4. Restart the `api`, `worker`, and `web` containers. Boot logs should read `Error tracking plugin active.` on the API.

To test end-to-end, hit any route that throws (or add a temporary `throw new Error("test")` to a handler) and refresh the GlitchTip project page.

## What the API exposes

- `GET /metrics` — Prometheus text format. Process metrics (heap, GC pause, event-loop lag, CPU seconds) plus:
  - `http_requests_total{method, route, status_code}` — counter
  - `http_request_duration_seconds{method, route, status_code}` — histogram
  - `http_requests_in_flight{method}` — gauge
- Route labels use Fastify's matched template (`/invoices/:id` not `/invoices/5f9…`), so cardinality stays bounded.
- No auth on `/metrics`. Prometheus scrapes it from inside the docker network; don't expose the API port publicly without a reverse-proxy allowlist.

## What the worker exposes

- `GET /metrics` on port `WORKER_METRICS_PORT` (default `4100`). Same process metrics plus:
  - `worker_scheduled_jobs_total{name, outcome}` — counter
  - `worker_scheduled_job_duration_seconds{name, outcome}` — histogram
- Set `WORKER_METRICS_PORT=0` to disable the listener.

## The default dashboard

`PettahPro → API overview` loads automatically in Grafana. Panels:
- Request rate (rps), error rate (5xx rps), in-flight, p95 latency — headline strip
- Request rate by route, latency percentiles (p50/p95/p99)
- Errors by route (4xx + 5xx)
- Node heap used (api + worker)
- Worker scheduled jobs (rate by name + outcome)
- Event-loop lag (p95)

Dashboard JSON at `docker/observability/grafana/dashboards/api-overview.json`. Grafana's file provisioner polls every 30s, so you can edit the JSON and see it live without redeploy.

## Logs in Grafana

Promtail tails every docker container's stdout/stderr and pushes to Loki with labels `container`, `compose_service`, `compose_project`. Pino logs JSON in production, so the structured fields (level, req, tenantId, userId) are queryable with LogQL:

```logql
{compose_service="api"} | json | tenantId="..." | level="error"
```

## Alerting

Not wired in v1. Prometheus has an alertmanager integration point (`ruler.alertmanager_url` in `loki-config.yml` hints at it) but we ship without alert rules. If you need paging:

1. Drop a rules file at `docker/observability/prometheus/rules.yml`.
2. Mount it into the prometheus container.
3. Add `rule_files: ["/etc/prometheus/rules.yml"]` to `prometheus.yml`.
4. Point at your alertmanager (Grafana's built-in one works for small setups).

## Dev vs prod

- **Dev**: `SENTRY_DSN` empty, docker-compose.observability.yml stays down. Zero overhead.
- **Prod**: both compose files up, DSNs set, all ports bound to `127.0.0.1` with reverse-proxy auth in front of Grafana if you need remote access.

## Retention tuning

| Data | Default | Where to change |
|---|---|---|
| Prometheus metrics | 30 days | `--storage.tsdb.retention.time` in `docker-compose.observability.yml` |
| Loki logs | 7 days | `retention_period` in `docker/observability/loki/loki-config.yml` |
| GlitchTip errors | ~30 days (GlitchTip default) | GlitchTip project settings |

## Troubleshooting

**Prometheus target shows "down"** → API container isn't reachable on `pettahpro-api:4000`. Check `docker compose ps` and ensure both compose files ran in the same `docker compose up` invocation (otherwise they're on different networks).

**Grafana datasource says "Data source proxy error"** → Grafana can't reach `prometheus:9090` (or `loki:3100`). Restart with both compose files: `docker compose -f docker-compose.yml -f docker-compose.observability.yml restart grafana`.

**GlitchTip won't accept the DSN** → GlitchTip v4 requires the DSN scheme to match the deployment. For local dev use `http://<key>@localhost:8000/<project_id>`. In prod put TLS in front and use `https://`.

**Promtail complains about `/var/run/docker.sock`** → Linux-specific. On macOS Docker Desktop mounts it automatically but the user might not have read access; `docker-compose.observability.yml` mounts it read-only. If it still errors, check Docker Desktop → Settings → Advanced → "Allow the default Docker socket to be used."

## What's deliberately deferred

- **Alertmanager rules** — no paging config shipped.
- **Synthetic probes / blackbox-exporter** — uptime checks aren't wired.
- **Per-tenant dashboards** — current dashboard is global. If we need tenant-scoped cuts, add a Grafana variable `tenant` and parameterise the queries.
- **Trace sampling** — `tracesSampleRate` is 0 by default. Raise per-env only when you need to debug a specific latency issue.
- **Native Sentry** — we use GlitchTip (single container) instead of full Sentry (20+ containers). If a tenant needs Sentry specifically, swap `SENTRY_DSN` — no code change.
