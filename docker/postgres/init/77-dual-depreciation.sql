-- Dual depreciation (book vs tax) — roadmap #40 / accounting-spec §8.3
--
-- Problem:
--   SL IRD tax depreciation rates almost always differ from the tenant's
--   SLFRS book policy (a laptop might book over 4 years SLM but tax-depreciate
--   at 25% WDV; a building might book over 40 years but tax at 5% WDV). Until
--   now we tracked one schedule. A CA reconciling for tax has to keep a
--   spreadsheet on the side.
--
--   This migration adds a parallel TAX schedule that runs side-by-side with
--   the existing BOOK schedule. Book posts to GL (unchanged). Tax is
--   memo-only — CA uses it to compute taxable income in the tax computation
--   workflow, but it never touches the ledger.
--
-- Model:
--   - fixed_assets gains tax_* mirror columns (method, useful life, salvage,
--     annual rate for WDV, accumulated, last-run date, start date).
--     Backfill: tax_* = book_* so existing assets keep the current (single)
--     schedule unless the user overrides them. The CA can then flip WDV +
--     IRD rate on a per-asset basis.
--   - fixed_asset_tax_depreciation_entries — mirrors the book entries table
--     but WITHOUT journal_entry_id. Running tax dep inserts here and updates
--     tax_accumulated on the asset. No JE is posted.
--   - Method CHECK widened to allow 'straight_line', 'wdv', 'sum_of_years_digits'
--     for BOTH book and tax. Book has historically been SLM-only but there's
--     no reason to block a tenant whose accounting policy is WDV.
--
-- Idempotent: re-running skips via IF NOT EXISTS / IF EXISTS guards.

-- Widen the method CHECK (drop old, add new with full method set).
ALTER TABLE fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_method_check;
ALTER TABLE fixed_assets
  ADD CONSTRAINT fixed_assets_method_check
  CHECK (depreciation_method IN ('straight_line','wdv','sum_of_years_digits'));

-- Add tax schedule columns. All nullable initially so we can backfill from
-- the book columns in the same migration, then there's no need to NOT NULL
-- them (defaults cover new inserts via the schema, backfill covers old rows).
ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS tax_depreciation_method      varchar(24),
  ADD COLUMN IF NOT EXISTS tax_useful_life_months       integer,
  ADD COLUMN IF NOT EXISTS tax_salvage_cents            bigint,
  -- Annual rate in basis points (e.g. 2000 = 20.00%) — used by WDV.
  -- Null is fine for SLM / SOYD where the rate is derived from useful life.
  ADD COLUMN IF NOT EXISTS tax_annual_rate_bps          integer,
  ADD COLUMN IF NOT EXISTS tax_depreciation_start_date  date,
  ADD COLUMN IF NOT EXISTS tax_accumulated_depreciation_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_last_depreciation_run_date     date;

-- Backfill tax_* from book_* for existing rows. Tax defaults to mirroring the
-- book schedule — the CA opts in to divergence by editing the asset.
UPDATE fixed_assets
SET
  tax_depreciation_method      = COALESCE(tax_depreciation_method, depreciation_method),
  tax_useful_life_months       = COALESCE(tax_useful_life_months, useful_life_months),
  tax_salvage_cents            = COALESCE(tax_salvage_cents, salvage_cents),
  tax_depreciation_start_date  = COALESCE(tax_depreciation_start_date, depreciation_start_date)
WHERE
  tax_depreciation_method IS NULL
  OR tax_useful_life_months IS NULL
  OR tax_salvage_cents IS NULL
  OR tax_depreciation_start_date IS NULL;

-- Now the columns are filled for every row, set NOT NULL.
ALTER TABLE fixed_assets
  ALTER COLUMN tax_depreciation_method      SET NOT NULL,
  ALTER COLUMN tax_useful_life_months       SET NOT NULL,
  ALTER COLUMN tax_salvage_cents            SET NOT NULL,
  ALTER COLUMN tax_depreciation_start_date  SET NOT NULL;

-- Method CHECK for tax side (same set as book).
ALTER TABLE fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_tax_method_check;
ALTER TABLE fixed_assets
  ADD CONSTRAINT fixed_assets_tax_method_check
  CHECK (tax_depreciation_method IN ('straight_line','wdv','sum_of_years_digits'));

-- Bounds on tax accumulated (same shape as book).
ALTER TABLE fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_tax_amounts_check;
ALTER TABLE fixed_assets
  ADD CONSTRAINT fixed_assets_tax_amounts_check CHECK (
    tax_salvage_cents >= 0
    AND tax_accumulated_depreciation_cents >= 0
    AND tax_salvage_cents <= cost_cents
    AND tax_accumulated_depreciation_cents <= cost_cents - tax_salvage_cents
    AND tax_useful_life_months > 0
    AND (tax_annual_rate_bps IS NULL OR (tax_annual_rate_bps >= 0 AND tax_annual_rate_bps <= 100000))
  );

-- Parallel tax-depreciation entries table. Same shape as the book entries
-- table MINUS journal_entry_id — tax schedule is memo-only, never posts to GL.
CREATE TABLE IF NOT EXISTS fixed_asset_tax_depreciation_entries (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fixed_asset_id           uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  run_date                 date NOT NULL,
  period_year              smallint NOT NULL,
  period_month             smallint NOT NULL,
  depreciation_cents       bigint NOT NULL,
  accumulated_after_cents  bigint NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fatd_entries_amount_non_negative CHECK (depreciation_cents >= 0 AND accumulated_after_cents >= 0),
  CONSTRAINT fatd_entries_month_range CHECK (period_month BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX IF NOT EXISTS fatd_entries_tenant_asset_period_unique
  ON fixed_asset_tax_depreciation_entries(tenant_id, fixed_asset_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS fatd_entries_tenant_period
  ON fixed_asset_tax_depreciation_entries(tenant_id, period_year, period_month);

ALTER TABLE fixed_asset_tax_depreciation_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_asset_tax_depreciation_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fatd_entries_tenant_isolation ON fixed_asset_tax_depreciation_entries;
CREATE POLICY fatd_entries_tenant_isolation ON fixed_asset_tax_depreciation_entries
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
