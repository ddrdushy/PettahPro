-- Employee master for payroll. Minimum viable v1 — identity + statutory
-- numbers + monthly basic salary + status. Salary structure tables and
-- payroll-run tables land in later migrations.

CREATE TABLE IF NOT EXISTS employees (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Identity
  employee_code             varchar(32),
  first_name                varchar(128) NOT NULL,
  last_name                 varchar(128) NOT NULL,
  full_name                 varchar(255) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  date_of_birth             date,
  gender                    varchar(16),
  -- Contact
  personal_email            varchar(255),
  mobile_phone              varchar(32),
  whatsapp                  varchar(32),
  address_line1             varchar(255),
  city                      varchar(128),
  postal_code               varchar(16),
  -- SL statutory numbers
  nic                       varchar(20),
  epf_number                varchar(30),
  etf_number                varchar(30),
  tin                       varchar(32),
  -- Employment
  hire_date                 date NOT NULL,
  employment_type           varchar(16) NOT NULL DEFAULT 'permanent',
  designation               varchar(128),
  department                varchar(128),
  branch_id                 uuid REFERENCES branches(id) ON DELETE SET NULL,
  wage_type                 varchar(16) NOT NULL DEFAULT 'monthly',
  -- Pay basics (full salary-structure tables come later)
  basic_salary_cents        bigint NOT NULL DEFAULT 0,
  currency                  varchar(3) NOT NULL DEFAULT 'LKR',
  -- Statutory eligibility (SL defaults: contribute to EPF+ETF and liable for PAYE)
  epf_eligible              boolean NOT NULL DEFAULT true,
  etf_eligible              boolean NOT NULL DEFAULT true,
  paye_applicable           boolean NOT NULL DEFAULT true,
  -- Bank for SLIPS disbursement
  bank_name                 varchar(128),
  bank_account_no           varchar(64),
  bank_branch               varchar(128),
  -- Lifecycle
  status                    varchar(24) NOT NULL DEFAULT 'active',
  status_changed_at         timestamptz NOT NULL DEFAULT now(),
  status_change_reason      text,
  exit_date                 date,
  -- Audit
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by_user_id        uuid,
  deleted_at                timestamptz,
  CONSTRAINT employees_employment_type_check CHECK (
    employment_type IN ('permanent','contract','casual','probation','intern','consultant')
  ),
  CONSTRAINT employees_wage_type_check CHECK (
    wage_type IN ('monthly','daily','hourly','piece','commission')
  ),
  CONSTRAINT employees_gender_check CHECK (
    gender IS NULL OR gender IN ('male','female','other','prefer_not_say')
  ),
  CONSTRAINT employees_status_check CHECK (
    status IN ('active','on_probation','confirmed','suspended','resigned','terminated','retired','deceased')
  ),
  CONSTRAINT employees_basic_salary_non_negative CHECK (basic_salary_cents >= 0),
  -- SL NIC: old 10-char (9 digits + V|X) or new 12-digit
  CONSTRAINT employees_nic_format CHECK (
    nic IS NULL
    OR nic ~ '^[0-9]{9}[VvXx]$'
    OR nic ~ '^[0-9]{12}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_code_unique
  ON employees(tenant_id, employee_code)
  WHERE deleted_at IS NULL AND employee_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_nic_unique
  ON employees(tenant_id, nic)
  WHERE deleted_at IS NULL AND nic IS NOT NULL;
CREATE INDEX IF NOT EXISTS employees_tenant_status
  ON employees(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS employees_tenant_branch ON employees(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS employees_name_search
  ON employees USING gin(full_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employees_tenant_isolation ON employees;
CREATE POLICY employees_tenant_isolation ON employees
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
