-- Staff loans (payroll-module-spec §6).
--
-- Three tables:
--   loan_types             — tenant library of loan categories (festival,
--                            salary advance, housing, vehicle, emergency),
--                            each with defaults (max amount, rate, tenure).
--   employee_loans         — one row per loan application; moves through
--                            draft → approved → disbursed → closed. The
--                            disbursement step posts a JE (DR Employee
--                            loans receivable / CR Bank) and materializes
--                            the amortisation schedule.
--   employee_loan_schedule — one row per EMI. Payroll compute picks up
--                            unpaid rows with due_date ≤ periodEnd and
--                            injects a LOAN-REC deduction. At run-post the
--                            rows book DR Salaries Payable / CR Employee
--                            loans receivable (per spec §13 GL map).
--
-- v1 simplifications:
--   * Flat-rate interest (not declining balance). interest =
--     principal × rate × tenure / 12 / 10000. EMI = (principal + interest)
--     / tenure. Remainder lands on the last installment.
--   * Only principal booked at disbursement. Interest recognised row-by-row
--     as EMIs are consumed — interest_income credited on each payroll post
--     alongside the principal reduction to the receivable.
--   * One loan type optional; freeform loans allowed.

CREATE TABLE IF NOT EXISTS loan_types (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                        varchar(32) NOT NULL,
  name                        varchar(128) NOT NULL,
  description                 text,
  max_amount_cents            bigint,
  default_interest_rate_bps   integer NOT NULL DEFAULT 0,
  default_tenure_months       integer NOT NULL DEFAULT 6,
  max_tenure_months           integer NOT NULL DEFAULT 60,
  is_interest_bearing         boolean NOT NULL DEFAULT false,
  is_active                   boolean NOT NULL DEFAULT true,
  is_system                   boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_user_id          uuid,
  deleted_at                  timestamptz,
  CONSTRAINT loan_types_rate_non_negative CHECK (default_interest_rate_bps >= 0),
  CONSTRAINT loan_types_tenure_positive CHECK (
    default_tenure_months > 0 AND max_tenure_months >= default_tenure_months
  ),
  CONSTRAINT loan_types_max_amount_non_negative CHECK (
    max_amount_cents IS NULL OR max_amount_cents >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS loan_types_tenant_code_unique
  ON loan_types(tenant_id, code)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS loan_types_tenant_active
  ON loan_types(tenant_id, is_active)
  WHERE deleted_at IS NULL;

ALTER TABLE loan_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loan_types_isolation ON loan_types;
CREATE POLICY loan_types_isolation ON loan_types
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());


CREATE TABLE IF NOT EXISTS employee_loans (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_number                 varchar(32),
  employee_id                 uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  loan_type_id                uuid REFERENCES loan_types(id) ON DELETE SET NULL,
  loan_type_name              varchar(128),
  -- Economics (captured at application time; frozen at disburse)
  principal_cents             bigint NOT NULL,
  interest_rate_bps           integer NOT NULL DEFAULT 0,
  tenure_months               integer NOT NULL,
  total_interest_cents        bigint NOT NULL DEFAULT 0,
  emi_cents                   bigint NOT NULL DEFAULT 0,
  first_installment_date      date,
  -- Lifecycle
  status                      varchar(16) NOT NULL DEFAULT 'draft',
  applied_at                  timestamptz NOT NULL DEFAULT now(),
  approved_at                 timestamptz,
  approved_by_user_id         uuid,
  disbursed_at                timestamptz,
  disbursed_by_user_id        uuid,
  disbursement_date           date,
  disbursement_account_id     uuid REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  disbursement_journal_id     uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  closed_at                   timestamptz,
  closed_reason               varchar(32),
  cancelled_at                timestamptz,
  cancelled_reason            text,
  -- Running totals, maintained as EMIs are consumed
  principal_outstanding_cents bigint NOT NULL DEFAULT 0,
  interest_outstanding_cents  bigint NOT NULL DEFAULT 0,
  principal_repaid_cents      bigint NOT NULL DEFAULT 0,
  interest_repaid_cents       bigint NOT NULL DEFAULT 0,
  written_off_cents           bigint NOT NULL DEFAULT 0,
  -- Freeform
  application_reason          text,
  approval_notes              text,
  notes                       text,
  -- Audit
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_user_id          uuid,
  deleted_at                  timestamptz,
  CONSTRAINT employee_loans_status_check CHECK (
    status IN ('draft','approved','disbursed','closed','written_off','cancelled')
  ),
  CONSTRAINT employee_loans_closed_reason_check CHECK (
    closed_reason IS NULL OR closed_reason IN ('fully_paid','early_settled','written_off')
  ),
  CONSTRAINT employee_loans_principal_positive CHECK (principal_cents > 0),
  CONSTRAINT employee_loans_tenure_positive CHECK (tenure_months > 0),
  CONSTRAINT employee_loans_rate_non_negative CHECK (interest_rate_bps >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_loans_tenant_number_unique
  ON employee_loans(tenant_id, loan_number)
  WHERE deleted_at IS NULL AND loan_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS employee_loans_tenant_employee
  ON employee_loans(tenant_id, employee_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS employee_loans_tenant_status
  ON employee_loans(tenant_id, status)
  WHERE deleted_at IS NULL;

ALTER TABLE employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_loans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_loans_isolation ON employee_loans;
CREATE POLICY employee_loans_isolation ON employee_loans
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());


CREATE TABLE IF NOT EXISTS employee_loan_schedule (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id                     uuid NOT NULL REFERENCES employee_loans(id) ON DELETE CASCADE,
  installment_no              integer NOT NULL,
  due_date                    date NOT NULL,
  principal_cents             bigint NOT NULL DEFAULT 0,
  interest_cents              bigint NOT NULL DEFAULT 0,
  total_cents                 bigint NOT NULL DEFAULT 0,
  opening_balance_cents       bigint NOT NULL DEFAULT 0,
  closing_balance_cents       bigint NOT NULL DEFAULT 0,
  status                      varchar(16) NOT NULL DEFAULT 'pending',
  -- Atomic claim: stamped when the row is consumed by a draft run. Any
  -- future void/cancel of the run MUST null these back out.
  applied_in_run_id           uuid REFERENCES payroll_runs(id) ON DELETE SET NULL,
  applied_run_line_id         uuid,
  applied_at                  timestamptz,
  waived_reason               text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_loan_schedule_status_check CHECK (
    status IN ('pending','paid','waived')
  ),
  CONSTRAINT employee_loan_schedule_total_check CHECK (
    total_cents = principal_cents + interest_cents
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_loan_schedule_loan_no_unique
  ON employee_loan_schedule(loan_id, installment_no);
CREATE INDEX IF NOT EXISTS employee_loan_schedule_unpaid
  ON employee_loan_schedule(tenant_id, loan_id, due_date)
  WHERE status = 'pending' AND applied_in_run_id IS NULL;

ALTER TABLE employee_loan_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_loan_schedule FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_loan_schedule_isolation ON employee_loan_schedule;
CREATE POLICY employee_loan_schedule_isolation ON employee_loan_schedule
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());


-- CoA backfill for existing tenants — seed-defaults gets the same rows
-- added inline below for freshly-signed-up tenants.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    -- Employee loans receivable (asset)
    IF NOT EXISTS (
      SELECT 1 FROM chart_of_accounts
      WHERE tenant_id = t.id AND account_subtype = 'loans_receivable' AND deleted_at IS NULL
    ) THEN
      INSERT INTO chart_of_accounts
        (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
      VALUES
        (t.id, '1150', 'Employee loans receivable', 'asset', 'loans_receivable', 'dr', true);
    END IF;
    -- Interest income (income)
    IF NOT EXISTS (
      SELECT 1 FROM chart_of_accounts
      WHERE tenant_id = t.id AND account_subtype = 'interest_income' AND deleted_at IS NULL
    ) THEN
      INSERT INTO chart_of_accounts
        (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
      VALUES
        (t.id, '4910', 'Interest income', 'income', 'interest_income', 'cr', true);
    END IF;
    -- Document sequence for loan numbers (LOAN-0001, year-scoped)
    IF to_regclass('public.document_sequences') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM document_sequences
        WHERE tenant_id = t.id AND sequence_name = 'staff_loan'
      )
    THEN
      INSERT INTO document_sequences (tenant_id, sequence_name, prefix, scope, pad_width)
      VALUES (t.id, 'staff_loan', 'LOAN', 'year', 4)
      ON CONFLICT DO NOTHING;
    END IF;
    -- Seed a compact SL loan-type library
    INSERT INTO loan_types
      (tenant_id, code, name, description,
       max_amount_cents, default_interest_rate_bps, default_tenure_months,
       max_tenure_months, is_interest_bearing, is_system)
    VALUES
      (t.id, 'FESTIVAL',  'Festival advance',
        'Avurudu / Christmas interest-free advance, recovered over a few months.',
        NULL, 0, 6, 12, false, true),
      (t.id, 'SALARY_ADV', 'Salary advance',
        'Mid-month advance, recovered next payroll.',
        NULL, 0, 1, 3, false, true),
      (t.id, 'EMERGENCY', 'Emergency loan',
        'Medical or funeral emergency, usually interest-free.',
        NULL, 0, 12, 24, false, true),
      (t.id, 'HOUSING',   'Housing loan',
        'Long-tenure housing assistance; interest bearing per tenant policy.',
        NULL, 1000, 60, 84, true, true),
      (t.id, 'VEHICLE',   'Vehicle loan',
        'Vehicle purchase assistance; interest bearing per tenant policy.',
        NULL, 1200, 36, 60, true, true)
    ON CONFLICT DO NOTHING;
  END LOOP;
  -- Clear session tenant so later statements don't leak a stale context
  PERFORM set_config('app.tenant_id', '', true);
END $$;


-- Keep seed-defaults in lockstep for brand new tenants. We splice the new
-- CoA rows, the loan sequence, and the loan-type library into the function
-- via a CREATE OR REPLACE — the body is copied from 07-seed-defaults.sql
-- and extended at the tail so this migration is self-contained.
--
-- Rather than re-define the whole function (which would break if it's
-- refactored elsewhere), we patch via a helper: after signup, call
-- seed_tenant_staff_loans() to layer on the loan-related defaults. The
-- signup endpoint is updated separately to invoke it.
CREATE OR REPLACE FUNCTION seed_tenant_staff_loans(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);

  IF NOT EXISTS (
    SELECT 1 FROM chart_of_accounts
    WHERE tenant_id = p_tenant_id AND account_subtype = 'loans_receivable' AND deleted_at IS NULL
  ) THEN
    INSERT INTO chart_of_accounts
      (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES
      (p_tenant_id, '1150', 'Employee loans receivable', 'asset', 'loans_receivable', 'dr', true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM chart_of_accounts
    WHERE tenant_id = p_tenant_id AND account_subtype = 'interest_income' AND deleted_at IS NULL
  ) THEN
    INSERT INTO chart_of_accounts
      (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES
      (p_tenant_id, '4910', 'Interest income', 'income', 'interest_income', 'cr', true);
  END IF;

  IF to_regclass('public.document_sequences') IS NOT NULL THEN
    INSERT INTO document_sequences (tenant_id, sequence_name, prefix, scope, pad_width)
    VALUES (p_tenant_id, 'staff_loan', 'LOAN', 'year', 4)
    ON CONFLICT (tenant_id, sequence_name) DO NOTHING;
  END IF;

  INSERT INTO loan_types
    (tenant_id, code, name, description,
     max_amount_cents, default_interest_rate_bps, default_tenure_months,
     max_tenure_months, is_interest_bearing, is_system)
  VALUES
    (p_tenant_id, 'FESTIVAL',  'Festival advance',
      'Avurudu / Christmas interest-free advance, recovered over a few months.',
      NULL, 0, 6, 12, false, true),
    (p_tenant_id, 'SALARY_ADV', 'Salary advance',
      'Mid-month advance, recovered next payroll.',
      NULL, 0, 1, 3, false, true),
    (p_tenant_id, 'EMERGENCY', 'Emergency loan',
      'Medical or funeral emergency, usually interest-free.',
      NULL, 0, 12, 24, false, true),
    (p_tenant_id, 'HOUSING',   'Housing loan',
      'Long-tenure housing assistance; interest bearing per tenant policy.',
      NULL, 1000, 60, 84, true, true),
    (p_tenant_id, 'VEHICLE',   'Vehicle loan',
      'Vehicle purchase assistance; interest bearing per tenant policy.',
      NULL, 1200, 36, 60, true, true)
  ON CONFLICT DO NOTHING;
END;
$$;

COMMENT ON TABLE loan_types IS
  'Tenant library of staff loan categories with defaults (amount cap, rate, tenure).';
COMMENT ON TABLE employee_loans IS
  'Staff loan header. Moves draft → approved → disbursed → closed. Disbursement posts JE and materializes the schedule.';
COMMENT ON TABLE employee_loan_schedule IS
  'EMI rows. Payroll compute claims unpaid rows with due_date ≤ period_end; at run-post book DR Salaries Payable / CR Employee loans receivable.';
