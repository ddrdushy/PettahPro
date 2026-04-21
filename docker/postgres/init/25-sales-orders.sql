-- Sales orders — customer commitment to buy, no GL impact until invoice.
-- States: draft → confirmed | cancelled → converted (to invoice).
--
-- Mirror of purchase orders on the sell side. No reservation logic in v1 —
-- that's a separate design pass with stock semantics.

CREATE TABLE IF NOT EXISTS sales_orders (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  so_number                varchar(48),
  customer_id              uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  branch_id                uuid REFERENCES branches(id) ON DELETE SET NULL,
  status                   varchar(16) NOT NULL DEFAULT 'draft',
  order_date               date NOT NULL DEFAULT current_date,
  expected_ship_date       date,
  currency                 varchar(3) NOT NULL DEFAULT 'LKR',
  subtotal_cents           bigint NOT NULL DEFAULT 0,
  discount_cents           bigint NOT NULL DEFAULT 0,
  tax_cents                bigint NOT NULL DEFAULT 0,
  total_cents              bigint NOT NULL DEFAULT 0,
  reference                varchar(64),
  customer_po_number       varchar(64),   -- customer's PO number referencing our SO
  notes                    text,
  terms                    text,
  -- Lifecycle timestamps
  confirmed_at             timestamptz,
  cancelled_at             timestamptz,
  cancelled_reason         text,
  -- On conversion we stamp the invoice id so the SO can never be converted
  -- twice and the invoice links back.
  converted_invoice_id     uuid REFERENCES invoices(id) ON DELETE SET NULL,
  converted_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by_user_id       uuid,
  deleted_at               timestamptz,
  CONSTRAINT so_status_check CHECK (status IN (
    'draft','confirmed','cancelled','converted'
  )),
  CONSTRAINT so_totals_non_negative CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS so_tenant_number_unique
  ON sales_orders(tenant_id, so_number)
  WHERE so_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS so_tenant_status ON sales_orders(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS so_tenant_customer ON sales_orders(tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sales_order_id       uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
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
  CONSTRAINT so_lines_qty_positive CHECK (quantity > 0),
  CONSTRAINT so_lines_amounts_non_negative CHECK (
    unit_price_cents >= 0 AND line_subtotal_cents >= 0
    AND discount_cents >= 0 AND tax_cents >= 0 AND line_total_cents >= 0
  ),
  CONSTRAINT so_lines_discount_pct_range CHECK (discount_pct_bps BETWEEN 0 AND 10000)
);

CREATE INDEX IF NOT EXISTS so_lines_so_idx ON sales_order_lines(sales_order_id);
CREATE INDEX IF NOT EXISTS so_lines_tenant_item ON sales_order_lines(tenant_id, item_id);

ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_orders_tenant_isolation ON sales_orders;
CREATE POLICY sales_orders_tenant_isolation ON sales_orders
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_order_lines_tenant_isolation ON sales_order_lines;
CREATE POLICY sales_order_lines_tenant_isolation ON sales_order_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
