-- Final settlement worksheet (payroll-module-spec §9, roadmap #11b)
--
-- When an employee exits, their exit date and last working day are already
-- captured by `POST /employees/:id/exit` (migration 42). That gives the next
-- payroll run enough to pro-rata the current month's salary — the piece
-- shipped in PR #41. This migration adds the *richer* settlement layer on
-- top:
--
--   · Leave encashment for unused paid-leave balance
--   · Gratuity (SL Payment of Gratuity Act — 14 days basic × completed years,
--     min 5 years of service)
--   · Notice pay-in-lieu (employer pays when terminating without notice) or
--     notice-short deduction (employee short-pays when resigning mid-notice)
--   · Outstanding staff-loan principal recovery in full
--   · Final PAYE reconciliation on the settlement month's taxable portion
--   · EPF/ETF on the final pay components (last wages)
--
-- Workflow mirrors payroll runs: draft → approved → posted (GL) → paid.
-- The compute function is pure and returns a worksheet the HR officer can
-- override per-line before approval — you can't always trust stored leave
-- balances or auto-computed gratuity to be exactly right, and getting this
-- wrong is a labour-tribunal risk. Approval locks the lines, posting writes
-- to GL and claims outstanding loan schedules, payment clears payables.
--
-- v1 simplifications (explicitly called out in the spec):
--   · Gratuity is treated as PAYE-exempt. The IRD gratuity rule (first LKR
--     300k exempt, balance taxed at 5% over 3 years) is nuanced and often
--     done outside payroll. HR can override via otherDeductionsCents if a
--     specific case needs it.
--   · Notice settlement uses the employee's snapshotted noticePeriodDays.
--     If HR wants a different figure for this exit, they override the
--     notice component cents on the worksheet.
--   · Leave encashment uses calendar-days divisor (basic ÷ 30). Consistent
--     with the no-pay leave and pro-rata math already in payroll-runs.ts.
--
-- Idempotent: every DDL uses IF NOT EXISTS / DROP...CREATE. Safe to re-run.

CREATE TABLE IF NOT EXISTS final_settlements (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  settlement_number           varchar(32),  -- allocated at post time, like payroll runs
  employee_id                 uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,

  -- Snapshot of employee state at settlement time. The live employees row
  -- may drift (re-hires, corrections) — this settlement is the source of
  -- truth for what was computed and paid.
  employee_code               varchar(32),
  employee_full_name          varchar(255) NOT NULL,
  designation                 varchar(128),
  department                  varchar(128),
  hire_date                   date NOT NULL,
  exit_date                   date NOT NULL,
  last_working_day            date NOT NULL,
  status_after                varchar(24) NOT NULL,  -- 'resigned'|'terminated'|'retired'|'deceased'
  basic_salary_cents          bigint NOT NULL,
  currency                    varchar(3) NOT NULL DEFAULT 'LKR',

  -- Tenure context. years_of_service is stored fractional (e.g. 7.42) so
  -- the gratuity compute has full precision; gratuity_years_completed is
  -- the integer floor used for the 14-days-per-year rule.
  years_of_service            numeric(6,2) NOT NULL DEFAULT 0,
  gratuity_years_completed    integer NOT NULL DEFAULT 0,

  -- Auto-computed components (may be overridden by HR on the worksheet
  -- before approval). Each is a gross cents amount on the employee's side.
  pro_rata_salary_cents       bigint NOT NULL DEFAULT 0,
  leave_encashment_days       numeric(8,2) NOT NULL DEFAULT 0,
  leave_encashment_cents      bigint NOT NULL DEFAULT 0,
  gratuity_cents              bigint NOT NULL DEFAULT 0,
  notice_pay_in_lieu_cents    bigint NOT NULL DEFAULT 0,  -- employer pays employee
  notice_shortfall_cents      bigint NOT NULL DEFAULT 0,  -- employee short-pays
  loan_principal_recovery_cents bigint NOT NULL DEFAULT 0,
  loan_interest_recovery_cents  bigint NOT NULL DEFAULT 0,
  other_earnings_cents        bigint NOT NULL DEFAULT 0,
  other_deductions_cents      bigint NOT NULL DEFAULT 0,

  -- Statutory on the settlement (computed from the taxable components —
  -- gratuity excluded by default per v1 simplification above).
  epf_employee_cents          bigint NOT NULL DEFAULT 0,
  epf_employer_cents          bigint NOT NULL DEFAULT 0,
  etf_employer_cents          bigint NOT NULL DEFAULT 0,
  paye_cents                  bigint NOT NULL DEFAULT 0,

  -- Derived totals (redundant but kept for reporting — cheaper than
  -- re-summing on every list query).
  gross_cents                 bigint NOT NULL DEFAULT 0,
  total_deductions_cents      bigint NOT NULL DEFAULT 0,
  net_payable_cents           bigint NOT NULL DEFAULT 0,

  -- JSON snapshot of the raw compute output — every line with label + cents
  -- + sign. Lets the worksheet UI render without recomputing from the
  -- column-flattened shape above.
  lines_snapshot              jsonb NOT NULL DEFAULT '[]',

  status                      varchar(16) NOT NULL DEFAULT 'draft',
    -- 'draft' | 'approved' | 'posted' | 'paid' | 'cancelled'
  notes                       text,

  -- Audit trail
  approved_at                 timestamptz,
  approved_by_user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  posted_at                   timestamptz,
  posted_by_user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  journal_entry_id            uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  paid_at                     timestamptz,
  paid_by_user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  payment_journal_id          uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  cancelled_at                timestamptz,
  cancelled_reason            text,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_user_id          uuid REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT final_settlements_status_check CHECK (
    status IN ('draft','approved','posted','paid','cancelled')
  ),
  CONSTRAINT final_settlements_status_after_check CHECK (
    status_after IN ('resigned','terminated','retired','deceased')
  ),
  -- LWD can never be after exit_date; enforced at API layer too but belt-
  -- and-braces keeps stale data out.
  CONSTRAINT final_settlements_lwd_before_exit CHECK (last_working_day <= exit_date)
);

-- Only one active (non-cancelled) settlement per employee. Re-hires + second
-- exits are rare enough we'll handle that by requiring cancellation of the
-- prior row first. Partial unique index makes the intent explicit.
CREATE UNIQUE INDEX IF NOT EXISTS final_settlements_employee_active
  ON final_settlements(tenant_id, employee_id)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS final_settlements_tenant_status_idx
  ON final_settlements(tenant_id, status);
CREATE INDEX IF NOT EXISTS final_settlements_tenant_exit_idx
  ON final_settlements(tenant_id, exit_date DESC);

ALTER TABLE final_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE final_settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS final_settlements_isolation ON final_settlements;
CREATE POLICY final_settlements_isolation ON final_settlements
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());


