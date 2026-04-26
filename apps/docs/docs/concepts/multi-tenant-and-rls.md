---
title: Multi-tenant and RLS
sidebar_position: 2
---

# Multi-tenant and RLS

PettahPro is a **shared-database multi-tenant** system. Every tenant's data lives in the same Postgres database, on the same tables — but a tenant can never see another tenant's rows, because **row-level security** (RLS) is enforced at the database itself, not at the application layer.

This page explains how that works, why it's set up this way, and what it means in practice when you're configuring access or auditing the system.

## The shape of the data

Every business table has a `tenant_id uuid not null` column. Examples:

```sql
-- customers, items, invoices, payments, journals — all the same shape
create table customers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  name         text not null,
  ...
);
```

Cross-tenant tables (e.g. `tenants`, `plans`, `users`) deliberately do **not** have a `tenant_id`. They live above the tenancy line.

## How isolation is enforced

Three layers, only one of which is load-bearing:

1. **Application layer** — every API handler reads `tenantId` from the authenticated session and adds `where tenant_id = $tenantId` to every query. This is convenience, not safety. A bug here cannot leak data because of layer 2.
2. **Postgres RLS** — every business table has a policy that says "rows are visible only when `tenant_id = current_tenant_id()`". The function reads from a per-connection setting that the API sets at the start of every request:
   ```sql
   set local pettahpro.tenant_id = '<the-uuid>';
   ```
   This is the load-bearing layer. Even if the application layer forgets the `where` clause, the database itself filters the results.
3. **Database role** — the API connects as `pettahpro_app`, which is **non-superuser** and **does not bypass RLS**. Migrations connect as a separate role that does, and never touch tenant data. So a SQL-injection vulnerability in a query cannot read across tenants — the role itself is bound by the policies.

## Why this design

Three properties of shared-database multi-tenancy that the alternatives don't give you cleanly:

- **One schema to migrate.** A schema change rolls out to all tenants in a single migration, atomically. The schema-per-tenant alternative makes this O(N) and breaks if a single tenant fails mid-migration.
- **Cheap per-tenant cost.** A new tenant is a row in `tenants` and a UUID stamped on their data. No new database, no new connection pool, no new EBS volume.
- **Defence in depth.** A bug in the application layer cannot leak across tenants because the database refuses to return the rows. This is the single most important property for a system that books other people's money.

The trade-off is that **noisy neighbours share resources** — a tenant running a large report can slow another tenant's invoice post. We mitigate this with read replicas and connection-pool fairness, but it's never zero. If a tenant gets large enough that this matters, the path is to move them to their own database via the platform admin tooling — same schema, separate instance.

## Connection lifecycle

Every API request follows the same shape:

```
1. Authenticate the request          → get sessionUserId, sessionTenantId
2. Acquire a pooled connection
3. set local pettahpro.tenant_id     → bind the connection to this tenant
4. Run the handler's queries         → all RLS-filtered automatically
5. Release the connection            → setting clears (set local lasts the txn)
```

Two consequences worth knowing:

- **Connection reuse is safe.** Because we use `set local` (transaction-scoped) inside an explicit transaction, the setting cannot leak across requests when the connection returns to the pool.
- **Background jobs need the same dance.** A worker processing a queued job must `set local pettahpro.tenant_id = '<job.tenant_id>'` before it touches any tenant data. Forgetting this means the queries see no rows — visible failure, not silent leakage.

## Cross-tenant operations

Some workflows need to span tenants — platform-admin ops, billing rollups, the impersonation flow. These are deliberately rare and explicit:

- **Platform admin** runs as a different role (`pettahpro_platform`) that bypasses tenant RLS but is restricted to the `platform_*` and `tenants*` tables.
- **Impersonation** issues a session for a specific tenant, with an audit log entry recording who impersonated whom and why. The impersonator's actions show as their own user inside the impersonated tenant — never disguised as another user.
- **Background sweeps** (e.g. daily revaluation, recurring runs) iterate tenants one at a time, each in its own transaction with its own `set local`.

There is no "see all tenants" view in the tenant-side UI. Ever.

## What this means for you

If you're an **operator or accountant** reviewing the system before trusting it: the safety of your books does not rest on application code. A junior dev shipping a buggy query cannot leak your data — Postgres itself refuses. That's why we picked this design.

If you're a **developer** working on PettahPro: the pattern is automatic for everything that goes through our query helpers. The places you need to be deliberate are (a) when you write raw SQL in a migration that touches tenant data — usually a sign you should rethink the migration; and (b) when you write a background worker — always `set local` first.

If you're a **platform admin**: operations that span tenants are logged in `audit_events` with the impersonating user, target tenant, and reason. Use this log when an incident requires a "who did what across whom" review.

## Related

- [Glossary — Tenant](./glossary#tenant) — definition.
- [Roles](../settings/overview) — how user permissions interact with the tenancy layer.
- [Security](../settings/overview) — auth, sessions, password policy.
