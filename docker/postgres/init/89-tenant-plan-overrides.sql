-- 89-tenant-plan-overrides.sql — per-tenant quota overrides (#71).
--
-- Motivation. The plan catalogue (#61 / 88-pricing-plans.sql) bakes
-- caps into each plan row — "Starter: 500 invoices/month, 1 branch".
-- Ops eventually signs bespoke deals ("we'll give you Starter pricing
-- but with 5,000 invoices/month because you're a bookkeeping firm")
-- that can't be honored without either (a) editing the shared Starter
-- row (affects every Starter tenant — nope) or (b) creating a hidden
-- grandfathered plan per customer (unbounded catalogue growth — nope).
--
-- Fix: four nullable override columns on tenant_subscriptions.
-- NULL = "fall through to the plan's cap" (the common case).
-- Integer = "this tenant's effective cap for this resource."
-- The gate logic (apps/api/src/lib/plan-gate.ts) reads the override
-- first and only consults the plan row when it's NULL.
--
-- Why four columns instead of one JSONB blob? The gate path is hot —
-- every /invoices POST does a quotaMaxFor() lookup — and direct column
-- reads don't need JSON parsing. Also keeps the Drizzle typings clean:
-- nullable INT columns map to `number | null` with zero ceremony.
--
-- Deliberately no CHECK (custom_max >= 0). Setting a custom_max of 0
-- is a legitimate "freeze this resource" action (pause a tenant's
-- ability to add branches without flipping their plan). The app layer
-- rejects negative values.
--
-- Idempotent. ADD COLUMN IF NOT EXISTS lets this script land cleanly
-- on a live DB without dropping the volume (per user memory).

ALTER TABLE tenant_subscriptions
    ADD COLUMN IF NOT EXISTS custom_max_users int,
    ADD COLUMN IF NOT EXISTS custom_max_invoices_monthly int,
    ADD COLUMN IF NOT EXISTS custom_max_branches int,
    ADD COLUMN IF NOT EXISTS custom_max_warehouses int,
    -- Free-form note for the operator — "Grandfathered from Q2 contract"
    -- or "Trial extension for PoC". Surfaced in the platform-admin UI so
    -- whoever sees the override understands why it's there. Nullable —
    -- an override without context is allowed, just discouraged.
    ADD COLUMN IF NOT EXISTS custom_limits_note varchar(500);

-- No new indexes. Lookups are always keyed by tenant_id which is already
-- unique-indexed; the override columns are read as part of the same row
-- fetch, not queried on directly.
