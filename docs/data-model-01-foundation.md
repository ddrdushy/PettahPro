# Data Model — Part 1: Foundation

> Foundational architectural decisions for the multi-tenant accounting SaaS data model. These decisions underpin every table in parts 2-8. Database: **PostgreSQL 15+** with Row-Level Security. Target market: Sri Lanka only. Scope: full system, not MVP.

---

## 1. Scope & Principles

- **Database**: PostgreSQL 15+ (chosen for mature RLS, JSONB flexibility, strong transaction support, partition support at scale, and Qdrant-friendly integration later for vector search)
- **Tenant isolation**: defense-in-depth with 6 layers
- **Data integrity**: immutability for financial records; reversal-based corrections
- **Scale target**: hundreds of thousands of tenants over 3-5 years
- **Trust-or-die principle**: tenant data isolation is the foundational trust promise to the SL SME market

---

## 2. Multi-Tenancy Architecture

### 2.1 Tenant Isolation Strategy — Shared Schema + RLS

**Chosen pattern**: Single PostgreSQL schema, single set of tables, `tenant_id UUID NOT NULL` on every tenant-owned table, enforced via Row-Level Security.

```sql
-- Every tenant-owned table pattern:
CREATE TABLE example_table (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    -- ...other columns
);

-- Enable RLS
ALTER TABLE example_table ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy
CREATE POLICY tenant_isolation ON example_table
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Why not schema-per-tenant or database-per-tenant**:
- Schema-per-tenant: caps at ~2000 tenants before migration pain becomes unmanageable
- Database-per-tenant: operationally infeasible at SL SME volume target (thousands to tens of thousands of tenants)
- Shared schema + RLS: what Linear, Notion, Supabase, PlanetScale all use at scale

### 2.2 Platform Tables (No Tenant ID)

Tables accessed only by Super Admin roles carry NO `tenant_id`:
- `platform_users`, `platform_audit_log`
- `tenants`, `tenant_subscriptions`, `tenant_usage_metrics`
- `plans`, `plan_versions`, `coupons`
- `landing_page_content`, `email_templates`, `help_center_articles`
- `platform_tax_rates`, `industry_templates`

RLS policies on these tables restrict by Super Admin role membership, not tenant.

### 2.3 Connection-Level Tenant Context

Every request establishes the tenant context at connection level:

```sql
-- In application middleware (per request)
SET LOCAL app.current_tenant_id = '<uuid-from-jwt>';
SET LOCAL app.current_user_id = '<uuid-from-jwt>';
```

`SET LOCAL` is transaction-scoped — safe with connection pooling. Connection pool (PgBouncer in transaction mode) resets between checkouts.

**JWT claims**:
- `sub` — user_id
- `tenant_id` — UUID
- `roles` — array of role IDs (for application-level permission checks)
- `session_id` — for session invalidation

### 2.4 Cross-Tenant Query Prevention

Any query that accidentally omits tenant filter returns zero rows due to RLS. Additionally:
- Application-layer query builders always inject `tenant_id = ?`
- ORM configured with tenant scoping at model level
- Database views that span tenants are explicitly Super-Admin-only with different policy

---

## 3. Defense-in-Depth Isolation (6 Layers)

All 6 layers implemented. Tenant isolation failure is an existential risk for platform trust.

### Layer 1 — Application Level
Every query explicitly includes `WHERE tenant_id = :tenant_id`. Redundant with RLS but catches RLS bugs. Application code never assumes DB will filter.

### Layer 2 — ORM Level
ORM (Prisma / Drizzle / similar) configured with tenant scoping middleware. Queries without tenant filter throw errors at ORM level before reaching DB.

```typescript
// Example ORM middleware pattern
db.middleware(async (params, next) => {
  if (isTenantOwnedModel(params.model) && !params.args.where?.tenant_id) {
    throw new Error('Tenant-scoped query missing tenant_id filter');
  }
  return next(params);
});
```

### Layer 3 — Database Level (RLS)
PostgreSQL RLS policies on every tenant-owned table:

```sql
CREATE POLICY tenant_isolation ON {table}
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Separate policy for platform super-admin bypass (controlled)
CREATE POLICY super_admin_access ON {table}
    USING (current_setting('app.is_super_admin', true) = 'true');
