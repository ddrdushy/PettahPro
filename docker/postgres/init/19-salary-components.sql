-- Salary components: decompose a paycheque into named earnings and deductions.
--
-- v1 payroll flattened pay into `employees.basic_salary_cents`. That's fine for
-- the simplest case, but real SL payrolls have Basic + BRA + COLA + transport +
-- food + overtime + attendance + commission, plus recoveries (salary advance,
-- no-pay leave). Each line has different statutory treatment — BRA counts for
-- EPF/ETF, but a food allowance typically doesn't.
--
-- Design:
--   salary_components          tenant library of named components with
--                              statutory flags (counts_for_epf/etf/paye).
--   employee_salary_components per-employee assignments; effective-dated so
--                              increments don't rewrite history.
--   payroll_run_line_components snapshot of what the line was composed of,
--                              for audit + payslip breakdown.
--
-- The existing `employees.basic_salary_cents` stays as the anchor for the
-- default "Basic salary" component (calculation_basis='from_employee_basic').
-- No data migration required.

CREATE TABLE IF NOT EXISTS salary_components (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                  varchar(32) NOT NULL,
  name                  varchar(128) NOT NULL,
  -- earning = adds to gross; deduction = subtracts from take-home (post-tax)
  kind                  varchar(16) NOT NULL,
  -- fixed              — amount_cents is the component value
  -- percent_of_basic   — percent_bps of employees.basic_salary_cents
  -- from_employee_basic — reads employees.basic_salary_cents directly (only used
  --                       by the system-seeded "Basic salary" row)
  calculation_basis     varchar(32) NOT NULL DEFAULT 'fixed',
  -- Default magnitude for new assignments; can be overridden per employee.
  default_amount_cents  bigint NOT NULL DEFAULT 0,
  default_percent_bps   integer NOT NULL DEFAULT 0,
  -- Statutory basis flags. An earning with counts_for_epf=true is included in
  -- the EPF gross; a deduction with these flags true reduces the EPF gross
  -- (e.g. no-pay leave). These map directly to EPF Act s.47 definition of
  -- "total earnings" and IRD PAYE guidance on non-cash perquisites.
  counts_for_epf        boolean NOT NULL DEFAULT true,
  counts_for_etf        boolean NOT NULL DEFAULT true,
  counts_for_paye       boolean NOT NULL DEFAULT true,
  -- System rows can't be deleted (Basic, BRA, etc.). User-added rows can.
  is_system             boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  -- Sort index for consistent payslip ordering.
  sort_order            integer NOT NULL DEFAULT 0,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT salary_components_kind_check
    CHECK (kind IN ('earning','deduction')),
  CONSTRAINT salary_components_basis_check
    CHECK (calculation_basis IN ('fixed','percent_of_basic','from_employee_basic')),
  CONSTRAINT salary_components_percent_range
    CHECK (default_percent_bps BETWEEN 0 AND 1000000)
);

CREATE UNIQUE INDEX IF NOT EXISTS salary_components_tenant_code_unique
  ON salary_components(tenant_id, code)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS salary_components_tenant_active
  ON salary_components(tenant_id, is_active)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- employee_salary_components — per-employee structure, effective-dated.
--
-- A row = "Employee X receives Component Y of amount Z from date D1 to D2".
-- Overlapping rows for the same (employee, component) are disallowed via the
-- partial unique index on effective_from IS NOT NULL AND effective_to IS NULL
-- (one current row). Historical rows (with effective_to set) stack under it.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_salary_components (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  component_id      uuid NOT NULL REFERENCES salary_components(id) ON DELETE RESTRICT,
  amount_cents      bigint NOT NULL DEFAULT 0,
  percent_bps       integer NOT NULL DEFAULT 0,
  effective_from    date NOT NULL,
  effective_to      date,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  deleted_at        timestamptz,
  CONSTRAINT emp_salary_components_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT emp_salary_components_amount_nn
    CHECK (amount_cents >= 0 AND percent_bps >= 0)
);

CREATE INDEX IF NOT EXISTS emp_salary_components_employee_idx
  ON employee_salary_components(tenant_id, employee_id)
  WHERE deleted_at IS NULL;
