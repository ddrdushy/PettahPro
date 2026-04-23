-- Approval engine — purchase order routing (roadmap #43c, follow-up to
-- 66-approval-engine.sql / 67-approval-engine-expense-claims.sql /
-- 68-approval-engine-bills.sql).
--
-- Wires `purchase_orders` into the generic approval engine. POs had no
-- approval flow before — POST /purchase-orders/:id/send went straight
-- `draft → sent` and allocated the PO number. This migration is
-- additive:
--
--   · Adds a nullable FK `approval_request_id` on purchase_orders.
--     When set, the PO is engine-owned and sits in the new
--     `pending_approval` parking state until /approvals/:id/approve
--     drives it forward via finaliseApprovedDocument, which performs
--     the number allocation + flip to 'sent'.
--
--   · Widens `po_status_check` to admit the new `pending_approval`
--     value. Drop + re-add so the migration stays idempotent against
--     any previous shape.
--
--   · Nullable FK so tenants with no `document_type='purchase_order'`
--     policy configured keep the immediate draft → sent flow
--     unchanged. Both paths coexist.
--
-- The `firstPoFromSupplier` trigger rule introduced in the engine (see
-- apps/api/.../approval-engine.ts in this PR) is computed at request
-- time from existing purchase_orders rows — no schema change required.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS approval_request_id uuid NULL
    REFERENCES approval_requests(id) ON DELETE SET NULL;

-- Partial index keeps the cost near zero for tenants that never use
-- the engine path. Matches the pattern established in migrations 66
-- (journal_entry_drafts), 67 (expense_claims), and 68 (bills).
CREATE INDEX IF NOT EXISTS po_approval_request_idx
  ON purchase_orders (approval_request_id)
  WHERE approval_request_id IS NOT NULL;

-- Widen the status CHECK to admit the engine's parking state.
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS po_status_check;
ALTER TABLE purchase_orders
  ADD CONSTRAINT po_status_check CHECK (status IN (
    'draft','pending_approval','sent','acknowledged','cancelled','converted'
  ));
