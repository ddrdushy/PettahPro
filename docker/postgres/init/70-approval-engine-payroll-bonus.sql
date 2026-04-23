-- Approval engine — payroll run + bonus run routing (roadmap #43d,
-- follow-up to 66-approval-engine.sql / 67-expense-claims /
-- 68-bills / 69-purchase-orders).
--
-- Wires `payroll_runs` and `bonus_runs` into the generic approval
-- engine. Neither had any prior approval gating — /post went straight
-- from draft → posted. Per tenant-admin-ux-spec §7.1 payroll runs
-- "always → Owner" approval; bonus runs are threshold-gated (same
-- shape as bills). The domain routes consult
-- resolveApplicablePolicy at post time; matching policies park the
-- run in `pending_approval` and the /approvals queue drives the
-- actual flip to `posted` via finaliseApprovedDocument →
-- postPayrollRunCore / postBonusRunCore.
--
-- Additive — tenants without a policy configured keep the immediate
-- draft → posted flow unchanged. Both paths coexist.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.

-- Payroll runs ---------------------------------------------------------

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS approval_request_id uuid NULL
    REFERENCES approval_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payroll_runs_approval_request_idx
  ON payroll_runs (approval_request_id)
  WHERE approval_request_id IS NOT NULL;

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_status_check;
ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_status_check CHECK (status IN (
    'draft','pending_approval','posted','paid','void'
  ));

-- The existing partial unique index `payroll_runs_tenant_period_unique`
-- excludes voided rows. We want pending_approval rows to also count
-- toward "one live run per (tenant, year, month)" so rebuild it with
-- the same status filter extended — nothing else changes.
-- (No-op if the index already excludes void only; the new predicate is
-- equivalent semantically because pending_approval → posted is the only
-- path forward for a run, so a second live draft would still collide.)

-- Bonus runs -----------------------------------------------------------

ALTER TABLE bonus_runs
  ADD COLUMN IF NOT EXISTS approval_request_id uuid NULL
    REFERENCES approval_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bonus_runs_approval_request_idx
  ON bonus_runs (approval_request_id)
  WHERE approval_request_id IS NOT NULL;

ALTER TABLE bonus_runs DROP CONSTRAINT IF EXISTS bonus_runs_status_check;
ALTER TABLE bonus_runs
  ADD CONSTRAINT bonus_runs_status_check CHECK (status IN (
    'draft','pending_approval','posted','void'
  ));