```

### Layer 4 — Connection Level
Every connection has `app.current_tenant_id` set at session start. If missing, RLS evaluates `current_setting()` as NULL, which equals nothing — returns zero rows.

### Layer 5 — Audit
Every query logged (via `pg_stat_statements` + application log) with `tenant_id`. Cross-tenant access attempts (user JWT says tenant A, query accesses tenant B data) flagged as security incidents and alerted.

### Layer 6 — Automated Security Testing
CI test suite spins up 2+ tenants, runs every API endpoint as tenant A, verifies zero tenant B data in responses. Runs on every PR.

---

## 4. Primary Key Strategy — UUID v7

All primary keys are **UUID v7** (time-ordered UUIDs).

### 4.1 Why UUID v7

| Property | UUID v4 | UUID v7 |
|---|---|---|
| Non-enumerable | ✅ | ✅ |
| Safe for URLs | ✅ | ✅ |
| Sortable by creation time | ❌ | ✅ |
| Index fragmentation | High | Low |
| Merge across shards | Clean | Clean |

UUID v7 format:
- First 48 bits: Unix timestamp (ms)
- Remaining 80 bits: random
- Time-ordered inserts mean B-tree indexes stay well-organized

### 4.2 Generation
- Client-side generation preferred (supports offline POS scenarios, distributed inserts)
- DB-side generation via `gen_random_uuid()` for simple cases (Postgres 17+ has native v7; earlier versions use extension)
- Never expose UUIDs unnecessarily — they're long; UI shows short business codes (INV-2026-0047) that map to UUIDs internally

### 4.3 No Auto-Increment Integers
Enumerable IDs leak business information:
- *"They have 47 invoices"* from `/invoices/47`
- Guessable sequential IDs across transactions
- Unsafe for URLs and API responses

All IDs are opaque UUIDs.

---

## 5. Deletion Strategy — Hybrid (Soft + Hard)

### 5.1 Soft Delete Applied To
Financial/operational rows that matter for audit and referential integrity:

- `customers`, `suppliers`, `items`
- `invoices`, `bills`, `journal_entries`, `journal_lines`
- `goods_received_notes`, `purchase_orders`, `quotations`
- `users`, `roles`, `branches`, `warehouses`
- `employees`, `payslips`, `payroll_runs`
- `cheques`, `receipts`, `payments`
- `stock_batches`, `stock_serials`

Pattern:
```sql
-- Standard soft delete columns on above tables
deleted_at TIMESTAMP WITH TIME ZONE NULL,
deleted_by UUID REFERENCES users(id) NULL,