-- Only one "current" (open-ended) assignment per (employee, component).
CREATE UNIQUE INDEX IF NOT EXISTS emp_salary_components_current_unique
  ON employee_salary_components(employee_id, component_id)
  WHERE effective_to IS NULL AND deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- payroll_run_line_components — snapshot of each line's breakdown at post time.
--
-- This makes the payslip auditable: the historical assignment might be edited
-- later, but the line's breakdown is frozen to what was computed when the run
-- was drafted.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_run_line_components (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  line_id             uuid NOT NULL REFERENCES payroll_run_lines(id) ON DELETE CASCADE,
  component_id        uuid REFERENCES salary_components(id) ON DELETE SET NULL,
  -- Snapshot fields so payslips render correctly even if library rows change
  code                varchar(32) NOT NULL,
  name                varchar(128) NOT NULL,
  kind                varchar(16) NOT NULL,
  amount_cents        bigint NOT NULL,
  counts_for_epf      boolean NOT NULL,
  counts_for_etf      boolean NOT NULL,
  counts_for_paye     boolean NOT NULL,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_line_components_kind_check
    CHECK (kind IN ('earning','deduction')),
  CONSTRAINT payroll_line_components_amount_nn
    CHECK (amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS payroll_run_line_components_line_idx
  ON payroll_run_line_components(line_id);
CREATE INDEX IF NOT EXISTS payroll_run_line_components_tenant_idx
  ON payroll_run_line_components(tenant_id);

-- RLS
ALTER TABLE salary_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS salary_components_tenant_isolation ON salary_components;
CREATE POLICY salary_components_tenant_isolation ON salary_components
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE employee_salary_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_salary_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emp_salary_components_tenant_isolation ON employee_salary_components;
CREATE POLICY emp_salary_components_tenant_isolation ON employee_salary_components
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE payroll_run_line_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_line_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_run_line_components_tenant_isolation ON payroll_run_line_components;
CREATE POLICY payroll_run_line_components_tenant_isolation ON payroll_run_line_components
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Add earnings/deductions split on payroll_run_lines for fast payslip header
-- ("Earnings: 120,000 · Deductions: 18,000 · Net: 102,000") without joining
-- the components table.
ALTER TABLE payroll_run_lines
  ADD COLUMN IF NOT EXISTS earnings_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE payroll_run_lines
  ADD COLUMN IF NOT EXISTS non_statutory_deductions_cents bigint NOT NULL DEFAULT 0;

-- Catch-up: any tenant created before this migration (through the old
-- seed_tenant_defaults that didn't know about salary_components) gets the
-- standard library seeded now. New tenants hit the updated seed function
-- directly. This block is idempotent — the unique (tenant_id, code) index
-- + WHERE NOT EXISTS skips tenants that already have Basic.
DO $$
DECLARE
  t uuid;
BEGIN
  FOR t IN
    SELECT id FROM tenants
    WHERE NOT EXISTS (
      SELECT 1 FROM salary_components sc
      WHERE sc.tenant_id = tenants.id AND sc.code = 'BASIC'
    )
  LOOP
    INSERT INTO salary_components
      (tenant_id, code, name, kind, calculation_basis,
       counts_for_epf, counts_for_etf, counts_for_paye,
       is_system, sort_order)
    VALUES
      (t, 'BASIC',  'Basic salary',        'earning',   'from_employee_basic', true,  true,  true,  true,  10),
      (t, 'BRA',    'BRA',                 'earning',   'fixed',               true,  true,  true,  true,  20),
      (t, 'COLA',   'COLA',                'earning',   'fixed',               true,  true,  true,  true,  30),
      (t, 'TRANSP', 'Transport allowance', 'earning',   'fixed',               false, false, false, true,  40),
      (t, 'FOOD',   'Food allowance',      'earning',   'fixed',               false, false, false, true,  50),
      (t, 'OT',     'Overtime',            'earning',   'fixed',               true,  true,  true,  true,  60),
      (t, 'ATT',    'Attendance bonus',    'earning',   'fixed',               true,  true,  true,  true,  70),
      (t, 'COMM',   'Commission',          'earning',   'fixed',               true,  true,  true,  true,  80),
      (t, 'NOPAY',  'No-pay leave',        'deduction', 'fixed',               true,  true,  true,  true,  90),
      (t, 'ADVREC', 'Salary advance recovery', 'deduction', 'fixed',           false, false, false, true, 100);
  END LOOP;
END $$;
