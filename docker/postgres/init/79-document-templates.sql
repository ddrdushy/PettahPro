-- Document templates (roadmap #33)
--
-- Tenant-scoped, per-doc-type layout records used by the PDF renderer
-- to drive what each printed document looks like. Ships as the final
-- Nice-to-have after batch/serial/expiry tracking (#34); together with
-- the MinIO client from #32 (for logo uploads, v2 follow-up) this is
-- the groundwork for the drag-drop layout builder called out in
-- sell-spec §19 and buy-spec §20.
--
-- One row per (tenant, doc_type, language, version). The layout itself
-- is an opaque JSONB blob — the engine on the web side walks the JSON
-- and emits react-pdf primitives, so schema changes don't require a
-- migration; the renderer is the source of truth for the JSON shape.
--
-- Multi-language: matches the notification_templates pattern — one
-- row per language. The tenant admin UI groups rows of the same
-- `library_key` as variants of "the same template".
--
-- Template library: for v1 we ship the library as a hard-coded TS
-- module on the API side (apps/api/src/modules/operations/template-library.ts).
-- `POST /document-templates/clone-library { libraryKey, language }`
-- copies a library layout into a tenant-owned row. `library_key` is
-- preserved so the UI can surface "based on X" and a future sync
-- could detect library revisions. This keeps the DB simple — no
-- separate platform-library table, no nullable tenant_id, no RLS
-- gymnastics. Rows are always tenant-scoped.
--
-- Defaults: at most one `is_default = true` row per
-- (tenant_id, doc_type, language) among live rows. Enforced by
-- partial unique index. The render route for a doc type picks the
-- default for the customer / supplier's language (falls back to 'en',
-- falls back further to hard-coded React component if no template
-- exists — a tenant that never touches this feature still prints
-- exactly what they did before #33 landed).
--
-- Version control (spec §19.1 "saved versions, rollback"): each save
-- bumps `version`. Old versions stay as `status = 'archived'`; the
-- live one is `status = 'published'` (or `'draft'` while being
-- edited). The UI shows the archive list and offers "restore" = clone
-- an archived row to a new published version.
--
-- Idempotent: every DDL is IF NOT EXISTS / DROP-if-exists / ADD
-- CONSTRAINT after DROP.

CREATE TABLE IF NOT EXISTS document_templates (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- What this template renders. Matches the web renderer's
  -- supported contexts. Invoice is the v1 target; the rest of the
  -- allow-list is here so follow-up PRs migrating each PDF don't
  -- need another DDL round-trip.
  doc_type              varchar(40) NOT NULL,
  -- ISO 639-1 code. 'en' / 'ta' / 'si' for v1 matching the three
  -- languages we already localize notifications for. No CHECK — let
  -- other languages slip in as the market grows, the UI is the
  -- gatekeeper.
  language              varchar(5) NOT NULL DEFAULT 'en',
  name                  varchar(200) NOT NULL,
  description           text,
  -- Opaque layout JSON. Shape is defined + versioned by the renderer
  -- (apps/web/lib/template-renderer.tsx). Rough shape:
  --   {
  --     pageSize: 'a4' | 'a5' | 'thermal_80' | 'thermal_58',
  --     theme: { accentColor, fontFamily, ... },
  --     sections: [ { type: 'header', ... }, ... ]
  --   }
  -- Stored as JSONB so per-tenant render queries can poke at a
  -- section without deserialising the whole blob.
  layout_json           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Version bumps on every edit. A family of versions shares
  -- `library_key` + (tenant_id, doc_type, language); the UI shows
  -- them as a history list. Surfaced separately from `status` so
  -- a published-and-archived row keeps its version number for
  -- rollback.
  version               integer NOT NULL DEFAULT 1,
  -- 'draft' — being edited, not used by render routes
  -- 'published' — live; picked by render routes via is_default
  -- 'archived' — historical, kept for rollback
  status                varchar(16) NOT NULL DEFAULT 'draft',
  is_default            boolean NOT NULL DEFAULT false,
  -- Populated when the row was cloned from a library template
  -- (POST /document-templates/clone-library). Null for from-scratch
  -- customs. Used by the UI to label "based on: Classic Invoice"
  -- and will be the hook for a future "library updated — re-sync?"
  -- flow.
  library_key           varchar(80),
  created_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT document_templates_version_positive CHECK (version >= 1)
);

-- Allow-list of doc types covered by this table. Aligned with the
-- PDF components under apps/web/lib/*-pdf.tsx so the renderer has a
-- known universe to dispatch on. Extended in follow-up PRs as each
-- doc type migrates to template-driven rendering.
ALTER TABLE document_templates
  DROP CONSTRAINT IF EXISTS document_templates_doc_type_check;
ALTER TABLE document_templates
  ADD CONSTRAINT document_templates_doc_type_check CHECK (
    doc_type IN (
      'invoice',
      'quotation',
      'credit_note',
      'debit_note',
      'delivery_note',
      'proforma_invoice',
      'bill',
      'purchase_order',
      'goods_received_note',
      'stock_transfer',
      'payslip',
      'settlement_letter'
    )
  );

ALTER TABLE document_templates
  DROP CONSTRAINT IF EXISTS document_templates_status_check;
ALTER TABLE document_templates
  ADD CONSTRAINT document_templates_status_check CHECK (
    status IN ('draft', 'published', 'archived')
  );

-- At most one default per (tenant, doc_type, language). Partial so
-- archived rows that used to be default don't block a new one.
-- Soft-deleted rows also excluded.
CREATE UNIQUE INDEX IF NOT EXISTS document_templates_one_default_idx
  ON document_templates(tenant_id, doc_type, language)
  WHERE is_default = true AND deleted_at IS NULL;

-- Primary lookup: render route asks for (tenant, doc_type, language)
-- live templates. Published-first ordering falls out of the render
-- query's explicit ORDER BY.
CREATE INDEX IF NOT EXISTS document_templates_lookup_idx
  ON document_templates(tenant_id, doc_type, language, status)
  WHERE deleted_at IS NULL;

-- List page: admin browses everything for the tenant, most-recently
-- updated first. Separate index so the default lookup above stays
-- small.
CREATE INDEX IF NOT EXISTS document_templates_tenant_updated_idx
  ON document_templates(tenant_id, updated_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_templates_tenant_isolation ON document_templates;
CREATE POLICY document_templates_tenant_isolation ON document_templates
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
