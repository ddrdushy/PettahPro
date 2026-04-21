-- Stock transfer between warehouses.
-- Two-step lifecycle per inventory-module-spec §4.2:
--
--   draft      → user composes the transfer, picks source + dest + lines
--   dispatched → source warehouse loses the qty (stock_ledger transfer_out),
--                qty sits "in transit" (visible only on the transfer record)
--   received   → destination warehouse gains the qty (stock_ledger transfer_in),
--                at the WAVG cost captured at dispatch. Receiver may record a
--                lower qty (shrinkage / damage in transit) → discrepancy.
--   cancelled  → draft only; post-dispatch cancellation is a separate reversal.
--
-- No GL journal needed — stock moves between warehouses of the same tenant,
-- total inventory value unchanged. stock_ledger carries the audit trail.

CREATE TABLE IF NOT EXISTS stock_transfers (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transfer_number   varchar(48),
  source_warehouse_id       uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  destination_warehouse_id  uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status            varchar(16) NOT NULL DEFAULT 'draft',
  requested_date    date NOT NULL,
  dispatched_at     timestamptz,
  received_at       timestamptz,
  cancelled_at      timestamptz,
  cancelled_reason  text,
  dispatched_by_user_id  uuid,
  received_by_user_id    uuid,
  notes             text,
  has_discrepancy   boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  deleted_at        timestamptz,
  CONSTRAINT stock_transfer_status_check
    CHECK (status IN ('draft','dispatched','received','cancelled')),
  CONSTRAINT stock_transfer_different_warehouses
    CHECK (source_warehouse_id <> destination_warehouse_id)
);

CREATE INDEX IF NOT EXISTS stock_transfers_tenant_status
  ON stock_transfers(tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_transfers_isolation ON stock_transfers;
CREATE POLICY stock_transfers_isolation ON stock_transfers
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transfer_id         uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  line_no             smallint NOT NULL,
  item_id             uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity_requested  numeric(18,4) NOT NULL,
  quantity_dispatched numeric(18,4),
  quantity_received   numeric(18,4),
  unit_cost_cents_at_dispatch bigint,
  notes               varchar(255),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_transfer_lines_header
  ON stock_transfer_lines(transfer_id, line_no);

ALTER TABLE stock_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_transfer_lines_isolation ON stock_transfer_lines;
CREATE POLICY stock_transfer_lines_isolation ON stock_transfer_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Seed document-number sequence.
INSERT INTO document_sequences (tenant_id, sequence_name, prefix, scope, pad_width)
SELECT t.id, 'stock_transfer', 'ST', 'year', 4
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM document_sequences d
    WHERE d.tenant_id = t.id AND d.sequence_name = 'stock_transfer'
 );
