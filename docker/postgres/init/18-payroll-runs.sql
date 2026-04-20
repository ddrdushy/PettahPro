-- Monthly payroll run. A run = one payslip per active employee for a
-- specific period (YYYY-MM). Statutory amounts are computed at post time
-- using the employee's basic_salary_cents snapshotted into the line.
--
-- v1 scope: compensation is just basic_salary. Allowances, overtime,
-- loan recoveries, leave encashment and commissions layer in later.

CREATE TABLE IF NOT EXISTS payroll_runs (
  id                           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_number                   varchar(48),
  period_year                  smallint NOT NULL,
  period_month                 smallint NOT NULL,
  period_start                 date NOT NULL,
  period_end                   date NOT NULL,
  pay_date                     date NOT NULL,
  status                       varchar(16) NOT NULL DEFAULT 'draft',   -- draft | posted | paid | void
  employee_count               integer NOT NULL DEFAULT 0,
  -- Aggregates (sum of line values) — denormalized for list views
  gross_cents                  bigint NOT NULL DEFAULT 0,
  epf_employee_cents           bigint NOT NULL DEFAULT 0,
  epf_employer_cents           bigint NOT NULL DEFAULT 0,
  etf_employer_cents           bigint NOT NULL DEFAULT 0,
  paye_cents                   bigint NOT NULL DEFAULT 0,
  net_pay_cents                bigint NOT NULL DEFAULT 0,
  -- Posting
  journal_entry_id             uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  posted_at                    timestamptz,
  posted_by_user_id            uuid,
  notes                        text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  created_by_user_id           uuid,
  deleted_at                   timestamptz,
  CONSTRAINT payroll_runs_status_check CHECK (status IN ('draft','posted','paid','void')),
  CONSTRAINT payroll_runs_period_month_range CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT payroll_runs_period_ordering CHECK (period_end >= period_start)
);

-- One posted run per (tenant, year, month) — only one payroll per calendar month.
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_tenant_period_unique
  ON payroll_runs(tenant_id, period_year, period_month)
  WHERE status <> 'void' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_tenant_number_unique
  ON payroll_runs(tenant_id, run_number)
  WHERE run_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS payroll_runs_tenant_pay_date
  ON payroll_runs(tenant_id, pay_date);

-- ------------------------------------------------------------------------------
-- payroll_run_lines — one per employee per run. The actual payslip.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_run_lines (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id                   uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id              uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  -- Snapshotted employee identity (so the payslip reads correctly even if the
  -- employee record later changes)
  employee_full_name       varchar(255) NOT NULL,
  employee_code            varchar(32),
  nic                      varchar(20),
  epf_number               varchar(30),
  etf_number               varchar(30),
  designation              varchar(128),
  department               varchar(128),
  -- Compensation
  basic_salary_cents       bigint NOT NULL,
  gross_cents              bigint NOT NULL,
  -- Statutory deductions from employee
  epf_employee_cents       bigint NOT NULL DEFAULT 0,        -- 8% of gross (SL)
  paye_cents               bigint NOT NULL DEFAULT 0,        -- progressive slab
  other_deductions_cents   bigint NOT NULL DEFAULT 0,
  total_deductions_cents   bigint NOT NULL,
  -- Employer-side contributions (not taken from net; expense to company)
  epf_employer_cents       bigint NOT NULL DEFAULT 0,        -- 12% of gross
  etf_employer_cents       bigint NOT NULL DEFAULT 0,        -- 3% of gross
  -- Net take-home
  net_pay_cents            bigint NOT NULL,
  -- Flags at compute time (remembered so later runs can be re-posted idempotently)
  was_epf_eligible         boolean NOT NULL,
  was_etf_eligible         boolean NOT NULL,
  was_paye_applicable      boolean NOT NULL,
  bank_name                varchar(128),
  bank_account_no          varchar(64),
  bank_branch              varchar(128),
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_run_lines_non_negative CHECK (
    basic_salary_cents >= 0 AND gross_cents >= 0
    AND epf_employee_cents >= 0 AND paye_cents >= 0
    AND other_deductions_cents >= 0 AND total_deductions_cents >= 0
    AND epf_employer_cents >= 0 AND etf_employer_cents >= 0
    AND net_pay_cents >= 0
  )
);

CREATE INDEX IF NOT EXISTS payroll_run_lines_run_idx ON payroll_run_lines(run_id);
CREATE INDEX IF NOT EXISTS payroll_run_lines_tenant_employee
  ON payroll_run_lines(tenant_id, employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_run_lines_unique_per_run
  ON payroll_run_lines(run_id, employee_id);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_runs_tenant_isolation ON payroll_runs;
CREATE POLICY payroll_runs_tenant_isolation ON payroll_runs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE payroll_run_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_run_lines_tenant_isolation ON payroll_run_lines;
CREATE POLICY payroll_run_lines_tenant_isolation ON payroll_run_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
