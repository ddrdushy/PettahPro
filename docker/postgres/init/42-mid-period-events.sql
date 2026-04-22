-- Mid-period payroll events.
-- Per payroll-module-spec §14.1 (joiner) and §14.2 (leaver) and §14.3 (probation).
--
-- Adds:
--   · employees.confirmation_date    — when probation ended, if tracked
--   · employees.notice_period_days   — contractual notice (informational, default 30)
--   · employees.last_working_day     — may differ from exit_date (e.g. paid garden leave)
--   · payroll_run_lines.prorata_days_worked / prorata_days_in_period
--         — when the employee joined or left inside the run's period,
--           we store the denominator and numerator so the payslip can
--           explain why basic is scaled down (e.g. "16 of 30 days")
--
-- Compute rules (applied in apps/api/src/modules/hr/payroll-runs.ts):
--   · Eligible set now includes status in (active, confirmed, on_probation)
--     PLUS recently-exited employees whose exit_date falls inside the run
--     period — they still earn for days worked in this period.
--   · workedStart = max(periodStart, hire_date)
--     workedEnd   = min(periodEnd, COALESCE(last_working_day, exit_date, periodEnd))
--     If (workedEnd - workedStart + 1) < (periodEnd - periodStart + 1), all
--     earnings (basic + from_basic + percent_of_basic + fixed allowances)
--     scale by that ratio. Loan EMIs and other fixed-obligation deductions
--     remain unscaled.
--
-- Probation confirmation is handled with a simple status flip + date stamp —
-- no separate table, the immutable audit lives on status_changed_at and
-- status_change_reason the same way resign/terminate already does.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS confirmation_date  date,
  ADD COLUMN IF NOT EXISTS notice_period_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS last_working_day   date;

COMMENT ON COLUMN employees.confirmation_date IS 'Date probation ended. NULL for employees who started confirmed or are still on probation.';
COMMENT ON COLUMN employees.notice_period_days IS 'Contractual notice period in days. Informational for now; surfaces in final-settlement computation.';
COMMENT ON COLUMN employees.last_working_day IS 'Actual last day physically worked. May precede exit_date on garden leave.';

ALTER TABLE payroll_run_lines
  ADD COLUMN IF NOT EXISTS prorata_days_worked    integer,
  ADD COLUMN IF NOT EXISTS prorata_days_in_period integer;

COMMENT ON COLUMN payroll_run_lines.prorata_days_worked IS 'Days the employee was active in this run period. Set only when < prorata_days_in_period (i.e. mid-period joiner or leaver).';
COMMENT ON COLUMN payroll_run_lines.prorata_days_in_period IS 'Calendar days in the run period. Pair with prorata_days_worked for the "N of M days" payslip chip.';
