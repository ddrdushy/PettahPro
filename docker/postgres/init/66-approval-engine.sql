-- Approval engine core — roadmap #43.
--
-- Consumes the `approval_policies` table shipped in PR #63 (#26). Before
-- this migration, policies were storage-only — no code path read them.
-- This migration adds the runtime tables the engine needs to track an
-- individual submission's progress through a policy's ordered steps.
--
-- Two-table shape:
--
--   approval_requests — one row per submission. Carries the document
--   reference, the snapshotted policy id, submitter, overall status
--   (pending | approved | rejected | cancelled), current step index,
--   and terminal metadata (decided_at, decided_by).
--
--   approval_request_steps — one row per step from the policy, cloned
--   at creation time so later edits to the policy don't reshape an
--   in-flight request. Tracks the decision, decider, reason, and the
--   approver set copied from the policy step (shape
--   { approvers: [{kind, id, label?}], anyOf }).
--
-- "Snapshot on create" is the critical design choice: if an admin
-- edits a policy to relax its approvers while a request is mid-flight,
-- that change must not retroactively loosen the request's approvers.
-- Policies can evolve freely; in-flight requests remain bound to the
-- rules in effect at submit time.
--
-- SOD (segregation of duties): enforced in the app layer, not here —
-- the approver list for a step is checked against the decider's user
-- id + role memberships. The engine also refuses a decision from the
-- submitter (approver ≠ submitter) regardless of what the approver
-- list says; this matches the existing JE approval semantics.
--
-- Linkage back to domain tables:
--
--   journal_entry_drafts.approval_request_id — nullable FK added here.
--   When a draft is created via the engine path, this points at the
--   request. When created via the legacy flat-threshold path (tenants
--   who haven't designed a policy yet), this stays null. Both paths
--   coexist until every tenant has migrated; the approve route
--   handles either.
--
-- Indexing: the hot queries are
--   (a) "my pending approvals" — scan by approver identity within
--       pending requests. Hit via approval_request_steps filtering
--       step_idx=current_step_idx AND status='pending'.
--   (b) "policies for this document_type" — covered by the existing
--       approval_policies_tenant_idx.
-- No partial index on the request is needed beyond the tenant+status
-- fan.

-- =============================================================================
-- approval_requests
-- =============================================================================

CREATE TABLE IF NOT EXISTS approval_requests (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- What document triggered this request. document_type mirrors the
  -- `approval_policies.document_type` enum-in-varchar
  -- (journal_entry | expense_claim | bill | purchase_order | payroll_run
  --  | bonus_run | final_settlement | invoice). document_id references
  -- the domain row — NOT a FK because each domain has its own table
  -- and we want one engine across all of them.
  document_type          varchar(64) NOT NULL,
  document_id            uuid NOT NULL,

  -- Amount at submit-time (cents). Snapshotted so threshold rules stay
  -- honest even if the draft is later edited. Nullable because some
  -- document types don't have a meaningful amount (e.g. user role
  -- change in a future wiring).
  amount_cents           bigint NULL,

  -- Policy that matched at submit time. Nullable so that
  --   (a) requests created by the legacy threshold path can still
  --       land here if we ever decide to backfill, and
  --   (b) a "no policy matched but admin forced approval" flow is
  --       possible later.
  policy_id              uuid NULL REFERENCES approval_policies(id) ON DELETE SET NULL,

  submitter_user_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Overall request status. Moves monotonically:
  --   pending → approved  (all steps approved)
  --   pending → rejected  (any step rejected — no multi-step override)
  --   pending → cancelled (submitter withdrew before final decision)
  status                 varchar(16) NOT NULL DEFAULT 'pending',

  -- 0-based index of the step currently waiting on a decision. Advances
  -- by 1 on each approve; frozen on reject / cancelled. On approved it
  -- equals steps_total (one past the last step).
  current_step_idx       integer NOT NULL DEFAULT 0,
  steps_total            integer NOT NULL,

  -- Terminal metadata. decided_by_user_id records the actor of the
  -- final approve/reject (not intermediate approvers). decision_reason
  -- is the optional note on the final action.
  decided_at             timestamptz NULL,
  decided_by_user_id     uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  decision_reason        text NULL,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT approval_requests_status_check
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  CONSTRAINT approval_requests_step_idx_check
    CHECK (current_step_idx >= 0 AND current_step_idx <= steps_total),
  -- Prevent two open requests against the same document (idempotence +
  -- guards against double-submit). Enforced as a partial unique index
  -- rather than a constraint so cancelled/rejected requests can be
  -- retried with a fresh submission.
  CONSTRAINT approval_requests_steps_total_positive
    CHECK (steps_total > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_open_document_unique
  ON approval_requests (tenant_id, document_type, document_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS approval_requests_tenant_status
  ON approval_requests (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS approval_requests_submitter
  ON approval_requests (tenant_id, submitter_user_id, created_at DESC);

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_requests_rw ON approval_requests;
CREATE POLICY approval_requests_rw ON approval_requests
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- updated_at trigger. Module-local helper — matches the per-module
-- pattern used elsewhere (commissions, item_categories, etc.).
CREATE OR REPLACE FUNCTION approval_requests_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_requests_updated_at ON approval_requests;
CREATE TRIGGER trg_approval_requests_updated_at
  BEFORE UPDATE ON approval_requests
  FOR EACH ROW
  EXECUTE FUNCTION approval_requests_set_updated_at();

-- =============================================================================
-- approval_request_steps
-- =============================================================================

CREATE TABLE IF NOT EXISTS approval_request_steps (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id        uuid NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,

  -- 0-based index; matches approval_requests.current_step_idx.
  step_idx          integer NOT NULL,

  -- Approvers + anyOf cloned from the policy step at request creation.
  -- Shape: { approvers: [{ kind: "role"|"user", id: string, label?: string }],
  --          anyOf: boolean }.
  -- Kept JSON rather than normalized into rows because the list is
  -- short (cap 10 per step), rarely queried by index, and the shape
  -- mirrors what approval_policies.steps stored.
  approvers         jsonb NOT NULL,
  any_of            boolean NOT NULL DEFAULT true,

  status            varchar(16) NOT NULL DEFAULT 'pending',
  decision          varchar(16) NULL,
  decided_at        timestamptz NULL,
  decided_by_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  decision_reason   text NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT approval_request_steps_status_check
    CHECK (status IN ('pending','approved','rejected','skipped')),
  CONSTRAINT approval_request_steps_decision_check
    CHECK (decision IS NULL OR decision IN ('approve','reject'))
);

CREATE UNIQUE INDEX IF NOT EXISTS approval_request_steps_request_idx_unique
  ON approval_request_steps (request_id, step_idx);

CREATE INDEX IF NOT EXISTS approval_request_steps_tenant_status
  ON approval_request_steps (tenant_id, status)
  WHERE status = 'pending';

ALTER TABLE approval_request_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_request_steps FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_request_steps_rw ON approval_request_steps;
CREATE POLICY approval_request_steps_rw ON approval_request_steps
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE OR REPLACE FUNCTION approval_request_steps_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_request_steps_updated_at ON approval_request_steps;
CREATE TRIGGER trg_approval_request_steps_updated_at
  BEFORE UPDATE ON approval_request_steps
  FOR EACH ROW
  EXECUTE FUNCTION approval_request_steps_set_updated_at();

-- =============================================================================
-- Linkage back to journal_entry_drafts (JE is the first domain wired).
--
-- approval_request_id is nullable so the legacy threshold-only path
-- (tenants with no JE policy configured) still works unchanged. When
-- set, the approve-draft route also drives the engine state forward
-- (via the API layer — no DB trigger, the JE draft table isn't the
-- right place to embed engine logic).
-- =============================================================================

ALTER TABLE journal_entry_drafts
  ADD COLUMN IF NOT EXISTS approval_request_id uuid NULL
    REFERENCES approval_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS je_drafts_approval_request_idx
  ON journal_entry_drafts (approval_request_id)
  WHERE approval_request_id IS NOT NULL;

-- =============================================================================
-- Seed the new `approval.decide` permission into existing system roles
-- so tenants that already exist (pre-#43) pick it up without a manual
-- step. Targets Owner, Admin, and Accountant — the three roles that
-- already carry approval-adjacent permissions (accounting.manage,
-- payments.manage). Sales and Read-only are intentionally excluded.
--
-- New tenants seeded AFTER this migration pick up the key from the
-- updated seed_admin_role_templates_for_tenant() in 55-tenant-admin.sql.
-- Idempotent: jsonb || jsonb replaces the key in place.
-- =============================================================================

UPDATE roles
   SET permissions = permissions || jsonb_build_object('approval.decide', true)
 WHERE is_system = true
   AND deleted_at IS NULL
   AND name IN ('Owner', 'Admin', 'Accountant')
   AND COALESCE(permissions ->> 'approval.decide', 'false') <> 'true';
