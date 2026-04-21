-- Customer quotations (estimates) — no GL impact, pure pre-sales document.
-- States: draft → sent → accepted | rejected | expired
--                         ↓
--                     converted (into an invoice; keeps audit trail via converted_invoice_id)
--
-- Spec alignment: sell-module-spec §3 (quote → sales order → invoice chain).
-- This v1 handles quote → invoice directly; sales orders land separately.

CREATE TABLE IF NOT EXISTS quotations (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quotation_number       varchar(48),
  customer_id            uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  branch_id              uuid REFERENCES branches(id) ON DELETE SET NULL,
  status                 varchar(16) NOT NULL DEFAULT 'draft',
  issue_date             date NOT NULL DEFAULT current_date,
  valid_until            date NOT NULL,
  currency               varchar(3) NOT NULL DEFAULT 'LKR',
  subtotal_cents         bigint NOT NULL DEFAULT 0,
  discount_cents         bigint NOT NULL DEFAULT 0,
  tax_cents              bigint NOT NULL DEFAULT 0,
  total_cents            bigint NOT NULL DEFAULT 0,
  reference              varchar(64),
  notes                  text,
  terms                  text,
  -- Lifecycle timestamps for audit
  sent_at                timestamptz,
  accepted_at            timestamptz,
  rejected_at            timestamptz,
  rejected_reason        text,
  -- On conversion, we stamp the invoice id here so the quote can never
  -- be converted twice and the invoice links back.
  converted_invoice_id   uuid REFERENCES invoices(id) ON DELETE SET NULL,
  converted_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by_user_id     uuid,
  deleted_at             timestamptz,
  CONSTRAINT quotations_status_check CHECK (status IN (
    'draft','sent','accepted','rejected','expired','converted'
  )),
  CONSTRAINT quotations_totals_non_negative CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS quotations_tenant_number_unique
  ON quotations(tenant_id, quotation_number)
  WHERE quotation_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS quotations_tenant_status ON quotations(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS quotations_tenant_customer ON quotations(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS quotations_tenant_valid ON quotations(tenant_id, valid_until)
  WHERE status IN ('sent','draft');

CREATE TABLE IF NOT EXISTS quotation_lines (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quotation_id         uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
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
  CONSTRAINT quotation_lines_qty_positive CHECK (quantity > 0),
  CONSTRAINT quotation_lines_amounts_non_negative CHECK (
    unit_price_cents >= 0 AND line_subtotal_cents >= 0
    AND discount_cents >= 0 AND tax_cents >= 0 AND line_total_cents >= 0
  ),
  CONSTRAINT quotation_lines_discount_pct_range CHECK (discount_pct_bps BETWEEN 0 AND 10000)
);

CREATE INDEX IF NOT EXISTS quotation_lines_quotation_idx ON quotation_lines(quotation_id);
CREATE INDEX IF NOT EXISTS quotation_lines_tenant_item ON quotation_lines(tenant_id, item_id);

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotations_tenant_isolation ON quotations;
CREATE POLICY quotations_tenant_isolation ON quotations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE quotation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotation_lines_tenant_isolation ON quotation_lines;
CREATE POLICY quotation_lines_tenant_isolation ON quotation_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
