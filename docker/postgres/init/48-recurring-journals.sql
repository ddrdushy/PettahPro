-- Recurring journal templates — accrual / amortization automation that
-- completes the recurring trio (invoices → AR, bills → AP, journals → GL).
--
-- Use cases that keep coming up in SL SME audits:
--   · Monthly rent accrual (DR Rent expense / CR Rent payable)
--   · Prepaid insurance amortization (DR Insurance expense / CR Prepaid insurance) for 12 months
--   · Prepaid software subscription spread over the licence term
--   · Deferred revenue recognition (DR Deferred revenue / CR Service income) monthly
--   · Interest accruals on loans between owner companies
--   · Inter-company management fees booked monthly
--
-- Why a separate template rather than "duplicate last journal": same reason
-- as recurring_bills — once someone edits a copy the next copy inherits the
-- edit. The template is a stable source of truth.
--
-- Auto-post vs review-queue
-- -------------------------
-- Each template carries an `auto_post` flag. When due:
--   auto_post = true  → worker calls postJournal() directly, the JE lands
--                       posted in GL with source_type='recurring_journal'.
--                       For mechanical accruals a seasoned accountant is
--                       happy to trust (e.g. monthly rent of a fixed amount).
--   auto_post = false → worker drops a row into journal_entry_drafts with
--                       status 'pending_approval'. Same queue as manual JE
--                       approvals. Used for anything a second pair of eyes
--                       should review before GL.
--
-- Frequency is 'monthly' in v1. Adding weekly / quarterly / annual later is
-- a worker-only change — computeNextRunDate in TS decides how the date walks.

CREATE TABLE IF NOT EXISTS recurring_journals (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  schedule_name          varchar(200) NOT NULL,
  frequency              varchar(16) NOT NULL DEFAULT 'monthly',  -- monthly (v1)
  day_of_month           smallint NOT NULL DEFAULT 1,             -- 1..28 clamp on UI
  start_date             date NOT NULL,
  end_date               date,
  next_run_date          date NOT NULL,
  last_run_date          date,
  -- When true, generated JE is posted immediately via postJournal() (same
  -- code path + period-lock enforcement as manual posting). When false, a
  -- row is parked in journal_entry_drafts for approver review.
  auto_post              boolean NOT NULL DEFAULT false,
  memo_template          varchar(500),
  notes                  text,
  is_active              boolean NOT NULL DEFAULT true,
  paused_at              timestamptz,
  generated_count        integer NOT NULL DEFAULT 0,
  -- For auto_post=true: set to the posted journal_entries.id. For
  -- auto_post=false: set to the journal_entry_drafts.id. Different tables
  -- so we track both loosely — no FK, nulled at delete time.
  last_generated_entry_id uuid,
  last_generated_draft_id uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by_user_id     uuid,
  deleted_at             timestamptz
);

CREATE INDEX IF NOT EXISTS recurring_journals_tenant_active_next
  ON recurring_journals(tenant_id, is_active, next_run_date)
  WHERE deleted_at IS NULL;

ALTER TABLE recurring_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_journals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recurring_journals_isolation ON recurring_journals;
CREATE POLICY recurring_journals_isolation ON recurring_journals
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Template lines — mirrors journal_lines but with template-time fields only.
-- Amounts stored as fixed dr_cents / cr_cents rather than a formula — v1
-- only handles fixed-amount recurring entries (which covers 90%+ of real
-- accruals). If we add variable amount support later (e.g. "interest on
-- current loan balance"), add a compute_kind column + expression.
CREATE TABLE IF NOT EXISTS recurring_journal_lines (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recurring_journal_id  uuid NOT NULL REFERENCES recurring_journals(id) ON DELETE CASCADE,
  line_no               smallint NOT NULL,
  account_id            uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  dr_cents              bigint NOT NULL DEFAULT 0,
  cr_cents              bigint NOT NULL DEFAULT 0,
  description           varchar(500),
  customer_id           uuid REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id           uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- A line has either a debit or a credit, not both, and not zero. Matches
  -- the check in journal_entries.ts Zod schema but enforced at the DB too.
  CONSTRAINT recurring_journal_lines_dr_xor_cr CHECK (
    (dr_cents > 0 AND cr_cents = 0) OR
    (cr_cents > 0 AND dr_cents = 0)
  )
);

CREATE INDEX IF NOT EXISTS recurring_journal_lines_header
  ON recurring_journal_lines(recurring_journal_id, line_no);

ALTER TABLE recurring_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_journal_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recurring_journal_lines_isolation ON recurring_journal_lines;
CREATE POLICY recurring_journal_lines_isolation ON recurring_journal_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Cross-tenant helper for the worker cron. SECURITY DEFINER runs as the
-- function owner (superuser), bypassing RLS, so the worker can see every
-- tenant's due rows without a tenant context. Same shape as
-- list_due_recurring_bills / list_due_recurring_invoices.
CREATE OR REPLACE FUNCTION list_due_recurring_journals(as_of date)
RETURNS TABLE(id uuid, tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT r.id, r.tenant_id
    FROM recurring_journals r
   WHERE r.is_active = true
     AND r.deleted_at IS NULL
     AND r.next_run_date <= as_of
     AND (r.end_date IS NULL OR r.end_date >= as_of);
$$;

-- 44-auth-helpers.sql sets ALTER DEFAULT PRIVILEGES so any function created
-- after it automatically gets EXECUTE granted to pettahpro_app. No explicit
-- GRANT needed here.
