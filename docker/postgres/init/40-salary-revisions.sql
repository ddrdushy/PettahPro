-- Salary revisions with arrears auto-computation.
-- Per payroll-module-spec §14.4.
--
-- A revision records a change in an employee's basic salary with an
-- effective date. The employee's live `basic_salary_cents` always reflects
-- the latest applied rate — the revision row keeps the immutable history
-- AND the "did we pay this yet?" flag so we don't double-compute arrears.
--
-- Flow:
--   1. HR records a revision with effective_date (can be back-dated).
--      Employee's basic_salary_cents updates immediately.
--   2. On the next payroll run, compute detects revisions with
--      applied_in_run_id IS NULL AND effective_date <= period_start. For
--      each, arrears = (new - previous) × whole-months-between-effective-
--      and-run-period. Inject as ARREARS earning line, counts for EPF/ETF/
--      PAYE. PAYE taxed in the period received (simpler option per spec).
--   3. At post, applied_in_run_id is set so the revision never contributes
--      arrears again.
--
-- Back-dated revisions crossing closed accounting periods are rejected
-- unless the caller is Owner (piggybacks on existing period-lock enforcement
-- applied at journal-post time; here we validate effective_date against
-- the period_lock table when the revision is created).

CREATE TABLE IF NOT EXISTS employee_salary_revisions (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id                 uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_date              date NOT NULL,
  previous_basic_salary_cents bigint NOT NULL,
  new_basic_salary_cents      bigint NOT NULL,
  reason                      varchar(255),
  notes                       text,
  applied_in_run_id           uuid REFERENCES payroll_runs(id) ON DELETE SET NULL,
  applied_at                  timestamptz,
  arrears_cents_applied       bigint,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_user_id          uuid,
  CONSTRAINT salary_revisions_positive
    CHECK (previous_basic_salary_cents >= 0 AND new_basic_salary_cents >= 0),
  CONSTRAINT salary_revisions_changed
    CHECK (new_basic_salary_cents <> previous_basic_salary_cents)
);

CREATE INDEX IF NOT EXISTS salary_revisions_employee
  ON employee_salary_revisions(tenant_id, employee_id, effective_date);

CREATE INDEX IF NOT EXISTS salary_revisions_unapplied
  ON employee_salary_revisions(tenant_id, employee_id)
  WHERE applied_in_run_id IS NULL;

ALTER TABLE employee_salary_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_salary_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS salary_revisions_isolation ON employee_salary_revisions;
CREATE POLICY salary_revisions_isolation ON employee_salary_revisions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

COMMENT ON TABLE employee_salary_revisions IS
  'Immutable history of basic salary changes. Drives auto-computed ARREARS earning lines on the next payroll run.';
COMMENT ON COLUMN employee_salary_revisions.effective_date IS
  'First day the new rate applies. If earlier than the last paid period, the difference is paid as arrears on the next run.';
COMMENT ON COLUMN employee_salary_revisions.applied_in_run_id IS
  'Set when the ARREARS line lands on a posted run. NULL = still to be arrears-compensated.';
