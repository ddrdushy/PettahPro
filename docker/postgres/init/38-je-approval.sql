-- Journal entry approval workflow.
-- SL audit norm: manual JEs above a tenant-set threshold require a second
-- approver before posting to GL. Drafts sit in a pending queue until
-- approved (posted to journals) or rejected (shelved with reason).
--
-- Payload stored as JSONB so we don't need a mirror draft_lines table —
-- the payload carries the exact lines that will be handed to postJournal
-- on approval.

CREATE TABLE IF NOT EXISTS journal_entry_drafts (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_date                date NOT NULL,
  memo                      text,
  total_cents               bigint NOT NULL,
  payload                   jsonb NOT NULL,                   -- { lines: [{accountId, drCents, crCents, description, customerId, supplierId}] }
  status                    varchar(16) NOT NULL DEFAULT 'pending_approval',
  created_by_user_id        uuid,
  approved_by_user_id       uuid,
  approved_at               timestamptz,
  rejected_by_user_id       uuid,
  rejected_at               timestamptz,
  rejection_reason          text,
  posted_journal_entry_id   uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT je_draft_status_check CHECK (status IN ('pending_approval','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS je_drafts_tenant_status
  ON journal_entry_drafts(tenant_id, status, created_at DESC);

ALTER TABLE journal_entry_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS je_drafts_tenant_isolation ON journal_entry_drafts;
CREATE POLICY je_drafts_tenant_isolation ON journal_entry_drafts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