-- CoA backfill: gratuity expense + gratuity payable. New tenants get these
-- via the updated 07-seed-defaults.sql (patched below); existing tenants
-- get them via this DO block. Same pattern as 41-staff-loans.sql.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);

    -- Gratuity expense (expense/payroll_gratuity)
    IF NOT EXISTS (
      SELECT 1 FROM chart_of_accounts
      WHERE tenant_id = t.id AND account_subtype = 'payroll_gratuity' AND deleted_at IS NULL
    ) THEN
      INSERT INTO chart_of_accounts
        (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
      VALUES
        (t.id, '6003', 'Gratuity expense', 'expense', 'payroll_gratuity', 'dr', true);
    END IF;

    -- Gratuity payable (liability/gratuity). Credited at settlement-post
    -- and cleared when the lump sum disburses.
    IF NOT EXISTS (
      SELECT 1 FROM chart_of_accounts
      WHERE tenant_id = t.id AND account_subtype = 'gratuity_payable' AND deleted_at IS NULL
    ) THEN
      INSERT INTO chart_of_accounts
        (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
      VALUES
        (t.id, '2250', 'Gratuity payable', 'liability', 'gratuity_payable', 'cr', true);
    END IF;

    -- Document-number sequence for settlement numbers (FS-0001 year-scoped).
    IF to_regclass('public.document_sequences') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM document_sequences
        WHERE tenant_id = t.id AND sequence_name = 'final_settlement'
      )
    THEN
      INSERT INTO document_sequences (tenant_id, sequence_name, prefix, scope, pad_width)
      VALUES (t.id, 'final_settlement', 'FS', 'year', 4)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
