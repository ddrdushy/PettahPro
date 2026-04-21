-- Delivery notes — proof of shipment to customer. No GL / stock impact in v1
-- (stock still relieves on invoice post). A separate design pass will add a
-- tenant toggle to move stock relief onto the DN per sell-module-spec §3.
--
-- States: draft → delivered → cancelled
--
-- A DN can be standalone or link to an SO / invoice (information-only).

CREATE TABLE IF NOT EXISTS delivery_notes (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dn_number                varchar(48),
  customer_id              uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  branch_id                uuid REFERENCES branches(id) ON DELETE SET NULL,
  sales_order_id           uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  invoice_id               uuid REFERENCES invoices(id) ON DELETE SET NULL,
  status                   varchar(16) NOT NULL DEFAULT 'draft',
  delivery_date            date NOT NULL DEFAULT current_date,
  shipping_address_line1   varchar(255),
  shipping_address_line2   varchar(255),
  shipping_city            varchar(128),
  shipping_postal_code     varchar(16),
  carrier                  varchar(128),           -- e.g. "Kapruka", "DHL", "Own transport"
  tracking_number          varchar(64),
  received_by_name         varchar(128),           -- who signed for it on the customer's side
  notes                    text,
  delivered_at             timestamptz,
  cancelled_at             timestamptz,
  cancelled_reason         text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by_user_id       uuid,
  deleted_at               timestamptz,
  CONSTRAINT dn_status_check CHECK (status IN ('draft','delivered','cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS dn_tenant_number_unique
  ON delivery_notes(tenant_id, dn_number)
  WHERE dn_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS dn_tenant_status ON delivery_notes(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS dn_tenant_customer ON delivery_notes(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS dn_tenant_invoice ON delivery_notes(tenant_id, invoice_id)
  WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dn_tenant_so ON delivery_notes(tenant_id, sales_order_id)
  WHERE sales_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS delivery_note_lines (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delivery_note_id     uuid NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
  line_no              smallint NOT NULL,
  item_id              uuid REFERENCES items(id) ON DELETE SET NULL,
  description          varchar(500) NOT NULL,
  quantity             numeric(18,4) NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dn_lines_qty_positive CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS dn_lines_dn_idx ON delivery_note_lines(delivery_note_id);
CREATE INDEX IF NOT EXISTS dn_lines_tenant_item ON delivery_note_lines(tenant_id, item_id);

ALTER TABLE delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_notes_tenant_isolation ON delivery_notes;
CREATE POLICY delivery_notes_tenant_isolation ON delivery_notes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE delivery_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_note_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_note_lines_tenant_isolation ON delivery_note_lines;
CREATE POLICY delivery_note_lines_tenant_isolation ON delivery_note_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
