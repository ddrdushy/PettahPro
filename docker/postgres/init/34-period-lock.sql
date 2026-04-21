-- Period lock: soft-close (month-end) and hard-close (year-end) state
-- machine on fiscal_periods, plus reason tracking for lock/unlock audit.
--
-- State machine:
--   open         → soft_closed (month-end review lock; admin can reopen)
--   open         → closed      (year-end hard lock; reopen requires approval)
--   soft_closed  → open        (reopen with reason)
--   soft_closed  → closed      (promote month-end lock to year-end lock)
--   closed       → open        (reopen with reason; increments reopened_count)
--
-- Both soft_closed and closed block new postings against that period.
-- Distinction is intentional: soft_closed is low-friction (click to unlock),
-- closed is ceremonial (requires reason + audit).

ALTER TABLE fiscal_periods
  ADD COLUMN IF NOT EXISTS last_reason text;
ALTER TABLE fiscal_periods
  ADD COLUMN IF NOT EXISTS reopened_count integer NOT NULL DEFAULT 0;
ALTER TABLE fiscal_periods
  ADD COLUMN IF NOT EXISTS closing_journal_entry_id uuid
    REFERENCES journal_entries(id) ON DELETE SET NULL;

-- Backfill periods for the next 24 months across all existing tenants so the
-- auto-lookup doesn't have to guess. Lazy create still handles edge cases.
INSERT INTO fiscal_periods (tenant_id, fiscal_year, period_no, starts_on, ends_on, status)
SELECT
  t.id AS tenant_id,
  EXTRACT(year FROM d)::smallint AS fiscal_year,
  EXTRACT(month FROM d)::smallint AS period_no,
  date_trunc('month', d)::date AS starts_on,
  (date_trunc('month', d) + interval '1 month' - interval '1 day')::date AS ends_on,
  'open'
FROM tenants t
CROSS JOIN generate_series(
  date_trunc('month', CURRENT_DATE - interval '12 months'),
  date_trunc('month', CURRENT_DATE + interval '12 months'),
  interval '1 month'
) AS d
ON CONFLICT (tenant_id, fiscal_year, period_no) DO NOTHING;
