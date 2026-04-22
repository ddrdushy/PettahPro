-- Employee expense claims (payroll-module-spec §8, roadmap #14)
--
-- Employees incur reimbursable expenses on behalf of the business (travel,
-- meals, fuel, communication, misc). This module lets them submit claims
-- against a tenant-configured category library, routes through an approval
-- SOD check (approver ≠ submitter), and disburses either as a direct
-- reimbursement payment (book DR Expense / CR Bank immediately) or bundled
-- with the employee's next salary run.
--
-- v1 flow:
--   · Categories: tenant library mapping claim kind → expense GL account +
--     taxable flag. Seeded with five SL-typical defaults (travel, meal,
--     fuel, communication, misc).
--   · Claims: employee-scoped header. draft → submitted → approved |
--     rejected → paid (terminal). Rejection carries a reason and the
--     employee can clone-to-new for resubmission (handled in the API by
--     letting rejected claims transition back to draft via edit).
--   · Direct disbursement: on approve-and-pay the API books DR <category
--     account> / CR <bank / cash> and stamps paid_at + payment_journal_id.
--   · Payroll bundling: flagged claims left in status='approved' with
--     disbursement_method='payroll' get picked up by the next payroll
--     compute for that employee — compute stamps applied_in_run_id as part
--     of draft creation (same atomic-claim pattern used for staff loans
--     and final settlement) so two runs can't double-reimburse. The
--     payroll-side integration lands in a follow-up; this migration gets
--     the columns in place so the compute change is mechanical.
--
-- v2 follow-ups (deferred):
--   · Receipt attachments (needs attachment storage; spec #32)
--   · OCR auto-extract vendor/date/amount from receipt image
--   · Per-category approval caps + tiered approval (Supervisor → HR →
--     Owner) per §17.3 — for v1 a single approval step is enough
--   · YTD totals per employee on the claim list (easy once we have data)
--
-- Idempotent: every DDL uses IF NOT EXISTS / DROP...CREATE.

-- 1. Categories -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expense_categories (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                  varchar(32) NOT NULL,
  name                  varchar(128) NOT NULL,
  description           text,
  expense_account_id    uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_taxable            boolean NOT NULL DEFAULT false,
    -- If true and the claim is bundled with payroll, the reimbursement
    -- earning line counts toward EPF / ETF / PAYE. Most SL
    -- reimbursements are non-taxable (out-of-pocket recovery, not income).
  is_active             boolean NOT NULL DEFAULT true,
  is_system             boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at            timestamptz,

  CONSTRAINT expense_categories_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant
  ON expense_categories (tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_categories_isolation ON expense_categories;
CREATE POLICY expense_categories_isolation ON expense_categories
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());


-- 2. Claims -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expense_claims (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_number            varchar(32),  -- allocated at submit time via document_sequences
  employee_id             uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  category_id             uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  category_name           varchar(128),  -- snapshot for history if category later removed
  expense_account_id      uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
    -- Snapshot of the GL account to post against. Copied from the category
    -- at submit time so re-mapping the category later doesn't rewrite
    -- history for claims already paid.
  claim_date              date NOT NULL,         -- when the expense was incurred
  amount_cents            bigint NOT NULL,
  description             text,
  receipt_ref             text,                  -- optional URL / pointer for v1
  disbursement_method     varchar(16) NOT NULL DEFAULT 'direct',
    -- 'direct' = reimburse via one-off bank payment at approve time
    -- 'payroll' = bundle with next salary run
  is_taxable              boolean NOT NULL DEFAULT false,  -- snapshot of category flag

  status                  varchar(16) NOT NULL DEFAULT 'draft',
    -- 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid' | 'void'

  -- Approval
  submitted_at            timestamptz,
  submitted_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  approved_by_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  rejected_at             timestamptz,
  rejected_by_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason        text,

  -- Direct-pay path
  paid_at                 timestamptz,
  paid_by_user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  payment_account_id      uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  payment_journal_id      uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  payment_date            date,
  payment_reference       varchar(64),

  -- Payroll-bundling path (populated when the payroll run claims the row)
  applied_in_run_id       uuid,
  applied_in_run_line_id  uuid,
  applied_at              timestamptz,

  void_at                 timestamptz,
  void_reason             text,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at              timestamptz,

  CONSTRAINT expense_claims_status_check CHECK (
    status IN ('draft','submitted','approved','rejected','paid','void')
  ),
  CONSTRAINT expense_claims_disbursement_method_check CHECK (
    disbursement_method IN ('direct','payroll')
  ),
  CONSTRAINT expense_claims_amount_positive CHECK (amount_cents > 0)
);

CREATE INDEX IF NOT EXISTS idx_expense_claims_tenant_status
  ON expense_claims (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expense_claims_employee
  ON expense_claims (tenant_id, employee_id, claim_date DESC)
  WHERE deleted_at IS NULL;
-- Payroll compute's atomic-claim query hits this index. Partial on payroll-
-- method approved rows keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_expense_claims_payroll_pending
  ON expense_claims (tenant_id, employee_id)
  WHERE status = 'approved'
    AND disbursement_method = 'payroll'
    AND applied_in_run_id IS NULL
    AND deleted_at IS NULL;

ALTER TABLE expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_claims_isolation ON expense_claims;
CREATE POLICY expense_claims_isolation ON expense_claims
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());


-- 3. CoA backfill -----------------------------------------------------------
--
-- Five expense accounts mapped to the five default categories. Separate codes
-- so the GL breaks out reimbursements clearly (e.g. "Travel — reimbursed"
-- sits alongside "Travel — direct"). account_subtype='reimbursement' lets
-- reports filter them if they want.

DO $$
DECLARE
  t RECORD;
  travel_id uuid;
  meal_id uuid;
  fuel_id uuid;
  comm_id uuid;
  misc_id uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);

    -- 5210 Travel reimbursement
    SELECT id INTO travel_id FROM chart_of_accounts
      WHERE tenant_id = t.id AND code = '5210' AND deleted_at IS NULL;
    IF travel_id IS NULL THEN
      INSERT INTO chart_of_accounts
        (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
      VALUES
        (t.id, '5210', 'Travel reimbursement', 'expense', 'reimbursement', 'dr', true)
      RETURNING id INTO travel_id;
    END IF;

    -- 5220 Meals & entertainment reimbursement
    SELECT id INTO meal_id FROM chart_of_accounts
      WHERE tenant_id = t.id AND code = '5220' AND deleted_at IS NULL;
    IF meal_id IS NULL THEN
      INSERT INTO chart_of_accounts
        (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
      VALUES
        (t.id, '5220', 'Meals & entertainment reimbursement', 'expense', 'reimbursement', 'dr', true)
      RETURNING id INTO meal_id;
    END IF;

    -- 5230 Fuel & mileage reimbursement
    SELECT id INTO fuel_id FROM chart_of_accounts
      WHERE tenant_id = t.id AND code = '5230' AND deleted_at IS NULL;
    IF fuel_id IS NULL THEN
      INSERT INTO chart_of_accounts
        (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
      VALUES
        (t.id, '5230', 'Fuel & mileage reimbursement', 'expense', 'reimbursement', 'dr', true)
      RETURNING id INTO fuel_id;
    END IF;

    -- 5240 Communication reimbursement
    SELECT id INTO comm_id FROM chart_of_accounts
      WHERE tenant_id = t.id AND code = '5240' AND deleted_at IS NULL;
    IF comm_id IS NULL THEN
      INSERT INTO chart_of_accounts
        (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
      VALUES
        (t.id, '5240', 'Communication reimbursement', 'expense', 'reimbursement', 'dr', true)
      RETURNING id INTO comm_id;
    END IF;

    -- 5290 Other expense reimbursement
    SELECT id INTO misc_id FROM chart_of_accounts
      WHERE tenant_id = t.id AND code = '5290' AND deleted_at IS NULL;
    IF misc_id IS NULL THEN
      INSERT INTO chart_of_accounts
        (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
      VALUES
        (t.id, '5290', 'Other expense reimbursement', 'expense', 'reimbursement', 'dr', true)
      RETURNING id INTO misc_id;
    END IF;

    -- Category library seed. Codes are stable; tenants can rename/toggle
    -- active but can't change the code.
    INSERT INTO expense_categories (tenant_id, code, name, expense_account_id, is_taxable, is_system)
    VALUES
      (t.id, 'TRAVEL',        'Travel',                   travel_id, false, true),
      (t.id, 'MEAL',          'Meals & entertainment',    meal_id,   false, true),
      (t.id, 'FUEL',          'Fuel & mileage',           fuel_id,   false, true),
      (t.id, 'COMMUNICATION', 'Communication',            comm_id,   false, true),
      (t.id, 'MISC',          'Miscellaneous',            misc_id,   false, true)
    ON CONFLICT (tenant_id, code) DO NOTHING;

    -- Document-number sequence for claim numbers (EXP-YYYY-0001).
    IF to_regclass('public.document_sequences') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM document_sequences
        WHERE tenant_id = t.id AND sequence_name = 'expense_claim'
      )
    THEN
      INSERT INTO document_sequences (tenant_id, sequence_name, prefix, scope, pad_width)
      VALUES (t.id, 'expense_claim', 'EXP', 'year', 4)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