-- Query pattern (always filter)
SELECT * FROM customers
WHERE tenant_id = :tenant_id AND deleted_at IS NULL;
```

### 5.2 Hard Delete Applied To
Ephemeral / non-audit-relevant:

- Draft records (drafts older than 30 days auto-purge)
- Temporary uploads / staging data
- Session data (on logout or expiry)
- OTP codes (after use or expiry)
- Notification records older than retention (90 days default)
- Audit log entries older than tenant retention period (2-10 years depending on tier)
- Rate limit counters
- Activity feed entries older than 6 months

### 5.3 Tenant Account Termination
When tenant explicitly terminates account + grace period expires:
- Background job hard-deletes ALL tenant rows (including soft-deleted)
- Super Admin audit log retains tenant metadata (ID, terminated date, reason) indefinitely for compliance
- S3 objects deleted with lifecycle rules
- Final deletion confirmation logged

### 5.4 Stock Ledger and Journal Lines — Immutable
These tables never allow DELETE or UPDATE, even soft:
- `stock_ledger` — movements are history; corrections post new rows
- `journal_lines` — once journal posted, immutable; void creates reversal entry

---

## 6. Standard Audit Columns

### 6.1 Every Tenant-Owned Table

```sql
-- Standard audit columns on every tenant-owned table
tenant_id            UUID NOT NULL,
created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
created_by           UUID REFERENCES users(id),
updated_by           UUID REFERENCES users(id),
deleted_at           TIMESTAMP WITH TIME ZONE NULL,
deleted_by           UUID REFERENCES users(id) NULL,
version              INTEGER NOT NULL DEFAULT 1  -- optimistic concurrency control
```

### 6.2 Audit-Sensitive Tables (Financial Documents)

Additional columns for tables carrying financial weight — `invoices`, `bills`, `journal_entries`, `goods_received_notes`, `payments`, `receipts`, `payslips`, `cheques`:

```sql
-- Lock and posting columns
locked              BOOLEAN NOT NULL DEFAULT FALSE,
locked_at           TIMESTAMP WITH TIME ZONE NULL,
posted_at           TIMESTAMP WITH TIME ZONE NULL,  -- draft → posted transition
posted_by           UUID REFERENCES users(id) NULL
```

### 6.3 Optimistic Locking

`version` column incremented on every UPDATE. Application checks version on write:

```sql
UPDATE invoices
SET status = 'posted', version = version + 1
WHERE id = :id AND version = :expected_version;
```

If 0 rows updated → concurrent modification detected → user prompted to reload.

### 6.4 Trigger-Maintained Columns

`updated_at` auto-updated via trigger:

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Applied to every tenant-owned table
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON {table}
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## 7. Naming Conventions

- **Tables**: `snake_case`, plural (`customers`, `journal_entries`, `stock_ledger`)
- **Columns**: `snake_case`, singular (`customer_name`, `posted_at`)
- **Foreign keys**: `{entity}_id` (`customer_id`, `branch_id`)
- **Booleans**: `is_` / `has_` prefix (`is_active`, `has_tax_exemption`)
- **Timestamps**: `_at` suffix (`created_at`, `voided_at`)
- **Dates**: `_date` suffix (`effective_date`, `fiscal_year_start_date`)
- **Enums**: lowercase with underscores (`'pending_approval'`, `'hard_closed'`)
- **Indexes**: `idx_{table}_{columns}` (`idx_invoices_tenant_status`)
- **Constraints**: `{type}_{table}_{columns}` (`uk_customers_tenant_code`, `fk_invoices_customer`)

---

## 8. Timezone and Datetime Handling

- **Storage**: all timestamps stored as `TIMESTAMP WITH TIME ZONE` in UTC
- **Business dates**: stored as `DATE` (no timezone) — represents a calendar day in the tenant's timezone
- **Display**: converted to tenant's configured timezone (default `Asia/Colombo`) at application layer
- **Fiscal periods**: bound to calendar dates in tenant timezone; start-of-day / end-of-day conversions handled at application layer

---

## 9. JSON vs Relational Trade-Offs

Postgres `JSONB` used for:
- Flexible metadata fields (`tags`, `attributes`, `metadata`)
- Semi-structured content (`address_json`, `conditions_json`)
- Logs and audit payloads (`old_value_json`, `new_value_json`)
- Config that varies by tenant (notification preferences, workflow templates)

Relational tables used for:
- Anything queried in joins
- Anything with referential integrity requirements
- Anything reported on in standard reports
- Anything needing indexed lookups

**Rule of thumb**: if you'd query it with a WHERE clause regularly, make it a column; if it's free-form and mostly read whole, JSONB.

---

## 10. Partitioning Strategy Preview

Tables expected to grow large over time, partitioned at creation:

| Table | Partition strategy |
|---|---|
| `stock_ledger` | `tenant_id HASH (16)` + `occurred_at RANGE monthly` |
| `journal_entries` + `journal_lines` | `tenant_id HASH (16)` + `entry_date RANGE monthly` |
| `audit_log` | `tenant_id HASH (16)` + `created_at RANGE monthly` |
| `user_login_history` | `created_at RANGE monthly` (platform-level) |
| `notification_deliveries` | `created_at RANGE monthly` |

Benefits:
- Hot data stays in small partitions (fast queries)
- Cold data movable to cheaper storage
- Dropping old partitions is fast (for retention enforcement)
- Tenant-level hash partitioning spreads write load

Detailed partitioning specs in **Part 8 — Performance & ERDs**.

---

## 11. Migration and Schema Evolution

- **Forward-compatible migrations only** — never rename / drop columns without deprecation cycle
- **Add column as nullable → backfill → mark NOT NULL → enforce in app** — never NOT NULL on migration
- **No destructive migrations on tables with RLS** — extra care required to avoid accidental tenant data exposure during migration
- **Zero-downtime deploys** — app and schema compatible across deploys
- **Migration tooling**: Flyway or native migration tool; all migrations checked into source, tracked in platform DB table
- **Tenant-specific schema changes**: NOT supported — all tenants share the same schema always; feature flags gate behavior, not schema

---

## 12. Extensions Required

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";          -- UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";            -- Encryption + gen_random_uuid
CREATE EXTENSION IF NOT EXISTS "pg_trgm";             -- Fuzzy text search (customer/supplier/item search)
CREATE EXTENSION IF NOT EXISTS "btree_gin";           -- Composite GIN indexes
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";  -- Query performance monitoring
CREATE EXTENSION IF NOT EXISTS "pgaudit";             -- Detailed audit logging
```

