-- Document attachments (roadmap #32)
--
-- Generic file-attachment store shared across every transactional
-- document type (invoice, sales order, quotation, credit note, bill,
-- purchase order, purchase requisition, GRN, expense claim, payment,
-- receipt, final settlement, journal entry). One table keeps the
-- feature truly cross-module — any future document type just needs
-- to allow-list into the `entity_type` CHECK.
--
-- Files live in an S3-compatible object store (MinIO in dev / prod per
-- our self-hosted preference) under a tenant-prefixed key so a bucket
-- policy bug can't cross tenants. Rows here are the metadata +
-- retention record; actual bytes are off-database.
--
-- Retention: default 7 years from upload (LKR Inland Revenue and SL
-- Companies Act both default to 6; we pad to 7 so an auditor asking
-- a week before the 6-year mark still finds the file). `deleted_at`
-- is a soft-delete for the UI — we do NOT evict S3 on soft-delete;
-- the eviction cron (v2) only hard-deletes rows where
-- `deleted_at IS NOT NULL AND retention_until < now()`. Until that
-- cron lands, soft-deleted rows keep their bytes indefinitely — an
-- audit-safe default.
--
-- Idempotent: every DDL uses IF NOT EXISTS / DROP-if-exists so the
-- file can be re-run without error.

CREATE TABLE IF NOT EXISTS document_attachments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type           text NOT NULL,
  entity_id             uuid NOT NULL,
  file_name             text NOT NULL,
  content_type          text NOT NULL,
  size_bytes            bigint NOT NULL,
  -- Object-store key. Shape: `<tenant_id>/<entity_type>/<entity_id>/<uuid>-<sanitized_filename>`.
  -- Tenant-prefix is the belt: even if bucket ACLs are misconfigured
  -- the key namespace prevents a cross-tenant collision.
  storage_key           text NOT NULL,
  -- Optional SHA-256 hex digest of the bytes, captured server-side at
  -- upload. Used for dedup checks and integrity verification on
  -- download. Nullable because we don't want to fail uploads if the
  -- hasher errors — metadata is the primary concern, checksum is a
  -- bonus.
  sha256                text,
  uploaded_by_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at           timestamptz NOT NULL DEFAULT now(),
  retention_until       timestamptz NOT NULL DEFAULT (now() + interval '7 years'),
  -- Soft delete — the row (and bytes) stay until retention_until
  -- passes and the eviction cron purges them. Prevents a malicious
  -- tenant user from shredding audit evidence.
  deleted_at            timestamptz,
  deleted_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT document_attachments_size_positive CHECK (size_bytes > 0),
  CONSTRAINT document_attachments_size_cap CHECK (size_bytes <= 10485760)
);

-- Entity type allow-list. Kept as a separate DROP/ADD so we can
-- extend the list in a later migration without having to rewrite the
-- table definition.
ALTER TABLE document_attachments
  DROP CONSTRAINT IF EXISTS document_attachments_entity_type_check;
ALTER TABLE document_attachments
  ADD CONSTRAINT document_attachments_entity_type_check CHECK (
    entity_type IN (
      'invoice',
      'sales_order',
      'quotation',
      'credit_note',
      'bill',
      'purchase_order',
      'purchase_requisition',
      'goods_received_note',
      'expense_claim',
      'payment',
      'receipt',
      'final_settlement',
      'journal_entry'
    )
  );

-- storage_key is globally unique so a re-upload with the same UUID
-- suffix (astronomically unlikely but finite) can't collide.
CREATE UNIQUE INDEX IF NOT EXISTS document_attachments_storage_key_unique
  ON document_attachments(storage_key);

-- Primary access pattern: list attachments for a given entity on its
-- detail page. Excludes soft-deleted rows from the index so the
-- common list query stays small even in tenants with years of churn.
CREATE INDEX IF NOT EXISTS document_attachments_entity_idx
  ON document_attachments(tenant_id, entity_type, entity_id)
  WHERE deleted_at IS NULL;

-- Secondary access pattern: tenant-wide recent-uploads view (for a
-- potential admin "recent files" surface). Also supports the
-- retention-eviction cron's sweep by uploaded_at order.
CREATE INDEX IF NOT EXISTS document_attachments_tenant_uploaded_idx
  ON document_attachments(tenant_id, uploaded_at DESC);

-- Retention-eviction sweep index — lets the future cron find
-- candidate rows (soft-deleted AND past retention) cheaply.
CREATE INDEX IF NOT EXISTS document_attachments_retention_idx
  ON document_attachments(retention_until)
  WHERE deleted_at IS NOT NULL;

ALTER TABLE document_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_attachments_tenant_isolation ON document_attachments;
CREATE POLICY document_attachments_tenant_isolation ON document_attachments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
