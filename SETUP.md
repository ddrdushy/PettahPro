# PettahPro — Dev setup

Everything runs in Docker. You need **Docker Desktop** and **Node 20+ with pnpm 9+** (only to run `pnpm install` locally for IDE intellisense — the actual services run in containers).

## First-time setup

```bash
# 1. Clone
git clone https://github.com/ddrdushy/PettahPro.git
cd PettahPro

# 2. Copy env
cp .env.example .env

# 3. Install deps locally (for IDE; containers install their own)
pnpm install

# 4. Start the stack
docker compose up --build
```

Services come up at:

| Service | URL |
|---|---|
| Web (Next.js) | http://localhost:3000 |
| API (Fastify) | http://localhost:4000 |
| API health | http://localhost:4000/health |
| DB readiness | http://localhost:4000/health/ready |
| Postgres (direct) | `localhost:5432` |
| PgBouncer (app connects here) | `localhost:6432` |
| Redis | `localhost:6379` |
| MinIO console | http://localhost:9001 |
| Mailhog UI | http://localhost:8025 |

## Running migrations

Migrations bypass PgBouncer (they need session-level features):

```bash
pnpm db:generate   # after schema changes — creates a new migration file
pnpm db:migrate    # apply pending migrations
pnpm db:studio     # open Drizzle Studio in a browser
```

After migrations, apply the RLS policies (hand-written, not auto-generated):

```bash
docker compose exec postgres psql -U pettahpro -d pettahpro \
  -f /docker-entrypoint-initdb.d/../migrations/0001_enable_rls.sql
```

(Or run the SQL directly against `localhost:5432`.)

## Daily commands

```bash
pnpm dev           # docker compose up
pnpm dev:build     # rebuild images and start
pnpm dev:down      # stop containers (volumes persist)
pnpm dev:clean     # stop + delete volumes (nukes the DB)
pnpm dev:logs      # tail all container logs
pnpm typecheck     # TS typecheck across all packages
pnpm test          # run tests across all packages
```

## Repo layout

```
PettahPro/
├── apps/
│   ├── api/              # Fastify API + BullMQ worker (same image)
│   └── web/              # Next.js 14
├── packages/
│   └── db/               # Drizzle schema, migrations, client
├── docker/
│   └── postgres/init/    # SQL that runs once on first container boot
├── docs/                 # Product specs (23 docs)
├── docker-compose.yml
├── .env.example
├── package.json          # Root workspace
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Architecture at a glance

- **Modular monolith** — one API process, one web process, internal bounded contexts (`accounting`, `sell`, `buy`, `inventory`, `payroll`, `identity`, `billing`).
- **Multi-tenancy** — shared schema + `tenant_id` column + Postgres RLS. Every request sets `app.tenant_id` via `set_config()` inside a transaction; RLS policies enforce isolation. `withTenant()` in `@pettahpro/db` is the canonical way to run tenant-scoped queries.
- **PgBouncer in transaction mode** — required because RLS needs a session-scoped setting, and transaction-mode pooling scopes it per transaction. The API always connects through PgBouncer; migrations and Drizzle Studio use `DATABASE_URL_DIRECT`.
- **BullMQ worker** — separate entrypoint, same image as the API. For OCR, emails, SLIPS exports, materialized view refreshes.

## Testing RLS manually

Once migrations run and you've seeded a tenant, verify isolation:

```sql
-- As tenant A
SELECT set_config('app.tenant_id', '<tenant-a-uuid>', true);
SELECT * FROM users;  -- only tenant A's users

-- Switch to tenant B
SELECT set_config('app.tenant_id', '<tenant-b-uuid>', true);
SELECT * FROM users;  -- only tenant B's users

-- No tenant context
SELECT set_config('app.tenant_id', '', true);
SELECT * FROM users;  -- returns nothing (policy rejects)
```

## What's shipped today

The scaffold is well past the bootstrap stage. As of PR #114 (April 2026):

- **Auth + identity** — signup / login / logout / `/me` with Redis-backed session cookies, TOTP MFA + backup codes, active sessions + revoke, multi-role tenant users, multi-role platform staff (`super_admin` / `support` / `billing`), platform-user MFA, consent-gated time-boxed operator impersonation with dual-actor audit. The `x-tenant-id` placeholder is long gone — `withTenant()` reads `app.tenant_id` from the authenticated session inside every transaction.
- **Accounting core** — full COA, journal entries with approval workflow + recurring templates, period lock + year-end close, multi-currency + FX revaluation, fixed assets with monthly depreciation cron, bank reconciliation, bad debt + VAT relief, audit log viewer.
- **Sell / Buy / Inventory** — quotations · sales orders · invoices (+ proforma + recurring) · POS · credit notes · customer portal · commission engine · purchase requisitions · POs · GRNs · bills · 3-way matching · debit notes · recurring bills · stock movements · transfers · valuation · landed cost · kit/bundle items.
- **HR / Payroll** — employees, payroll runs (post / pay / void), EPF / ETF / PAYE, leave, loans, bonuses, expense claims, final settlement.
- **Platform layer** — super-admin console (tenant directory, suspend/reactivate, audited reveal, system health), pricing-plan engine with plan gating + per-tenant quota overrides + custom contracts + trial/grace banners + plan-aware sidebar + upgrade CTAs.

The current edges are listed in [`docs/_status.md`](docs/_status.md) (known bugs, typecheck debt, fragile areas) and [`docs/_gaps.md`](docs/_gaps.md) (real gaps not yet on the roadmap — bank feeds, payment-gateway integration, e-filing, PWA / offline, etc.).

See [`docs/_roadmap.md`](docs/_roadmap.md) for the full shipped/backlog tracker and [docs/00-project-overview.md](docs/00-project-overview.md) for spec context.
