-- Perpetual inventory: immutable stock_ledger + denormalized item_balances.
-- Every posting of a bill or invoice referencing a tracked item writes one
-- stock_ledger row and updates one item_balances row (inside the same
-- transaction as the journal entry — so the ledger and GL never diverge).
--
-- v1 scope: single default warehouse, weighted-average valuation only,
-- negative stock hard-blocked at the DB layer.

-- ------------------------------------------------------------------------------
-- item_balances — current snapshot per (item, warehouse)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_balances (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id            uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id       uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity_on_hand   numeric(18,4) NOT NULL DEFAULT 0,
  average_cost_cents bigint NOT NULL DEFAULT 0,
  total_value_cents  bigint NOT NULL DEFAULT 0,
  last_movement_at   timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_balances_non_negative_qty CHECK (quantity_on_hand >= 0),
  CONSTRAINT item_balances_non_negative_value CHECK (total_value_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS item_balances_tenant_item_warehouse_unique
  ON item_balances(tenant_id, item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS item_balances_tenant_idx ON item_balances(tenant_id);

-- ------------------------------------------------------------------------------
-- stock_ledger — immutable audit trail (append-only)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_ledger (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id                 uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  warehouse_id            uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  movement_type           varchar(24) NOT NULL,
  quantity                numeric(18,4) NOT NULL,    -- signed: +in, -out
  unit_cost_cents         bigint NOT NULL,
  total_cost_cents        bigint NOT NULL,
  -- Running snapshot AT this movement (post-application)
  running_quantity        numeric(18,4) NOT NULL,
  running_value_cents     bigint NOT NULL,
  running_avg_cost_cents  bigint NOT NULL,
  source_document_type    varchar(32),
  source_document_id      uuid,
  source_line_id          uuid,
  journal_entry_id        uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  memo                    varchar(500),
  posted_by_user_id       uuid,
  occurred_at             timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_ledger_movement_check CHECK (
    movement_type IN (
      'purchase_bill','sales_invoice','sales_return','purchase_return',
      'adjustment_positive','adjustment_negative','transfer_in','transfer_out',
      'opening_balance','bundle_consume'
    )
  ),
  CONSTRAINT stock_ledger_qty_nonzero CHECK (quantity <> 0)
);

CREATE INDEX IF NOT EXISTS stock_ledger_tenant_item
  ON stock_ledger(tenant_id, item_id, occurred_at);
CREATE INDEX IF NOT EXISTS stock_ledger_tenant_warehouse
  ON stock_ledger(tenant_id, warehouse_id, occurred_at);
CREATE INDEX IF NOT EXISTS stock_ledger_source
  ON stock_ledger(tenant_id, source_document_type, source_document_id);

-- Immutability trigger — block UPDATE/DELETE per spec (corrections post new rows)
CREATE OR REPLACE FUNCTION stock_ledger_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'stock_ledger is immutable — post a reversing movement instead';
END;
$$;

DROP TRIGGER IF EXISTS stock_ledger_no_update ON stock_ledger;
CREATE TRIGGER stock_ledger_no_update
  BEFORE UPDATE OR DELETE ON stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION stock_ledger_block_mutation();

ALTER TABLE item_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_balances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_balances_tenant_isolation ON item_balances;
CREATE POLICY item_balances_tenant_isolation ON item_balances
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_ledger_tenant_isolation ON stock_ledger;
CREATE POLICY stock_ledger_tenant_isolation ON stock_ledger
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
