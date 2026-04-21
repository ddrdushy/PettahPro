-- Fixed assets register + depreciation schedule
-- v1: straight-line only, single accumulated-depreciation account per asset,
-- monthly depreciation runs post a consolidated JE grouped by account pair.
-- Out of scope for v1: disposal, impairment, revaluation, tax-depreciation
-- parallel books (SL IRD lets you depreciate at different rates).

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                            varchar(32),
  name                            varchar(255) NOT NULL,
  category                        varchar(32) NOT NULL DEFAULT 'equipment',
  -- GL accounts: on register we don't post anything; depreciation runs post
  --   DR depreciation_expense_account_id  ← P&L expense
  --   CR accumulated_depreciation_account_id  ← contra-asset on the BS
  asset_account_id                uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  accumulated_depreciation_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  depreciation_expense_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  -- Lifecycle
  acquisition_date                date NOT NULL,
  depreciation_start_date         date NOT NULL,       -- usually acquisition_date; first run onwards
  cost_cents                      bigint NOT NULL,
  salvage_cents                   bigint NOT NULL DEFAULT 0,
  useful_life_months              integer NOT NULL,
  depreciation_method             varchar(16) NOT NULL DEFAULT 'straight_line',
  -- Running values, updated after each depreciation_run
  accumulated_depreciation_cents  bigint NOT NULL DEFAULT 0,
  last_depreciation_run_date      date,                  -- month-end key for the last run
  status                          varchar(16) NOT NULL DEFAULT 'active',
  supplier_id                     uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  bill_id                         uuid REFERENCES bills(id) ON DELETE SET NULL,
  notes                           text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  created_by_user_id              uuid,
  deleted_at                      timestamptz,
  CONSTRAINT fixed_assets_category_check CHECK (category IN (
    'vehicle','equipment','furniture','building','it_hardware','software','land','other'
  )),
  CONSTRAINT fixed_assets_method_check CHECK (depreciation_method IN ('straight_line')),
  CONSTRAINT fixed_assets_status_check CHECK (status IN ('active','disposed','written_off')),
  CONSTRAINT fixed_assets_amounts_non_negative CHECK (
    cost_cents >= 0 AND salvage_cents >= 0 AND accumulated_depreciation_cents >= 0
  ),
  CONSTRAINT fixed_assets_salvage_bounded CHECK (salvage_cents <= cost_cents),
  CONSTRAINT fixed_assets_life_positive CHECK (useful_life_months > 0),
  CONSTRAINT fixed_assets_accumulated_bounded CHECK (
    accumulated_depreciation_cents <= cost_cents - salvage_cents
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS fixed_assets_tenant_code_unique
  ON fixed_assets(tenant_id, code)
  WHERE code IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS fixed_assets_tenant_status ON fixed_assets(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS fixed_assets_tenant_category ON fixed_assets(tenant_id, category);

-- Per-asset depreciation entries — one row per asset per monthly run.
-- Gives us a clean audit trail and feeds the asset-detail history panel.
CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_entries (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fixed_asset_id           uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  run_date                 date NOT NULL,          -- month-end (or period end) of the run
  period_year              smallint NOT NULL,
  period_month             smallint NOT NULL,
  depreciation_cents       bigint NOT NULL,
  accumulated_after_cents  bigint NOT NULL,
  journal_entry_id         uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fad_entries_amount_non_negative CHECK (depreciation_cents >= 0 AND accumulated_after_cents >= 0),
  CONSTRAINT fad_entries_month_range CHECK (period_month BETWEEN 1 AND 12)
);

-- One depreciation entry per asset per (year,month) — prevents double-posting
CREATE UNIQUE INDEX IF NOT EXISTS fad_entries_tenant_asset_period_unique
  ON fixed_asset_depreciation_entries(tenant_id, fixed_asset_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS fad_entries_tenant_period
  ON fixed_asset_depreciation_entries(tenant_id, period_year, period_month);

ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fixed_assets_tenant_isolation ON fixed_assets;
CREATE POLICY fixed_assets_tenant_isolation ON fixed_assets
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE fixed_asset_depreciation_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_asset_depreciation_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fad_entries_tenant_isolation ON fixed_asset_depreciation_entries;
CREATE POLICY fad_entries_tenant_isolation ON fixed_asset_depreciation_entries
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
