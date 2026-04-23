-- Approval engine — expense claim routing (roadmap #43a, follow-up to
-- 66-approval-engine.sql / PR #74).
--
-- Wires `expense_claims` into the generic approval engine. Same pattern
-- as the JE linkage shipped in #43:
--
--   · Adds a nullable FK column `approval_request_id` on expense_claims.
--     When set, the claim is owned by the engine — the legacy approve /
--     approve-and-pay / reject routes refuse to act on it (409
--     ENGINE_OWNED) and the decision lands through /approvals/:id/…
--     instead.
--
--   · Nullable so tenants with no `document_type='expense_claim'`
--     policy configured keep the existing flat submit → approve flow
--     (the one already enforced by submittedByUserId ≠ ctx.userId).
--     Both paths coexist; the engine path is opt-in per tenant.
--
-- No changes needed to the approval_requests / approval_request_steps
-- tables themselves — document_type is already a free-form varchar
-- (approval_requests.document_type) and the engine already accepts
-- 'expense_claim' in ApprovalDocumentType (apps/api approval-engine.ts).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE expense_claims
  ADD COLUMN IF NOT EXISTS approval_request_id uuid NULL
    REFERENCES approval_requests(id) ON DELETE SET NULL;

-- Partial index keeps the cost near zero for tenants that never use
-- the engine path. Matches the je_drafts_approval_request_idx shape in
-- 66-approval-engine.sql.
CREATE INDEX IF NOT EXISTS expense_claims_approval_request_idx
  ON expense_claims (approval_request_id)
  WHERE approval_request_id IS NOT NULL;