Optional / Phase 2:
- `pgvector` — when semantic search added (product descriptions, support tickets)
- `postgis` — if geographic data needed (currently not used)
- `timescaledb` — alternative to native partitioning for time-series tables (evaluate at scale)

---

## 13. RLS Policy Template Library

Standard policy patterns used throughout (details in Part 8):

```sql
-- Template 1: Basic tenant isolation (used on most tenant-owned tables)
CREATE POLICY tenant_isolation ON {table}
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Template 2: Read-only for inactive tenants (suspended/past-due)
CREATE POLICY tenant_isolation_readonly_if_suspended ON {table}
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Template 3: Super admin bypass (for platform ops)
CREATE POLICY super_admin_access ON {table}
    FOR ALL
    USING (current_setting('app.is_super_admin', true) = 'true');

-- Template 4: Soft-delete invisibility
CREATE POLICY exclude_soft_deleted ON {table}
    FOR SELECT
    USING (deleted_at IS NULL OR current_setting('app.include_deleted', true) = 'true');
```

---

## 14. Next Parts

- **Part 2 — Identity & Access**: platform users, tenants, users, roles, permissions, sessions, MFA
- **Part 3 — Operations**: branches, warehouses, customers, suppliers, items, stock ledger, pricing
- **Part 4 — Accounting**: COA, journals, tax codes, periods, FX
- **Part 5 — Transactions**: invoices, bills, receipts, payments, GRNs, cheques, POS
- **Part 6 — Payroll & HR**: employees, salary structures, payroll runs, leave, loans, bonuses
- **Part 7 — System**: audit log, document storage, notifications, workflows, number series, integrations
- **Part 8 — Performance & ERDs**: indexes, partitioning detail, materialized views, Mermaid ERD diagrams, RLS policy examples

---

*Document version: 1.0 · Part 1/8 · Foundation · Scope: Sri Lanka only · Full system (not MVP) · Prepared for multi-tenant accounting SaaS (BUSY replacement)*

*Decisions locked in Round 1: shared schema + RLS tenant isolation (Option C) with 6-layer defense in depth; UUID v7 primary keys universally; hybrid soft/hard delete (financial data soft, ephemeral data hard, terminate-account hard-deletes everything); standard audit columns (created_at/updated_at/created_by/updated_by/deleted_at/deleted_by/version/tenant_id) plus locked/locked_at/posted_at on audit-sensitive tables; PostgreSQL 15+ with required extensions.*
