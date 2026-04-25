-- 92-addons.sql — add-ons engine (pricing-spec §7).
--
-- Closes the "add-ons available" tier of the hybrid feature-gating
-- model. Tenants on a lower tier can buy individual gated features
-- (e.g. Payroll on Starter) without paying for a full tier upgrade.
-- Spec §7.2: 2-3 add-ons should price-anchor a tier upgrade, not
-- replace one.
--
-- Two tables, mirroring the plans / tenant_subscriptions split:
--   * addons — catalog wrapper. Same shape as plans (code, name,
--     prices in cents, public/archived flags, sort_order). The
--     `grants_features` jsonb is the union of plan-feature codes
--     this add-on adds to a tenant's effective feature set.
--   * tenant_addons — per-tenant active subscriptions. Lifecycle:
--     active → pending_removal (tenant cancelled, kept until period
--     end) → cancelled. Auto-removed on tier upgrade when the new
--     plan already grants the add-on's features (no double-charge).
--
-- v1 deliberately ships with only feature-gating addons. Cap-delta
-- addons (extra users +5, multi-branch) need delta math in the gate
-- and are deferred. The schema doesn't carry cap-delta columns at
-- all — we'd add them in a follow-up migration if/when scoped.
--
-- Idempotent — ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING /
-- WHERE NOT EXISTS guards make the script safe to re-run.

CREATE TABLE IF NOT EXISTS addons (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    -- Stable machine code. Referenced by self-serve purchase routes
    -- and platform admin tooling; never renamed (same convention as
    -- plans.code — rename = new addon, migrate, archive old).
    code varchar(48) NOT NULL UNIQUE,
    name varchar(80) NOT NULL,
    tagline varchar(200) NOT NULL DEFAULT '',
    -- Add-ons are always priced; an add-on with both prices = 0 is
    -- effectively a freebie operator-grant tool. CHECK ≥ 0 is the
    -- only constraint.
    monthly_price_cents bigint NOT NULL,
    yearly_price_cents bigint NOT NULL,
    currency varchar(3) NOT NULL DEFAULT 'LKR',
    -- The plan-feature codes this add-on grants. Union'd into the
    -- tenant's effective feature set in the gate. Free-form like
    -- plans.features; the gate's plansGranting() helper treats
    -- addons identically.
    grants_features jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Eligibility — which plan codes this add-on is sellable under.
    -- Empty array = sellable to anyone. The eligibility check is
    -- purely UI/sales — it doesn't affect the gate, since once an
    -- addon is granted it always works.
    eligible_plan_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_public boolean NOT NULL DEFAULT true,
    is_archived boolean NOT NULL DEFAULT false,
    sort_order smallint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT addons_prices_nonneg CHECK (
        monthly_price_cents >= 0 AND yearly_price_cents >= 0
    )
);

CREATE INDEX IF NOT EXISTS addons_code_idx ON addons (code);
CREATE INDEX IF NOT EXISTS addons_active_sort_idx
    ON addons (sort_order, code)
    WHERE is_archived = false;

CREATE TABLE IF NOT EXISTS tenant_addons (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    tenant_id uuid NOT NULL
        REFERENCES tenants(id) ON DELETE CASCADE,
    addon_id uuid NOT NULL
        REFERENCES addons(id) ON DELETE RESTRICT,

    -- Three-state lifecycle:
    --   active            — tenant is paying, gate grants the features
    --   pending_removal   — tenant scheduled cancellation; still grants
    --                        features through current_period_end, then
    --                        flips to 'cancelled' by a cron sweep
    --   cancelled         — terminal; gate does NOT grant features
    -- (Auto-removal on tier upgrade goes straight active → cancelled
    -- with auto_removed_at set.)
    status varchar(20) NOT NULL,
    billing_cycle varchar(8) NOT NULL DEFAULT 'monthly',

    -- Period window — aligned to the parent subscription's cycle so
    -- pro-rated charging at purchase time and the "removal at next
    -- renewal" semantics line up. v1 doesn't actually charge anything
    -- (parent subscription billing is still SUBSCRIPTION_PAYMENT_STUB),
    -- so these dates just track the lifecycle.
    current_period_start timestamptz NOT NULL DEFAULT now(),
    current_period_end timestamptz NOT NULL DEFAULT (now() + interval '30 days'),

    activated_at timestamptz NOT NULL DEFAULT now(),
    activated_by_platform_user_id uuid,
    activated_by_user_id uuid,
    cancelled_at timestamptz,
    cancel_reason varchar(500),
    -- When set: this addon was auto-removed because the tenant's plan
    -- now includes the granted features (spec §7.1). The audit row
    -- captures which plan change triggered it.
    auto_removed_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT tenant_addons_status_allowed CHECK (
        status IN ('active', 'pending_removal', 'cancelled')
    ),
    CONSTRAINT tenant_addons_cycle_allowed CHECK (
        billing_cycle IN ('monthly', 'yearly')
    )
);

-- Partial unique: at most one non-cancelled row per (tenant, addon).
-- Cancelled rows are kept for history; a tenant can re-purchase an
-- addon later, which inserts a new active row.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_addons_active_unique
    ON tenant_addons (tenant_id, addon_id)
    WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS tenant_addons_tenant_status_idx
    ON tenant_addons (tenant_id, status);

-- updated_at trigger (reuse the function declared in 88-pricing-plans.sql).
DROP TRIGGER IF EXISTS trg_addons_updated_at ON addons;
CREATE TRIGGER trg_addons_updated_at
    BEFORE UPDATE ON addons
    FOR EACH ROW
    EXECUTE FUNCTION set_subscriptions_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_addons_updated_at ON tenant_addons;
CREATE TRIGGER trg_tenant_addons_updated_at
    BEFORE UPDATE ON tenant_addons
    FOR EACH ROW
    EXECUTE FUNCTION set_subscriptions_updated_at();

-- Seed the two add-ons that map cleanly to existing requireFeature()
-- gates (payroll + approval_workflows). Operators can add more via the
-- platform admin editor without re-running this script.
INSERT INTO addons (
    code, name, tagline,
    monthly_price_cents, yearly_price_cents,
    grants_features, eligible_plan_codes, sort_order
) VALUES
    (
        'payroll_addon',
        'Payroll add-on',
        'Run monthly payroll with EPF/ETF/PAYE on the Starter plan',
        200000, 2000000,
        '["payroll"]'::jsonb,
        '["starter"]'::jsonb,
        10
    ),
    (
        'approval_workflows_addon',
        'Approval workflows add-on',
        'Route journals, expense claims, POs through approval chains on lower tiers',
        150000, 1500000,
        '["approval_workflows"]'::jsonb,
        '["starter", "growth"]'::jsonb,
        20
    )
ON CONFLICT (code) DO NOTHING;

GRANT SELECT ON addons TO pettahpro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_addons TO pettahpro_app;
