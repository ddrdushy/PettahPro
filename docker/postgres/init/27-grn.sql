-- Goods Received Note (GRN) — proof of receipt from supplier. Buy-side mirror
-- of delivery notes. No GL / stock impact in v1 (stock relieves on bill post).
-- A separate design pass will add stock-receipt-on-GRN per buy-module-spec §3.
--
-- States: draft → received → cancelled
-- A GRN can be standalone or link to a PO / bill (information-only).

CREATE TABLE IF NOT EXISTS grns (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grn_number               varchar(48),
  supplier_id              uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  branch_id                uuid REFERENCES branches(id) ON DELETE SET NULL,
  purchase_order_id        uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  bill_id                  uuid REFERENCES bills(id) ON DELETE SET NULL,
  status                   varchar(16) NOT NULL DEFAULT 'draft',
  receipt_date             date NOT NULL DEFAULT current_date,
  supplier_delivery_note   varchar(64),           -- supplier's own DN number if printed
  received_by_user_id      uuid,                   -- who on our side signed for it
  condition_notes          text,                   -- "3 boxes damaged", "short by 2 units"
  notes                    text,
  received_at              timestamptz,
  cancelled_at             timestamptz,
  cancelled_reason         text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by_user_id       uuid,
  deleted_at               timestamptz,
  CONSTRAINT grn_status_check CHECK (status IN ('draft','received','cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS grn_tenant_number_unique
  ON grns(tenant_id, grn_number)
  WHERE grn_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS grn_tenant_status ON grns(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS grn_tenant_supplier ON grns(tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS grn_tenant_po ON grns(tenant_id, purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS grn_tenant_bill ON grns(tenant_id, bill_id)
  WHERE bill_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS grn_lines (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grn_id               uuid NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
  line_no              smallint NOT NULL,
  item_id              uuid REFERENCES items(id) ON DELETE SET NULL,
  description          varchar(500) NOT NULL,
  quantity_ordered     numeric(18,4),           -- from PO if linked, otherwise null
  quantity_received    numeric(18,4) NOT NULL,
  line_notes           varchar(255),             -- "2 damaged", "back-ordered", etc.
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grn_lines_qty_received_positive CHECK (quantity_received > 0),
  CONSTRAINT grn_lines_qty_ordered_non_negative CHECK (
    quantity_ordered IS NULL OR quantity_ordered >= 0
  )
);

CREATE INDEX IF NOT EXISTS grn_lines_grn_idx ON grn_lines(grn_id);
CREATE INDEX IF NOT EXISTS grn_lines_tenant_item ON grn_lines(tenant_id, item_id);

ALTER TABLE grns ENABLE ROW LEVEL SECURITY;
ALTER TABLE grns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grns_tenant_isolation ON grns;
CREATE POLICY grns_tenant_isolation ON grns
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE grn_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grn_lines_tenant_isolation ON grn_lines;
CREATE POLICY grn_lines_tenant_isolation ON grn_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
