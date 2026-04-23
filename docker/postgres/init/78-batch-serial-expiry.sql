-- Batch / serial / expiry tracking (roadmap #34)
--
-- Three independently configurable per-item tracking modes — directly
-- out of inventory-spec §2.7. Any combination is legal: pharmacy =
-- batch+expiry, electronics = serial only, textile = neither.
--
--   * Batch tracking: stock-per-batch with FIFO consumption. Inbound
--     from a bill creates one item_batches row with remaining_qty =
--     original_qty. Outbound (invoice / DN post) decrements
--     remaining_qty across one or more batches in FIFO order (oldest
--     expiry first, then earliest received_at) and logs per-batch
--     allocations in stock_movement_batch_allocations so recall is a
--     simple join away.
--   * Serial tracking: every unit is a unique item_serials row that
--     walks a state machine (in_stock → sold → returned / scrapped).
--     Caller picks specific serial_ids at sale time; the sale stamps
--     sold_invoice_id / sold_customer_id / sold_at + warranty expiry
--     for full trace from purchase to sale.
--   * Expiry tracking: a flag on items that forces batches to carry
--     an expiry_date and bumps expiry up in the FIFO sort. Surfaces
--     the "items expiring in N days" report that the spec calls out.
--
-- Warranty (spec §2.7 "Warranty: tracked per serial"): items.warranty_months
-- is a simple integer. At sale time the serial's warranty_expires_at
-- is stamped = sold_at + warranty_months. Null warranty_months = no
-- warranty tracking, matching the existing null-means-unset pattern.
--
-- v1 wiring: bill post (inbound) and invoice post (outbound). DN
-- post, stock counts, credit note reversal, and stock transfers reuse
-- the same primitives in a follow-up — deliberately deferred to keep
-- this PR reviewable. Flagged in _status.md.
--
-- Fully idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT
-- EXISTS, CREATE INDEX IF NOT EXISTS, DROP POLICY IF EXISTS +
-- CREATE POLICY.

-- ---------------------------------------------------------------------------
-- 1. Per-item toggles + warranty
-- ---------------------------------------------------------------------------
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS track_batches boolean NOT NULL DEFAULT false;
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS track_serials boolean NOT NULL DEFAULT false;
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS track_expiry boolean NOT NULL DEFAULT false;
-- Null = no warranty tracked. Non-null months drives
-- item_serials.warranty_expires_at at sale time. We keep months rather
-- than days so the UX matches how warranties are quoted ("12 months",
-- "24 months") — conversion happens in the app.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS warranty_months integer;
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_warranty_months_nonneg;
ALTER TABLE items
  ADD CONSTRAINT items_warranty_months_nonneg
  CHECK (warranty_months IS NULL OR warranty_months >= 0);

-- Business rule: tracking modes only make sense on products that
-- carry stock. Services / bundles can't batch-track their inbound
-- because there is no inbound. Enforced in app (items.ts Zod +
-- handler) rather than a DB trigger — service/bundle + track_batches
-- is silently forced off on write.

-- ---------------------------------------------------------------------------
-- 2. Batches (lots received from purchases)
-- ---------------------------------------------------------------------------
-- One row per inbound lot. remaining_qty floats as outbound
-- movements consume it. original_qty is immutable — it's the sign of
-- the initial receipt, useful for audit ("this lot came in as 500
-- units"). unit_cost_cents is captured at receipt time so recall +
-- expiry reports can show value-remaining without re-joining to the
-- bill.
CREATE TABLE IF NOT EXISTS item_batches (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id              uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  warehouse_id         uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  -- Supplier's lot number / internal batch code. Per-tenant per-item
  -- uniqueness isn't required — two bills from different suppliers
  -- might reuse the same printed lot number. Uniqueness is scoped to
  -- a single receipt (the bill line that created it).
  batch_number         varchar(64) NOT NULL,
  mfg_date             date,
  expiry_date          date,
  original_qty         numeric(18,4) NOT NULL CHECK (original_qty > 0),
  remaining_qty        numeric(18,4) NOT NULL CHECK (remaining_qty >= 0),
  unit_cost_cents      bigint NOT NULL CHECK (unit_cost_cents >= 0),
  received_at          timestamptz NOT NULL DEFAULT now(),
  -- Upstream document that created the lot — almost always a bill,
  -- but future inbound paths (opening balance, stock transfer) will
  -- populate different source_document_type values.
  source_document_type varchar(32),
  source_document_id   uuid,
  source_line_id       uuid,
  supplier_id          uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  notes                varchar(500),
  -- Soft-delete allowed so an accidental creation can be hidden
  -- without losing the audit trail. FIFO consumption filters
  -- deleted_at IS NULL so a hidden batch is never consumed.
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,

  -- remaining_qty can never exceed original_qty — a second belt in
  -- addition to the app-layer decrement.
  CONSTRAINT item_batches_remaining_le_original
    CHECK (remaining_qty <= original_qty)
);

-- FIFO consumption: oldest expiry first (null expiry sorts last so
-- no-expiry batches only consume after dated ones are exhausted),
-- then earliest received_at. Index mirrors that sort so the planner
-- can use it directly.
CREATE INDEX IF NOT EXISTS item_batches_fifo_idx
  ON item_batches(tenant_id, item_id, warehouse_id, expiry_date NULLS LAST, received_at)
  WHERE deleted_at IS NULL AND remaining_qty > 0;

-- Expiring-soon report: "items expiring in N days" filter.
CREATE INDEX IF NOT EXISTS item_batches_expiry_idx
  ON item_batches(tenant_id, expiry_date)
  WHERE deleted_at IS NULL AND remaining_qty > 0 AND expiry_date IS NOT NULL;

-- Recall lookup: find every batch from a specific bill line (rare
-- but needed when a supplier recalls a lot and we don't know our
-- batch number offhand).
CREATE INDEX IF NOT EXISTS item_batches_source_line_idx
  ON item_batches(tenant_id, source_document_type, source_document_id)
  WHERE deleted_at IS NULL;

ALTER TABLE item_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_batches_tenant_isolation ON item_batches;
CREATE POLICY item_batches_tenant_isolation ON item_batches
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- 3. Serials (unique units for serial-tracked items)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_serials (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id              uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  warehouse_id         uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  serial_number        varchar(128) NOT NULL,
  -- Serial state machine: in_stock (received) → sold (issued on an
  -- invoice) → returned (came back via credit note; re-available)
  -- → scrapped (written off — stock count variance or damage).
  status               varchar(16) NOT NULL DEFAULT 'in_stock'
    CHECK (status IN ('in_stock','sold','returned','scrapped')),
  -- Optional link back to the batch this serial came in with —
  -- useful when an item is both batch + serial tracked (rare but
  -- supported: high-value pharma samples).
  batch_id             uuid REFERENCES item_batches(id) ON DELETE SET NULL,
  unit_cost_cents      bigint NOT NULL CHECK (unit_cost_cents >= 0),
  -- Inbound provenance.
  acquired_document_type varchar(32),
  acquired_document_id   uuid,
  acquired_line_id       uuid,
  acquired_at          timestamptz NOT NULL DEFAULT now(),
  supplier_id          uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  -- Outbound (set when status flips to 'sold').
  sold_document_type   varchar(32),
  sold_document_id     uuid,
  sold_line_id         uuid,
  sold_customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,
  sold_at              timestamptz,
  warranty_expires_at  date,
  notes                varchar(500),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

-- A serial number is unique within a tenant's catalogue of a single
-- item. Two different items can share "SN-001" (Nokia serial vs.
-- Samsung serial), but one item can't have two units with the same
-- serial — that would defeat the whole point of serial tracking.
-- Partial on deleted_at so a soft-delete frees the serial for re-use.
CREATE UNIQUE INDEX IF NOT EXISTS item_serials_unique_number
  ON item_serials(tenant_id, item_id, serial_number)
  WHERE deleted_at IS NULL;

-- "Which serials are in stock for this item at this warehouse?" —
-- the serial picker on the invoice form.
CREATE INDEX IF NOT EXISTS item_serials_available_idx
  ON item_serials(tenant_id, item_id, warehouse_id, status)
  WHERE deleted_at IS NULL;

-- Serial trace by customer — "what serials did we sell this
-- customer?" (warranty lookup from customer detail).
CREATE INDEX IF NOT EXISTS item_serials_customer_idx
  ON item_serials(tenant_id, sold_customer_id)
  WHERE deleted_at IS NULL AND sold_customer_id IS NOT NULL;

ALTER TABLE item_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_serials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_serials_tenant_isolation ON item_serials;
CREATE POLICY item_serials_tenant_isolation ON item_serials
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- 4. Stock movement → batch allocations (recall trail)
-- ---------------------------------------------------------------------------
-- A single outbound movement can consume from multiple batches when
-- FIFO crosses batch boundaries. This join table records exactly
-- which batches contributed what qty to which ledger row — it's the
-- primary data source for the recall report.
CREATE TABLE IF NOT EXISTS stock_movement_batch_allocations (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stock_ledger_id      uuid NOT NULL REFERENCES stock_ledger(id) ON DELETE CASCADE,
  batch_id             uuid NOT NULL REFERENCES item_batches(id) ON DELETE RESTRICT,
  -- Always positive — the quantity consumed from this batch for
  -- this movement. Sum of allocations per ledger row equals the
  -- ledger row's absolute quantity.
  quantity             numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit_cost_cents      bigint NOT NULL CHECK (unit_cost_cents >= 0),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Recall lookup: "every movement that drew from this batch".
CREATE INDEX IF NOT EXISTS stock_mvmt_batch_alloc_batch_idx
  ON stock_movement_batch_allocations(tenant_id, batch_id);

-- Reverse lookup: "what batches did this ledger row consume from?"
-- Driven from the stock-ledger detail drawer.
CREATE INDEX IF NOT EXISTS stock_mvmt_batch_alloc_ledger_idx
  ON stock_movement_batch_allocations(stock_ledger_id);

ALTER TABLE stock_movement_batch_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movement_batch_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_mvmt_batch_alloc_tenant_isolation
  ON stock_movement_batch_allocations;
CREATE POLICY stock_mvmt_batch_alloc_tenant_isolation
  ON stock_movement_batch_allocations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- 5. Extend stock_ledger with optional batch + serial linkage
-- ---------------------------------------------------------------------------
-- Quick-access fields on the ledger row so the stock activity page
-- can display batch / serial info without joining to the allocation
-- table on every row. When a movement spans multiple batches these
-- columns stay null (the allocations table is authoritative) — the
-- app logic writes them only for single-batch movements.
ALTER TABLE stock_ledger
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES item_batches(id) ON DELETE SET NULL;
ALTER TABLE stock_ledger
  ADD COLUMN IF NOT EXISTS serial_id uuid REFERENCES item_serials(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS stock_ledger_batch_idx
  ON stock_ledger(tenant_id, batch_id)
  WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_ledger_serial_idx
  ON stock_ledger(tenant_id, serial_id)
  WHERE serial_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Per-line tracking input (captured at draft, consumed at post)
-- ---------------------------------------------------------------------------
-- Shape is the same on both inbound (bill_lines) and outbound
-- (invoice_lines), though the meaningful keys differ:
--   inbound: {batchNumber, mfgDate, expiryDate, serialNumbers[]}
--   outbound: {serialNumbers[], batchPicks[]}
-- Stored as JSONB so the shape can grow (warranty override, lot cost
-- override) without another migration. App validates the shape.
ALTER TABLE bill_lines
  ADD COLUMN IF NOT EXISTS tracking_input jsonb;
ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS tracking_input jsonb;
