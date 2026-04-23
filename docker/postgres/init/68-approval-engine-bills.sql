-- Approval engine — bill routing (roadmap #43b, follow-up to
-- 66-approval-engine.sql + 67-approval-engine-expense-claims.sql).
--
-- Wires `bills` into the generic approval engine. Bills previously
-- had NO approval flow at all — they went straight `draft → posted`
-- on `POST /bills/:id/post`. This migration is additive:
--
--   · Adds a nullable FK column `approval_request_id` on bills.
--     When set, the bill is engine-owned and sits in the new
--     `pending_approval` state until `/approvals/:id/approve`
--     drives it forward via finaliseApprovedDocument.
--
--   · Extends the bills_status_check CHECK constraint to accept
--     `pending_approval`. This is the only state the engine path
--     parks in before the approver drives it to posted.
--
--   · Nullable FK so tenants with no `document_type='bill'` policy
--     keep the immediate draft → posted path unchanged. Both paths
--     coexist.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Constraint swap uses DROP IF EXISTS + ADD so re-running is safe.

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS approval_request_id uuid NULL
    REFERENCES approval_requests(id) ON DELETE SET NULL;

-- Partial index keeps the cost near zero for tenants that never use
-- the engine path. Matches the pattern established in migrations 66
-- (journal_entry_drafts) and 67 (expense_claims).
CREATE INDEX IF NOT EXISTS bills_approval_request_idx
  ON bills (approval_request_id)
  WHERE approval_request_id IS NOT NULL;

-- Widen the status CHECK to admit the engine's parking state. Drop +
-- re-add so the migration is idempotent against any previous shape.
ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_status_check;
ALTER TABLE bills
  ADD CONSTRAINT bills_status_check
    CHECK (status IN ('draft','pending_approval','posted','partially_paid','paid','void'));
