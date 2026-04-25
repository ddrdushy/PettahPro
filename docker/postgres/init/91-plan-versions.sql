-- 91-plan-versions.sql — plan versioning + grandfathering.
--
-- Closes pricing-spec §7.2 + §12.1: when a plan's price (or features /
-- caps) change, existing subscribers stay on the version they bought
-- until manually migrated; new signups get the latest version. Without
-- this, the plan-editor PR (#118) is a footgun — a typo in a price
-- field hits every tenant immediately.
--
-- Model:
--   * plans (existing) — the catalog wrapper with the *logical* identity
--     fields (code, sort_order, is_public, is_archived) and a
--     `current_version_id` pointer to the latest plan_versions row.
--     The value-bearing columns (prices, caps, features) stay on plans
--     as a denormalized "current published" snapshot — kept in sync on
--     every version creation, so anything reading plans.* directly
--     still gets correct *current* values without a join.
--   * plan_versions (new) — immutable history. Each row is a snapshot
--     of value-bearing fields at a point in time, identified by
--     (plan_id, version_number). Editing a plan inserts a new row,
--     advances plans.current_version_id, and leaves prior versions
--     intact for any subscription bound to them.
--   * tenant_subscriptions.plan_version_id — bound at signup or
--     change-plan to the plan's current version. Edits to the plan
--     do NOT touch existing subscriptions; they stay on their bound
--     version until an explicit migrate-to-current action.
--
-- Migration sequence (idempotent — safe to re-run on the live DB):
--   1. CREATE TABLE plan_versions
--   2. ADD COLUMN plans.current_version_id (nullable initially)
--   3. ADD COLUMN tenant_subscriptions.plan_version_id (nullable)
--   4. Backfill: for each plan, INSERT v1 snapshot (skip if already
--      present so re-runs are no-ops).
--   5. Backfill: set plans.current_version_id to v1 (skip if already
--      set).
--   6. Backfill: set tenant_subscriptions.plan_version_id to the
--      plan's current_version_id (skip if already set).
--
-- We deliberately keep the columns nullable for now — making them
-- NOT NULL after backfill would require a separate migration after
-- we're confident every subscription has been backfilled. The app
-- enforces non-nullness on writes.

CREATE TABLE IF NOT EXISTS plan_versions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    version_number integer NOT NULL,

    -- Snapshot of value-bearing fields. Mirrors plans.* exactly; on
    -- every PATCH we copy the latest values into a new row here and
    -- also update plans.* so reads against plans see the new values.
    name varchar(80) NOT NULL,
    tagline varchar(200) NOT NULL DEFAULT '',
    monthly_price_cents bigint NOT NULL,
    yearly_price_cents bigint NOT NULL,
    currency varchar(3) NOT NULL DEFAULT 'LKR',
    max_users integer,
    max_invoices_monthly integer,
    max_branches integer,
    max_warehouses integer,
    features jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Lifecycle / audit
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_platform_user_id uuid REFERENCES platform_users(id),
    notes text,

    CONSTRAINT plan_versions_unique UNIQUE (plan_id, version_number),
    CONSTRAINT plan_versions_prices_nonneg CHECK (
        monthly_price_cents >= 0 AND yearly_price_cents >= 0
    ),
    CONSTRAINT plan_versions_version_positive CHECK (version_number >= 1)
);

CREATE INDEX IF NOT EXISTS plan_versions_plan_idx
    ON plan_versions (plan_id);
CREATE INDEX IF NOT EXISTS plan_versions_plan_version_desc_idx
    ON plan_versions (plan_id, version_number DESC);

-- Catalog → current-version pointer. Nullable until backfill completes.
ALTER TABLE plans
    ADD COLUMN IF NOT EXISTS current_version_id uuid
        REFERENCES plan_versions(id) ON DELETE RESTRICT;

-- Subscriptions bind to a specific version. Nullable for back-compat;
-- the app sets it on every signup / change-plan after this migration.
ALTER TABLE tenant_subscriptions
    ADD COLUMN IF NOT EXISTS plan_version_id uuid
        REFERENCES plan_versions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS tenant_subscriptions_plan_version_idx
    ON tenant_subscriptions (plan_version_id);

-- Backfill step 1: every existing plan gets a v1 snapshot. Guarded by
-- NOT EXISTS so re-running this script doesn't double-insert.
INSERT INTO plan_versions (
    plan_id, version_number,
    name, tagline,
    monthly_price_cents, yearly_price_cents, currency,
    max_users, max_invoices_monthly, max_branches, max_warehouses,
    features, notes
)
SELECT
    p.id, 1,
    p.name, p.tagline,
    p.monthly_price_cents, p.yearly_price_cents, p.currency,
    p.max_users, p.max_invoices_monthly, p.max_branches, p.max_warehouses,
    p.features,
    'Initial version (auto-created during plan-versions migration)'
FROM plans p
WHERE NOT EXISTS (
    SELECT 1 FROM plan_versions pv WHERE pv.plan_id = p.id
);

-- Backfill step 2: point each plan at its newest version.
UPDATE plans
SET current_version_id = (
    SELECT id FROM plan_versions pv
    WHERE pv.plan_id = plans.id
    ORDER BY pv.version_number DESC
    LIMIT 1
)
WHERE current_version_id IS NULL;

-- Backfill step 3: every existing subscription binds to its plan's
-- current version. After this, edits to the plan won't move existing
-- subscribers — that's the grandfathering behavior we want.
UPDATE tenant_subscriptions ts
SET plan_version_id = (
    SELECT current_version_id FROM plans WHERE plans.id = ts.plan_id
)
WHERE plan_version_id IS NULL;
