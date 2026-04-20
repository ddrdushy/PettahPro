-- Supplier bills — AP counterpart to invoices.
-- Posting: DR expense lines, DR VAT recoverable, CR Accounts payable.
-- WHT is handled at payment time for v1 (simpler story).

CREATE TABLE IF NOT EXISTS bills (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  internal_reference     varchar(48),          -- our ref (BIL-2026-0001)
  supplier_bill_number   varchar(64),           -- the number printed on supplier's invoice
  supplier_id            uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  branch_id              uuid REFERENCES branches(id) ON DELETE SET NULL,
  status                 varchar(16) NOT NULL DEFAULT 'draft',
  bill_date              date NOT NULL DEFAULT current_date,
  due_date               date NOT NULL,
  currency               varchar(3) NOT NULL DEFAULT 'LKR',
  fx_rate                numeric(18,6) NOT NULL DEFAULT 1.0,
  subtotal_cents         bigint NOT NULL DEFAULT 0,
  discount_cents         bigint NOT NULL DEFAULT 0,
  tax_cents              bigint NOT NULL DEFAULT 0,
  total_cents            bigint NOT NULL DEFAULT 0,
  amount_paid_cents      bigint NOT NULL DEFAULT 0,
  balance_due_cents      bigint NOT NULL DEFAULT 0,
  notes                  text,
  journal_entry_id       uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  posted_at              timestamptz,
  posted_by_user_id      uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by_user_id     uuid,
  deleted_at             timestamptz,
  CONSTRAINT bills_status_check CHECK (status IN ('draft','posted','partially_paid','paid','void')),
  CONSTRAINT bills_totals_non_negative CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0
    AND total_cents >= 0 AND amount_paid_cents >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS bills_tenant_internal_ref_unique
  ON bills(tenant_id, internal_reference)
  WHERE internal_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bills_tenant_supplier_bill_unique
  ON bills(tenant_id, supplier_id, supplier_bill_number)
  WHERE supplier_bill_number IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bills_tenant_status ON bills(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bills_tenant_supplier ON bills(tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS bills_tenant_due ON bills(tenant_id, due_date)
  WHERE status IN ('posted','partially_paid');

CREATE TABLE IF NOT EXISTS bill_lines (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bill_id              uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
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
  CONSTRAINT bill_lines_qty_positive CHECK (quantity > 0),
  CONSTRAINT bill_lines_amounts_non_negative CHECK (
    unit_price_cents >= 0 AND line_subtotal_cents >= 0
    AND discount_cents >= 0 AND tax_cents >= 0 AND line_total_cents >= 0
  ),
  CONSTRAINT bill_lines_discount_pct_range CHECK (discount_pct_bps BETWEEN 0 AND 10000)
);

CREATE INDEX IF NOT EXISTS bill_lines_bill_idx ON bill_lines(bill_id);
CREATE INDEX IF NOT EXISTS bill_lines_tenant_item ON bill_lines(tenant_id, item_id);

ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bills_tenant_isolation ON bills;
CREATE POLICY bills_tenant_isolation ON bills
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE bill_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bill_lines_tenant_isolation ON bill_lines;
CREATE POLICY bill_lines_tenant_isolation ON bill_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
