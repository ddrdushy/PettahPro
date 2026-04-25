-- 88-pricing-plans.sql — pricing plan catalogue + per-tenant
-- subscriptions (#61).
--
-- Two tables:
--   * plans                — the catalogue. Seeded with the three tiers
--                            that the marketing site already lists
--                            (starter / growth / scale). `features` is
--                            a jsonb array of string codes so adding a
--                            capability to a plan doesn't need a
--                            migration — `requirePlan()` middleware in
--                            the API reads the list at runtime.
--   * tenant_subscriptions — exactly one row per tenant (UNIQUE). Tracks
--                            the tenant's current plan, status, trial
--                            window, and billing cycle. History lives
--                            in platform_audit_events (every change is
--                            logged by the /change-plan endpoint) so we
--                            don't maintain a second log table here.
--
-- Price is stored in cents (LKR * 100). BIGINT because yearly-scale at
-- 29,900 LKR * 100 = 2,990,000 cents fits in INT today, but I don't
-- want to trip over this when someone models a USD enterprise tier.
--
-- Deliberately outside RLS: subscriptions are platform-owned, not
-- tenant-owned. Tenants read their own subscription via a separate
-- tenant-side endpoint (to come in a later PR); platform staff read
-- all of them. The tenant_id FK cascades on delete — if a tenant is
-- hard-deleted, its subscription row evaporates with it.
--
-- Idempotent. Re-running this script is safe: CREATE TABLE IF NOT
-- EXISTS, seed uses ON CONFLICT (code) DO NOTHING, backfill uses
-- WHERE NOT EXISTS. The user memory is explicit — never nuke the
-- postgres volume; this script must land cleanly on a live DB.

CREATE TABLE IF NOT EXISTS plans (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    -- Stable machine code. Used by requirePlan() and the UI's plan
    -- picker. Never renamed; if we rebrand "growth" to "pro" we add a
    -- new plan and migrate tenants, we don't mutate this column.
    code varchar(32) NOT NULL UNIQUE,
    name varchar(80) NOT NULL,
    tagline varchar(200) NOT NULL DEFAULT '',
    -- LKR cents. NULL is not allowed — an enterprise/custom plan with
    -- bespoke pricing should still carry a list price so the console
    -- can show *something*; billing overrides live on the subscription
    -- row when we build that in a later PR.
    monthly_price_cents bigint NOT NULL,
    yearly_price_cents bigint NOT NULL,
    currency varchar(3) NOT NULL DEFAULT 'LKR',
    -- Hard caps. NULL = unlimited. The API enforces these by counting
    -- rows inside the tenant's schema; see requirePlan() (PR #62).
    max_users int,
    max_invoices_monthly int,
    max_branches int,
    max_warehouses int,
    -- Free-form capability codes — e.g. 'payroll', 'ai_bill_entry',
    -- 'supplier_portal'. Consumed by requirePlan('supplier_portal').
    -- jsonb > text[] because Drizzle's typescript story is cleaner on
    -- jsonb arrays and the filter-by-feature query uses `?` operator.
    features jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Hidden plans let us model bespoke or grandfathered deals without
    -- showing them in the public tier picker. The console always
    -- shows all of them.
    is_public boolean NOT NULL DEFAULT true,
    sort_order smallint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT plans_prices_nonneg CHECK (
        monthly_price_cents >= 0 AND yearly_price_cents >= 0
    )
);

CREATE INDEX IF NOT EXISTS plans_code_idx ON plans (code);
CREATE INDEX IF NOT EXISTS plans_sort_order_idx ON plans (sort_order);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    -- One active subscription per tenant. Changing plans mutates this
    -- row; the audit trail preserves history.
    tenant_id uuid NOT NULL UNIQUE
        REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id uuid NOT NULL
        REFERENCES plans(id) ON DELETE RESTRICT,
    -- Four-state machine. 'trial' and 'active' are happy paths;
    -- 'past_due' is "trial expired / payment failed, grace period";
    -- 'cancelled' is terminal. Transitions are driven by the scheduled
    -- trial-expiry job (#63) + manual platform-admin action today.
    status varchar(16) NOT NULL,
    billing_cycle varchar(8) NOT NULL DEFAULT 'monthly',
    -- NULL once the trial has ended. Only meaningful when status='trial'.
    trial_ends_at timestamptz,
    -- Period window. Informational today; will drive invoice generation
    -- when we wire real billing (#64). For trial rows, current_period_*
    -- track the trial itself.
    current_period_start timestamptz NOT NULL DEFAULT now(),
    current_period_end timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
    cancelled_at timestamptz,
    cancel_reason varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_subscriptions_status_allowed
        CHECK (status IN ('trial', 'active', 'past_due', 'cancelled')),
    CONSTRAINT tenant_subscriptions_cycle_allowed
        CHECK (billing_cycle IN ('monthly', 'yearly'))
);

CREATE INDEX IF NOT EXISTS tenant_subscriptions_plan_idx
    ON tenant_subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS tenant_subscriptions_status_idx
    ON tenant_subscriptions (status);
-- For the trial-expiry scheduled job in #63 — "find subscriptions
-- whose trial ended and status is still 'trial'". Partial index keeps
-- it lean since only a handful of rows are in flight at any time.
CREATE INDEX IF NOT EXISTS tenant_subscriptions_trial_ends_at_idx
    ON tenant_subscriptions (trial_ends_at)
    WHERE status = 'trial';

-- updated_at trigger — same pattern as the rest of the platform_*
-- tables. Keeping the function name scoped so it doesn't clash with
-- the half-dozen other updated_at triggers in this DB.
CREATE OR REPLACE FUNCTION set_subscriptions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW
    EXECUTE FUNCTION set_subscriptions_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_subscriptions_updated_at ON tenant_subscriptions;
CREATE TRIGGER trg_tenant_subscriptions_updated_at
    BEFORE UPDATE ON tenant_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION set_subscriptions_updated_at();

-- Seed the three tiers from apps/web/lib/content.ts pricingPlans.
-- Prices are LKR cents: 4,900 LKR = 490,000 cents. Yearly is list
-- price, not monthly×12 — the marketing copy shows a ~17% discount
-- baked into the yearly figure (49,000 vs 58,800 = 10mo equivalent).
--
-- Feature codes are consumed by requirePlan() (#62). New codes get
-- added here when we wire a new gate; unknown codes on a plan are
-- silently ignored, so adding ahead of the gate is safe.
INSERT INTO plans (
    code, name, tagline,
    monthly_price_cents, yearly_price_cents,
    max_users, max_invoices_monthly, max_branches, max_warehouses,
    features, sort_order
) VALUES
    (
        'starter',
        'Starter',
        'Solo operators and very small teams',
        490000, 4900000,
        3, 500, 1, 1,
        '["sell", "buy", "inventory", "vat_wht", "cheque_lifecycle", "email_support"]'::jsonb,
        10
    ),
    (
        'growth',
        'Growth',
        'Growing SMEs — most popular',
        1290000, 12900000,
        15, NULL, 3, 5,
        '["sell", "buy", "inventory", "vat_wht", "cheque_lifecycle", "payroll", "ai_bill_entry", "priority_support"]'::jsonb,
        20
    ),
    (
        'scale',
        'Scale',
        'Established businesses with multi-branch operations',
        2990000, 29900000,
        NULL, NULL, NULL, NULL,
        '["sell", "buy", "inventory", "vat_wht", "cheque_lifecycle", "payroll", "ai_bill_entry", "priority_support", "supplier_portal", "approval_workflows", "phone_support", "dedicated_csm"]'::jsonb,
        30
    )
ON CONFLICT (code) DO NOTHING;

-- Backfill: every existing tenant without a subscription gets dropped
-- onto a 30-day Growth trial. Growth (not Starter) because any tenant
-- already on the platform predates this billing layer, so treating
-- them as a trial on the headline plan is the gentlest default — it
-- doesn't invalidate their current workflow, and the trial gives us
-- time to reach out before any plan-gated feature goes dark.
--
-- Idempotent via NOT EXISTS — re-running this file won't create
-- duplicate rows, and an operator who's already been upgraded won't
-- get reset back to trial.
INSERT INTO tenant_subscriptions (
    tenant_id, plan_id, status, billing_cycle,
    trial_ends_at, current_period_start, current_period_end
)
SELECT
    t.id,
    (SELECT id FROM plans WHERE code = 'growth'),
    'trial',
    'monthly',
    now() + interval '30 days',
    now(),
    now() + interval '30 days'
FROM tenants t
WHERE t.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM tenant_subscriptions s WHERE s.tenant_id = t.id
  );

GRANT SELECT ON plans TO pettahpro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_subscriptions TO pettahpro_app;
