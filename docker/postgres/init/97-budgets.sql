-- 97-budgets.sql — budgets + budget-vs-actual report (gaps B2).
--
-- Spec'd as a Scale-tier feature; gaps doc flagged it as "Any
-- finance team past the sole-proprietor tier wants this." v1 ships
-- the foundation: per-(account, optional cost_center) annual amounts,
-- with a budget-vs-actual report that prorates the annual figure
-- across the chosen window.
--
-- Two tables:
--   * budgets — header (name, fiscal_year, status, notes)
--   * budget_lines — per-(account, optional cost_center) annual cents
--
-- v1 deliberately keeps it simple:
--   * Annual amounts only — no per-month split. Tenants who need
--     seasonal budgets can create one budget per quarter or month
--     (or wait for v2).
--   * One active budget per fiscal_year per tenant. Drafts and
--     archives don't count toward the unique constraint, so
--     tenants can iterate freely.
--   * Status: draft → active → archived. Posted JEs aren't
--     touched — budgets are read-only on the actuals side.
--
-- Idempotent — IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS budgets (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    tenant_id uuid NOT NULL
        REFERENCES tenants(id) ON DELETE CASCADE,
    name varchar(160) NOT NULL,
    -- Fiscal year start year (calendar Y for SL since fiscal year ==
    -- calendar year for most tenants; for those with non-calendar
    -- years the fiscal_periods table is the source of truth and the
    -- budget just labels the year for display).
    fiscal_year smallint NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'draft',
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    created_by_user_id uuid,
    CONSTRAINT budgets_status_allowed CHECK (
        status IN ('draft', 'active', 'archived')
    )
);

-- One ACTIVE budget per (tenant, fiscal_year). Drafts and archives
-- can pile up freely while the tenant iterates.
CREATE UNIQUE INDEX IF NOT EXISTS budgets_active_per_year
    ON budgets (tenant_id, fiscal_year)
    WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS budgets_tenant_year_idx
    ON budgets (tenant_id, fiscal_year)
    WHERE deleted_at IS NULL;

-- updated_at trigger (reuse the function declared in 88-pricing-plans.sql).
DROP TRIGGER IF EXISTS trg_budgets_updated_at ON budgets;
CREATE TRIGGER trg_budgets_updated_at
    BEFORE UPDATE ON budgets
    FOR EACH ROW
    EXECUTE FUNCTION set_subscriptions_updated_at();

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budgets_tenant_isolation ON budgets;
CREATE POLICY budgets_tenant_isolation
    ON budgets
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS budget_lines (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    tenant_id uuid NOT NULL
        REFERENCES tenants(id) ON DELETE CASCADE,
    budget_id uuid NOT NULL
        REFERENCES budgets(id) ON DELETE CASCADE,
    account_id uuid NOT NULL
        REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    -- Optional cost-center dimension (#129 / B1). When set, the
    -- variance report compares against actuals filtered to the same
    -- center. When null, the line covers actuals across all centers
    -- for that account.
    cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
    amount_cents bigint NOT NULL,
    notes varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- One line per (budget, account, cost_center) combination.
    -- Re-budgeting an existing combo is a PATCH, not an INSERT.
    -- COALESCE so NULL cost_center_id slots collapse correctly.
    CONSTRAINT budget_lines_unique_combo
        UNIQUE (budget_id, account_id, cost_center_id)
);

CREATE INDEX IF NOT EXISTS budget_lines_budget_idx
    ON budget_lines (budget_id);
CREATE INDEX IF NOT EXISTS budget_lines_tenant_account_idx
    ON budget_lines (tenant_id, account_id);

ALTER TABLE budget_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_lines_tenant_isolation ON budget_lines;
CREATE POLICY budget_lines_tenant_isolation
    ON budget_lines
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON budgets TO pettahpro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON budget_lines TO pettahpro_app;
