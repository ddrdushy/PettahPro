-- Purchase orders — commitment to a supplier, no GL impact.
-- States: draft → sent → acknowledged | cancelled → converted (to a bill).
--
-- Mirror of quotations on the buy side. The 'purchase_order' document
-- sequence (prefix 'PO') is already seeded per tenant in 07-seed-defaults.sql.

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_number                varchar(48),
  supplier_id              uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  branch_id                uuid REFERENCES branches(id) ON DELETE SET NULL,
  status                   varchar(16) NOT NULL DEFAULT 'draft',
  order_date               date NOT NULL DEFAULT current_date,
  expected_delivery_date   date,
  currency                 varchar(3) NOT NULL DEFAULT 'LKR',
  subtotal_cents           bigint NOT NULL DEFAULT 0,
  discount_cents           bigint NOT NULL DEFAULT 0,
  tax_cents                bigint NOT NULL DEFAULT 0,
  total_cents              bigint NOT NULL DEFAULT 0,
  reference                varchar(64),
  supplier_reference       varchar(64),   -- supplier's ack number if they sent one
  notes                    text,
  terms                    text,
  -- Lifecycle timestamps
  sent_at                  timestamptz,
  acknowledged_at          timestamptz,
  cancelled_at             timestamptz,
  cancelled_reason         text,
  -- On conversion we stamp the bill id so the PO can never be converted
  -- twice and the bill links back.
  converted_bill_id        uuid REFERENCES bills(id) ON DELETE SET NULL,
  converted_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by_user_id       uuid,
  deleted_at               timestamptz,
  CONSTRAINT po_status_check CHECK (status IN (
    'draft','sent','acknowledged','cancelled','converted'
  )),
  CONSTRAINT po_totals_non_negative CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS po_tenant_number_unique
  ON purchase_orders(tenant_id, po_number)
  WHERE po_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS po_tenant_status ON purchase_orders(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS po_tenant_supplier ON purchase_orders(tenant_id, supplier_id);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id    uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
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
  CONSTRAINT po_lines_qty_positive CHECK (quantity > 0),
  CONSTRAINT po_lines_amounts_non_negative CHECK (
    unit_price_cents >= 0 AND line_subtotal_cents >= 0
    AND discount_cents >= 0 AND tax_cents >= 0 AND line_total_cents >= 0
  ),
  CONSTRAINT po_lines_discount_pct_range CHECK (discount_pct_bps BETWEEN 0 AND 10000)
);

CREATE INDEX IF NOT EXISTS po_lines_po_idx ON purchase_order_lines(purchase_order_id);
CREATE INDEX IF NOT EXISTS po_lines_tenant_item ON purchase_order_lines(tenant_id, item_id);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_orders_tenant_isolation ON purchase_orders;
CREATE POLICY purchase_orders_tenant_isolation ON purchase_orders
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_order_lines_tenant_isolation ON purchase_order_lines;
CREATE POLICY purchase_order_lines_tenant_isolation ON purchase_order_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
