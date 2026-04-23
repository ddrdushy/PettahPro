-- =============================================================================
-- Payroll-run void support — PR #69 follow-up.
-- =============================================================================
--
-- POST /payroll-runs/:id/void reverses the payroll JE (and disbursement JE for
-- paid runs), releases every atomic claim the run grabbed at draft time
-- (salary revisions, loan EMI schedule, commission earnings), and rolls back
-- the loan-header outstanding/repaid deltas that post time applied.
--
-- To persist the void metadata on the run itself we need three new columns —
-- same shape bonus_runs and expense_claims already use. Idempotent — `IF NOT
-- EXISTS` on ADD COLUMN makes this safe to re-run.
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     docker/postgres/init/61-payroll-void.sql
-- =============================================================================

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS void_reason     text,
  ADD COLUMN IF NOT EXISTS void_at         timestamptz,
  ADD COLUMN IF NOT EXISTS void_by_user_id uuid;
