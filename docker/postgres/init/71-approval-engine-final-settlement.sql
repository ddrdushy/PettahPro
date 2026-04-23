-- Approval engine — final settlement routing (roadmap #43e,
-- follow-up to 66-approval-engine.sql / 67-expense-claims /
-- 68-bills / 69-purchase-orders / 70-payroll-bonus).
--
-- Wires `final_settlements` into the generic approval engine.
-- Settlement had a two-step lifecycle already (draft → approved →
-- posted → paid); the `/approve` flip was the sensitive gate. Per
-- tenant-admin-ux-spec §7.1 final settlements are "always →
-- Owner" approval — configure a policy with an empty triggerRule
-- to match every submission, no code change needed for the
-- always-approve semantics.
--
-- The domain `/approve` route now consults resolveApplicablePolicy
-- at call time; matching policies park the settlement in
-- `pending_approval` and the /approvals queue drives the actual
-- flip to `approved` via finaliseApprovedDocument →
-- approveFinalSettlementCore. Tenants with no policy keep the
-- immediate draft → approved flow unchanged.
--
-- Additive. Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF
-- NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.

ALTER TABLE final_settlements
  ADD COLUMN IF NOT EXISTS approval_request_id uuid NULL
    REFERENCES approval_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS final_settlements_approval_request_idx
  ON final_settlements (approval_request_id)
  WHERE approval_request_id IS NOT NULL;

ALTER TABLE final_settlements
  DROP CONSTRAINT IF EXISTS final_settlements_status_check;
ALTER TABLE final_settlements
  ADD CONSTRAINT final_settlements_status_check CHECK (status IN (
    'draft','pending_approval','approved','posted','paid','cancelled'
  ));
