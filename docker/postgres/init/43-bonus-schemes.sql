-- Bonus schemes & off-cycle bonus runs (payroll-module-spec §7).
--
-- Two tables (plus lines):
--   bonus_schemes   — tenant-configured library of bonus programs. Each
--                     scheme carries the formula (flat amount / % of
--                     basic / days-of-basic / manual), eligibility
--                     constraints (min tenure, employment types, statuses),
--                     and tax treatment (counts_for_epf/etf/paye).
--   bonus_runs      — one row per bulk bonus execution (e.g. "Avurudu
--                     2026"). Moves through draft → posted → void.
--                     Post books a JE: DR Salaries & wages / CR Salaries
--                     payable / CR PAYE payable / CR EPF payable (+ DR
--                     6001/6002 for employer EPF/ETF when applicable).
--   bonus_run_lines — snapshot per employee. Computed from the scheme
--                     formula, optionally manually-adjusted before post.
--
-- Reuses the existing sl-tax compute by shaping the bonus as a single
-- earning component — EPF/ETF/PAYE math is identical to regular payroll.
-- This is v1 simple: the bonus sits in the period received for PAYE
-- (not annualized over 12 months); tenants can toggle paye off per
-- scheme if they treat bonuses as tax-exempt.
--
-- v1 scope deliberately excludes:
--   · Long-service milestone auto-triggers (manual run for now)
--   · Attendance-linked formulas (need integration with attendance data)
--   · Bonus memo PDF letters (payslip PDF covers the numbers)
--   · Annualized PAYE spreading (period-taxed is the simpler option)

CREATE TABLE IF NOT EXISTS bonus_schemes (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                        varchar(32) NOT NULL,
  name                        varchar(128) NOT NULL,
  description                 text,
  -- Formula drives how per-employee amount is seeded:
  --   flat_amount      → formula_value cents flat per eligible employee
  --   percent_of_basic → formula_value bps × current basic / 10_000
  --   days_of_basic    → formula_value × (basic / salary_days_per_month)
  --   manual           → 0 on compute; HR enters per employee before post
  formula_type                varchar(24) NOT NULL,
  formula_value               bigint,
  -- Eligibility
  eligibility_min_tenure_days integer NOT NULL DEFAULT 0,
  eligibility_employment_types text[] NOT NULL DEFAULT ARRAY['permanent']::text[],
  eligibility_statuses         text[] NOT NULL DEFAULT ARRAY['active','confirmed','on_probation']::text[],
  -- Tax treatment (flags; mirror salary_components semantics)
  counts_for_epf              boolean NOT NULL DEFAULT false,
  counts_for_etf              boolean NOT NULL DEFAULT false,
  counts_for_paye             boolean NOT NULL DEFAULT true,
  -- Optional ledger override (defaults to subtype='payroll' account → 6000)
  expense_account_id          uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_active                   boolean NOT NULL DEFAULT true,
  is_system                   boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_user_id          uuid,
  deleted_at                  timestamptz,
  CONSTRAINT bonus_schemes_formula_type_check CHECK (
    formula_type IN ('flat_amount','percent_of_basic','days_of_basic','manual')
  ),
  CONSTRAINT bonus_schemes_formula_value_check CHECK (
    (formula_type = 'manual' AND formula_value IS NULL)
    OR (formula_type <> 'manual' AND formula_value IS NOT NULL AND formula_value >= 0)
  ),
  CONSTRAINT bonus_schemes_tenure_non_negative CHECK (eligibility_min_tenure_days >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS bonus_schemes_tenant_code_unique
  ON bonus_schemes(tenant_id, code)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bonus_schemes_tenant_active
  ON bonus_schemes(tenant_id, is_active)
  WHERE deleted_at IS NULL;

ALTER TABLE bonus_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonus_schemes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bonus_schemes_isolation ON bonus_schemes;
CREATE POLICY bonus_schemes_isolation ON bonus_schemes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());


CREATE TABLE IF NOT EXISTS bonus_runs (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scheme_id                   uuid NOT NULL REFERENCES bonus_schemes(id) ON DELETE RESTRICT,
  run_number                  varchar(48),
  label                       varchar(128) NOT NULL,
  pay_date                    date NOT NULL,
  status                      varchar(16) NOT NULL DEFAULT 'draft',
  employee_count              integer NOT NULL DEFAULT 0,
  -- Rollup totals refreshed on compute + at post
  gross_cents                 bigint NOT NULL DEFAULT 0,
  epf_employee_cents          bigint NOT NULL DEFAULT 0,
  epf_employer_cents          bigint NOT NULL DEFAULT 0,
  etf_employer_cents          bigint NOT NULL DEFAULT 0,
  paye_cents                  bigint NOT NULL DEFAULT 0,
  net_pay_cents               bigint NOT NULL DEFAULT 0,
  -- Posting
  journal_entry_id            uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  posted_at                   timestamptz,
  posted_by_user_id           uuid,
  void_reason                 text,
  void_at                     timestamptz,
  void_by_user_id             uuid,
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_user_id          uuid,
  deleted_at                  timestamptz,
  CONSTRAINT bonus_runs_status_check CHECK (status IN ('draft','posted','void'))
);

CREATE INDEX IF NOT EXISTS bonus_runs_tenant_status_date
  ON bonus_runs(tenant_id, status, pay_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bonus_runs_scheme
  ON bonus_runs(tenant_id, scheme_id)
  WHERE deleted_at IS NULL;

ALTER TABLE bonus_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonus_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bonus_runs_isolation ON bonus_runs;
CREATE POLICY bonus_runs_isolation ON bonus_runs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());


CREATE TABLE IF NOT EXISTS bonus_run_lines (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id                      uuid NOT NULL REFERENCES bonus_runs(id) ON DELETE CASCADE,
  employee_id                 uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  -- Snapshot (frozen at post)
  employee_full_name          varchar(255) NOT NULL,
  employee_code               varchar(32),
  nic                         varchar(20),
  epf_number                  varchar(30),
  etf_number                  varchar(30),
  designation                 varchar(128),
  department                  varchar(128),
  basic_at_run_cents          bigint NOT NULL,
  -- Computed economics
  bonus_gross_cents           bigint NOT NULL DEFAULT 0,
  epf_employee_cents          bigint NOT NULL DEFAULT 0,
  epf_employer_cents          bigint NOT NULL DEFAULT 0,
  etf_employer_cents          bigint NOT NULL DEFAULT 0,
  paye_cents                  bigint NOT NULL DEFAULT 0,
  net_pay_cents               bigint NOT NULL DEFAULT 0,
  -- Flag so the UI knows a human overrode the formula
  was_manually_adjusted       boolean NOT NULL DEFAULT false,
  -- Flags frozen at post so a later change in employee's flags
  -- doesn't rewrite history
  was_epf_applied             boolean NOT NULL DEFAULT false,
  was_etf_applied             boolean NOT NULL DEFAULT false,
  was_paye_applied            boolean NOT NULL DEFAULT false,
  -- Banking snapshot
  bank_name                   varchar(128),
  bank_account_no             varchar(64),
  bank_branch                 varchar(128),
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bonus_run_lines_run
  ON bonus_run_lines(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS bonus_run_lines_run_employee_unique
  ON bonus_run_lines(run_id, employee_id);

ALTER TABLE bonus_run_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonus_run_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bonus_run_lines_isolation ON bonus_run_lines;
CREATE POLICY bonus_run_lines_isolation ON bonus_run_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());


-- Seed existing tenants with a compact SL-typical bonus scheme library.
-- Idempotent: skips tenants that already have any bonus schemes.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants WHERE deleted_at IS NULL LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);

    -- Document sequence for bonus run numbers (BON-0001, year-scoped)
    IF to_regclass('public.document_sequences') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM document_sequences
        WHERE tenant_id = t.id AND sequence_name = 'bonus_run'
      )
    THEN
      INSERT INTO document_sequences (tenant_id, sequence_name, prefix, scope, pad_width)
      VALUES (t.id, 'bonus_run', 'BON', 'year', 4)
      ON CONFLICT DO NOTHING;
    END IF;

    -- Skip seeding schemes if tenant already has any (idempotent across reruns)
    IF NOT EXISTS (
      SELECT 1 FROM bonus_schemes
      WHERE tenant_id = t.id AND deleted_at IS NULL
    ) THEN
      INSERT INTO bonus_schemes
        (tenant_id, code, name, description,
         formula_type, formula_value,
         eligibility_min_tenure_days,
         counts_for_epf, counts_for_etf, counts_for_paye,
         is_system)
      VALUES
        (t.id, 'AVURUDU',     'Avurudu bonus',
          'Sinhala/Tamil New Year bonus, typically half-month salary. Paid in April.',
          'days_of_basic', 15, 0,
          false, false, true, true),
        (t.id, 'CHRISTMAS',   'Christmas bonus',
          'Year-end bonus in December, often half-month salary.',
          'days_of_basic', 15, 0,
          false, false, true, true),
        (t.id, '13TH_MONTH',  '13th month salary',
          'Full extra month salary, typically paid in December with Christmas.',
          'days_of_basic', 30, 180,
          false, false, true, true),
        (t.id, 'PERFORMANCE', 'Performance bonus',
          'Annual performance bonus. Amounts entered per employee based on rating.',
          'manual', NULL, 365,
          false, false, true, true)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;


-- Mirror the seed for freshly-signed-up tenants. The signup flow invokes
-- seed_tenant_bonus_schemes() after seed_default_tenant_data() so new
-- tenants get the library without a redeploy.
CREATE OR REPLACE FUNCTION seed_tenant_bonus_schemes(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);

  IF to_regclass('public.document_sequences') IS NOT NULL THEN
    INSERT INTO document_sequences (tenant_id, sequence_name, prefix, scope, pad_width)
    VALUES (p_tenant_id, 'bonus_run', 'BON', 'year', 4)
    ON CONFLICT (tenant_id, sequence_name) DO NOTHING;
  END IF;

  INSERT INTO bonus_schemes
    (tenant_id, code, name, description,
     formula_type, formula_value,
     eligibility_min_tenure_days,
     counts_for_epf, counts_for_etf, counts_for_paye,
     is_system)
  VALUES
    (p_tenant_id, 'AVURUDU',     'Avurudu bonus',
      'Sinhala/Tamil New Year bonus, typically half-month salary. Paid in April.',
      'days_of_basic', 15, 0,
      false, false, true, true),
    (p_tenant_id, 'CHRISTMAS',   'Christmas bonus',
      'Year-end bonus in December, often half-month salary.',
      'days_of_basic', 15, 0,
      false, false, true, true),
    (p_tenant_id, '13TH_MONTH',  '13th month salary',
      'Full extra month salary, typically paid in December with Christmas.',
      'days_of_basic', 30, 180,
      false, false, true, true),
    (p_tenant_id, 'PERFORMANCE', 'Performance bonus',
      'Annual performance bonus. Amounts entered per employee based on rating.',
      'manual', NULL, 365,
      false, false, true, true)
  ON CONFLICT DO NOTHING;
END;
$$;


COMMENT ON TABLE bonus_schemes IS
  'Tenant library of bonus programs — formula, eligibility, tax treatment.';
COMMENT ON TABLE bonus_runs IS
  'Off-cycle bonus execution. draft → posted (books JE) → void. One run per scheme-instance (e.g. "Avurudu 2026").';
COMMENT ON TABLE bonus_run_lines IS
  'Per-employee bonus snapshot. Computed from scheme formula, optionally manually adjusted before post.';
COMMENT ON COLUMN bonus_schemes.formula_type IS
  'How per-employee amount is seeded: flat_amount (formula_value cents), percent_of_basic (bps), days_of_basic (days, /30 of monthly basic), manual (HR enters each).';
COMMENT ON COLUMN bonus_schemes.formula_value IS
  'Units depend on formula_type. NULL for manual. cents for flat_amount, bps for percent_of_basic, days for days_of_basic.';
COMMENT ON COLUMN bonus_run_lines.was_manually_adjusted IS
  'TRUE when HR overrode the formula-seeded amount before post. Shown as a chip on the run detail.';
