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

## Next steps

1. Wire auth (JWT + session) — replace the placeholder `x-tenant-id` header with real token validation.
2. Build the `identity` module — login, RBAC, roles from [data-model-02-identity.md](docs/data-model-02-identity.md).
3. Build the `accounting` core — COA, journal entries, period close.
4. Then `sell` + `buy` + `inventory` together (they're coupled; see [00-project-overview.md § phases](docs/00-project-overview.md)).

See [docs/00-project-overview.md](docs/00-project-overview.md) for the full picture.
