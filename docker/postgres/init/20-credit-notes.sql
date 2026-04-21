-- Customer credit notes
-- States: draft → posted → void
-- Posting creates a reversing journal that credits AR and debits income +
-- tax payable (the exact opposite of an invoice posting).
-- Optionally links to an original invoice; if so, posting reduces that
-- invoice's balance_due_cents by min(CN total, invoice balance).

CREATE TABLE IF NOT EXISTS credit_notes (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  credit_note_number     varchar(48),
  customer_id            uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  branch_id              uuid REFERENCES branches(id) ON DELETE SET NULL,
  -- Original invoice this credit note adjusts (optional — a CN can be
  -- standalone, e.g. a goodwill discount that creates a standing credit).
  invoice_id             uuid REFERENCES invoices(id) ON DELETE SET NULL,
  status                 varchar(16) NOT NULL DEFAULT 'draft',
  issue_date             date NOT NULL DEFAULT current_date,
  currency               varchar(3) NOT NULL DEFAULT 'LKR',
  -- Money stored as integer cents. Lines aggregated into these headers.
  subtotal_cents         bigint NOT NULL DEFAULT 0,
  discount_cents         bigint NOT NULL DEFAULT 0,
  tax_cents              bigint NOT NULL DEFAULT 0,
  total_cents            bigint NOT NULL DEFAULT 0,
  -- How much of this credit note has been applied to an invoice. The
  -- remainder (total - applied) is a standing credit on the customer.
  applied_cents          bigint NOT NULL DEFAULT 0,
  -- Why the credit note was issued — surfaced on the VAT adjustments register.
  reason                 varchar(32) NOT NULL DEFAULT 'return',
  notes                  text,
  -- Posting
  journal_entry_id       uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  posted_at              timestamptz,
  posted_by_user_id      uuid,
  -- Audit
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by_user_id     uuid,
  deleted_at             timestamptz,
  CONSTRAINT credit_notes_status_check CHECK (status IN ('draft','posted','void')),
  CONSTRAINT credit_notes_reason_check CHECK (reason IN (
    'return','price_adjustment','discount','goodwill','write_off','other'
  )),
  CONSTRAINT credit_notes_totals_non_negative CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0
    AND total_cents >= 0 AND applied_cents >= 0
  ),
  CONSTRAINT credit_notes_applied_bounded CHECK (applied_cents <= total_cents)
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_tenant_number_unique
  ON credit_notes(tenant_id, credit_note_number)
  WHERE credit_note_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_notes_tenant_status ON credit_notes(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS credit_notes_tenant_customer ON credit_notes(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS credit_notes_tenant_invoice ON credit_notes(tenant_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS credit_note_lines (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  credit_note_id       uuid NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
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
  income_account_id    uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_note_lines_qty_positive CHECK (quantity > 0),
  CONSTRAINT credit_note_lines_amounts_non_negative CHECK (
    unit_price_cents >= 0 AND line_subtotal_cents >= 0
    AND discount_cents >= 0 AND tax_cents >= 0 AND line_total_cents >= 0
  ),
  CONSTRAINT credit_note_lines_discount_pct_range CHECK (discount_pct_bps BETWEEN 0 AND 10000)
);

CREATE INDEX IF NOT EXISTS credit_note_lines_cn_idx ON credit_note_lines(credit_note_id);
CREATE INDEX IF NOT EXISTS credit_note_lines_tenant_item ON credit_note_lines(tenant_id, item_id);

ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_notes_tenant_isolation ON credit_notes;
CREATE POLICY credit_notes_tenant_isolation ON credit_notes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_note_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_note_lines_tenant_isolation ON credit_note_lines;
CREATE POLICY credit_note_lines_tenant_isolation ON credit_note_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
