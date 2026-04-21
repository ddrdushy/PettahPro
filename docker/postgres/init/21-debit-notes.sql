-- Supplier debit notes — AP counterpart to credit notes.
-- States: draft → posted → void
-- Posting creates a reversing journal that debits AP and credits expense +
-- input VAT (the exact opposite of a bill posting).
-- Optionally links to an original bill; if so, posting reduces that
-- bill's balance_due_cents by min(DN total, bill balance).

CREATE TABLE IF NOT EXISTS debit_notes (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  internal_reference     varchar(48),          -- our ref (DN-2026-0001)
  supplier_debit_number  varchar(64),           -- number printed on supplier's debit note (if any)
  supplier_id            uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  branch_id              uuid REFERENCES branches(id) ON DELETE SET NULL,
  -- Original bill this debit note adjusts (optional — a DN can be
  -- standalone, e.g. a goodwill rebate that creates a standing debit).
  bill_id                uuid REFERENCES bills(id) ON DELETE SET NULL,
  status                 varchar(16) NOT NULL DEFAULT 'draft',
  issue_date             date NOT NULL DEFAULT current_date,
  currency               varchar(3) NOT NULL DEFAULT 'LKR',
  subtotal_cents         bigint NOT NULL DEFAULT 0,
  discount_cents         bigint NOT NULL DEFAULT 0,
  tax_cents              bigint NOT NULL DEFAULT 0,
  total_cents            bigint NOT NULL DEFAULT 0,
  -- How much of this debit note has been applied to a bill. The
  -- remainder (total - applied) is a standing debit against the supplier.
  applied_cents          bigint NOT NULL DEFAULT 0,
  reason                 varchar(32) NOT NULL DEFAULT 'return',
  notes                  text,
  journal_entry_id       uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  posted_at              timestamptz,
  posted_by_user_id      uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by_user_id     uuid,
  deleted_at             timestamptz,
  CONSTRAINT debit_notes_status_check CHECK (status IN ('draft','posted','void')),
  CONSTRAINT debit_notes_reason_check CHECK (reason IN (
    'return','price_adjustment','discount','goodwill','shortage','other'
  )),
  CONSTRAINT debit_notes_totals_non_negative CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0
    AND total_cents >= 0 AND applied_cents >= 0
  ),
  CONSTRAINT debit_notes_applied_bounded CHECK (applied_cents <= total_cents)
);

CREATE UNIQUE INDEX IF NOT EXISTS debit_notes_tenant_internal_ref_unique
  ON debit_notes(tenant_id, internal_reference)
  WHERE internal_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS debit_notes_tenant_status ON debit_notes(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS debit_notes_tenant_supplier ON debit_notes(tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS debit_notes_tenant_bill ON debit_notes(tenant_id, bill_id)
  WHERE bill_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS debit_note_lines (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  debit_note_id        uuid NOT NULL REFERENCES debit_notes(id) ON DELETE CASCADE,
  line_no              smallint NOT NULL,
  item_id              uuid REFERENCES items(id) ON DELETE SET NULL,
  description          varchar(500) NOT NULL,
  quantity             numeric(18,4) NOT NULL DEFAULT 1,
  unit_price_cents     bigint NOT NULL DEFAULT 0,
  line_subtotal_cents  bigint NOT NULL DEFAULT 0,
  discount_pct_bps     integer NOT NULL DEFAULT 0,
  discount_cents       bigint NOT NULL DEFAULT 0,
  tax_code_id          uuid REFERENCES tax_codes(id) ON DELETE SET NULL,
  tax_rate_bps         integer NOT NULL DEFAULT 0,
  tax_cents            bigint NOT NULL DEFAULT 0,
  line_total_cents     bigint NOT NULL DEFAULT 0,
  expense_account_id   uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT debit_note_lines_qty_positive CHECK (quantity > 0),
  CONSTRAINT debit_note_lines_amounts_non_negative CHECK (
    unit_price_cents >= 0 AND line_subtotal_cents >= 0
    AND discount_cents >= 0 AND tax_cents >= 0 AND line_total_cents >= 0
  ),
  CONSTRAINT debit_note_lines_discount_pct_range CHECK (discount_pct_bps BETWEEN 0 AND 10000)
);

CREATE INDEX IF NOT EXISTS debit_note_lines_dn_idx ON debit_note_lines(debit_note_id);
CREATE INDEX IF NOT EXISTS debit_note_lines_tenant_item ON debit_note_lines(tenant_id, item_id);

ALTER TABLE debit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE debit_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS debit_notes_tenant_isolation ON debit_notes;
CREATE POLICY debit_notes_tenant_isolation ON debit_notes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE debit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE debit_note_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS debit_note_lines_tenant_isolation ON debit_note_lines;
CREATE POLICY debit_note_lines_tenant_isolation ON debit_note_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
