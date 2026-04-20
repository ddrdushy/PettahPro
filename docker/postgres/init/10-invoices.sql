-- Customer invoices
-- States: draft → posted → paid | partially_paid | void
-- Posting creates a journal entry that debits AR and credits income + tax accounts.

CREATE TABLE IF NOT EXISTS invoices (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number         varchar(48),
  customer_id            uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  branch_id              uuid REFERENCES branches(id) ON DELETE SET NULL,
  status                 varchar(16) NOT NULL DEFAULT 'draft',
  issue_date             date NOT NULL DEFAULT current_date,
  due_date               date NOT NULL,
  currency               varchar(3) NOT NULL DEFAULT 'LKR',
  fx_rate                numeric(18,6) NOT NULL DEFAULT 1.0,
  -- Money stored as integer cents. Lines aggregated into these headers.
  subtotal_cents         bigint NOT NULL DEFAULT 0,
  discount_cents         bigint NOT NULL DEFAULT 0,
  tax_cents              bigint NOT NULL DEFAULT 0,
  total_cents            bigint NOT NULL DEFAULT 0,
  amount_paid_cents      bigint NOT NULL DEFAULT 0,
  balance_due_cents      bigint NOT NULL DEFAULT 0,
  -- Meta
  reference              varchar(64),
  po_number              varchar(64),
  notes                  text,
  terms                  text,
  -- Posting
  journal_entry_id       uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  posted_at              timestamptz,
  posted_by_user_id      uuid,
  -- Audit
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by_user_id     uuid,
  deleted_at             timestamptz,
  CONSTRAINT invoices_status_check CHECK (status IN ('draft','posted','partially_paid','paid','void')),
  CONSTRAINT invoices_totals_non_negative CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0
    AND total_cents >= 0 AND amount_paid_cents >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_tenant_number_unique
  ON invoices(tenant_id, invoice_number)
  WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_tenant_status ON invoices(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS invoices_tenant_customer ON invoices(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS invoices_tenant_due ON invoices(tenant_id, due_date)
  WHERE status IN ('posted','partially_paid');

CREATE TABLE IF NOT EXISTS invoice_lines (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id           uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no              smallint NOT NULL,
  item_id              uuid REFERENCES items(id) ON DELETE SET NULL,
  description          varchar(500) NOT NULL,
  quantity             numeric(18,4) NOT NULL DEFAULT 1,
  unit_price_cents     bigint NOT NULL DEFAULT 0,
  line_subtotal_cents  bigint NOT NULL DEFAULT 0,
  discount_pct_bps     integer NOT NULL DEFAULT 0, -- basis points 0-10000
  discount_cents       bigint NOT NULL DEFAULT 0,
  tax_code_id          uuid REFERENCES tax_codes(id) ON DELETE SET NULL,
  tax_rate_bps         integer NOT NULL DEFAULT 0,
  tax_cents            bigint NOT NULL DEFAULT 0,
  line_total_cents     bigint NOT NULL DEFAULT 0,
  income_account_id    uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_lines_qty_positive CHECK (quantity > 0),
  CONSTRAINT invoice_lines_amounts_non_negative CHECK (
    unit_price_cents >= 0 AND line_subtotal_cents >= 0
    AND discount_cents >= 0 AND tax_cents >= 0 AND line_total_cents >= 0
  ),
  CONSTRAINT invoice_lines_discount_pct_range CHECK (discount_pct_bps BETWEEN 0 AND 10000)
);

CREATE INDEX IF NOT EXISTS invoice_lines_invoice_idx ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_lines_tenant_item ON invoice_lines(tenant_id, item_id);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_tenant_isolation ON invoices;
CREATE POLICY invoices_tenant_isolation ON invoices
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_lines_tenant_isolation ON invoice_lines;
CREATE POLICY invoice_lines_tenant_isolation ON invoice_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
