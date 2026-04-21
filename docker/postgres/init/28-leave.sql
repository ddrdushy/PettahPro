-- Leave management (payroll-module-spec §7)
-- 3 tables:
--   leave_types        — tenant-scoped taxonomy (SL defaults seeded)
--   leave_allocations  — per-employee, per-type, per-year entitlement + usage
--   leave_requests     — apply → pending → approved | rejected | cancelled
--
-- No GL impact. Approved leave debits the allocation's used_days. Unpaid
-- leave flows into payroll runs as a salary reduction (separate wiring).

CREATE TABLE IF NOT EXISTS leave_types (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                      varchar(16) NOT NULL,        -- AL, CL, SL, ML, PL, NP
  name                      varchar(128) NOT NULL,
  default_days_per_year     numeric(8, 2) NOT NULL DEFAULT 0,
  is_paid                   boolean NOT NULL DEFAULT true,
  carry_forward_allowed     boolean NOT NULL DEFAULT false,
  max_carry_forward_days    numeric(8, 2) NOT NULL DEFAULT 0,
  is_system                 boolean NOT NULL DEFAULT false,
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  CONSTRAINT leave_types_days_non_negative CHECK (default_days_per_year >= 0 AND max_carry_forward_days >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_types_tenant_code_unique
  ON leave_types(tenant_id, code)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS leave_allocations (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id               uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id             uuid NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  period_year               smallint NOT NULL,
  allocated_days            numeric(8, 2) NOT NULL DEFAULT 0,
  carried_forward_days      numeric(8, 2) NOT NULL DEFAULT 0,
  used_days                 numeric(8, 2) NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_allocations_days_non_negative CHECK (
    allocated_days >= 0 AND carried_forward_days >= 0 AND used_days >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_allocations_emp_type_year_unique
  ON leave_allocations(tenant_id, employee_id, leave_type_id, period_year);
CREATE INDEX IF NOT EXISTS leave_allocations_tenant_employee
  ON leave_allocations(tenant_id, employee_id);

CREATE TABLE IF NOT EXISTS leave_requests (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_number            varchar(32),
  employee_id               uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  leave_type_id             uuid NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  from_date                 date NOT NULL,
  to_date                   date NOT NULL,
  days_count                numeric(8, 2) NOT NULL,         -- authoritative; client can supply partial days
  reason                    text,
  status                    varchar(16) NOT NULL DEFAULT 'draft',
  submitted_at              timestamptz,
  approved_at               timestamptz,
  approved_by_user_id       uuid,
  rejected_at               timestamptz,
  rejected_reason           text,
  cancelled_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by_user_id        uuid,
  CONSTRAINT leave_requests_status_check CHECK (status IN ('draft','pending','approved','rejected','cancelled')),
  CONSTRAINT leave_requests_days_positive CHECK (days_count > 0),
  CONSTRAINT leave_requests_date_range CHECK (from_date <= to_date)
);

CREATE INDEX IF NOT EXISTS leave_requests_tenant_status ON leave_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS leave_requests_tenant_employee ON leave_requests(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS leave_requests_tenant_dates ON leave_requests(tenant_id, from_date, to_date);

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_types_tenant_isolation ON leave_types;
CREATE POLICY leave_types_tenant_isolation ON leave_types
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE leave_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_allocations_tenant_isolation ON leave_allocations;
CREATE POLICY leave_allocations_tenant_isolation ON leave_allocations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_requests_tenant_isolation ON leave_requests;
CREATE POLICY leave_requests_tenant_isolation ON leave_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
