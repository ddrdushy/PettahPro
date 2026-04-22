-- Physical stock count (cycle count) — per inventory-module-spec §4.4.
--
-- Lifecycle
-- ---------
--   draft              → user picks scope (whole warehouse / specific items)
--                        and the app snapshots system_qty + system_avg_cost
--                        for every item in scope at count-start. Counter
--                        enters counted_qty per line (blind: the UI hides
--                        system_qty until review).
--   review             → all lines have counted_qty; the app computes
--                        variance_qty + variance_value_cents per line and
--                        max_variance_bps across the count. At this point
--                        the user classifies each non-zero variance line
--                        with a reason_code.
--   pending_approval   → if max |variance_qty / system_qty| > tenant
--                        threshold (variance_threshold_bps on the header;
--                        default 1% = 100 bps), the count must be approved
--                        by someone other than the counter/creator before
--                        it can post. Same SOD pattern as JE approvals.
--   posted             → one batch journal entry books the net adjustment
--                        (Dr Inventory / Cr Stock gain for a net positive,
--                        or Dr Stock loss / Cr Inventory for a net negative;
--                        mixed counts split across both legs). Each line
--                        with a non-zero variance writes its own stock_ledger
--                        row (movement_type = adjustment_positive | _negative)
--                        and updates item_balances via the same WAVG helpers
--                        that bills and invoices use. Count row becomes
--                        immutable audit record.
--   cancelled          → draft/review only. Post-post reversal would need a
--                        compensating adjustment (separate doc).
--
-- Why a whole new module vs. "just a stock adjustment form"
-- ---------------------------------------------------------
-- A count is a physical-reality-vs-books reconciliation event, not just
-- a variance entry: we need the snapshot, the blind-count mechanic, the
-- per-line reason classification, and the immutable audit. Ad-hoc stock
-- adjustments (§4.3) can land as a simpler form later on top of the same
-- GL plumbing this file adds — they'll share stock_gain / stock_loss
-- accounts and the adjustment_positive/negative ledger movement types.

-- ------------------------------------------------------------------------------
-- GL accounts the post-count journal needs. Seeded once per existing tenant;
-- new tenants will pick these up via the updated seed_tenant_defaults below.
-- ------------------------------------------------------------------------------
INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
SELECT t.id, '4950', 'Stock gain (adjustments)', 'income', 'stock_adjustment', 'cr', true
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM chart_of_accounts c
    WHERE c.tenant_id = t.id AND c.account_subtype = 'stock_adjustment' AND c.account_type = 'income'
 );

INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
SELECT t.id, '5100', 'Stock loss (adjustments)', 'expense', 'stock_adjustment', 'dr', true
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM chart_of_accounts c
    WHERE c.tenant_id = t.id AND c.account_subtype = 'stock_adjustment' AND c.account_type = 'expense'
 );

-- Extend the signup seed so new tenants get both accounts on day one. Drops
-- in after the existing expense block; safe to re-run — the insert-from-select
-- above is idempotent on account_subtype.
CREATE OR REPLACE FUNCTION seed_tenant_stock_adjustment_accounts(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);

  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
  SELECT p_tenant_id, '4950', 'Stock gain (adjustments)', 'income', 'stock_adjustment', 'cr', true
   WHERE NOT EXISTS (
     SELECT 1 FROM chart_of_accounts
      WHERE tenant_id = p_tenant_id AND account_subtype = 'stock_adjustment' AND account_type = 'income'
   );

  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
  SELECT p_tenant_id, '5100', 'Stock loss (adjustments)', 'expense', 'stock_adjustment', 'dr', true
   WHERE NOT EXISTS (
     SELECT 1 FROM chart_of_accounts
      WHERE tenant_id = p_tenant_id AND account_subtype = 'stock_adjustment' AND account_type = 'expense'
   );
END;
$$;

-- Document-number sequence for stock counts: SC-2026-0001 style.
INSERT INTO document_sequences (tenant_id, sequence_name, prefix, scope, pad_width)
SELECT t.id, 'stock_count', 'SC', 'year', 4
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM document_sequences d
    WHERE d.tenant_id = t.id AND d.sequence_name = 'stock_count'
 );

-- ------------------------------------------------------------------------------
-- stock_counts — the header.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_counts (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  count_number              varchar(48),
  warehouse_id              uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  scope_type                varchar(16) NOT NULL DEFAULT 'warehouse',  -- 'warehouse' | 'items'
  count_date                date NOT NULL,
  status                    varchar(20) NOT NULL DEFAULT 'draft',
  -- Blind-count toggle (v1: always true — kept as a column so tenants can
  -- turn it off later without a migration).
  blind_count               boolean NOT NULL DEFAULT true,
  -- Tenant-configurable threshold above which the count must go through
  -- approval. Stored per-count so a change to the tenant default doesn't
  -- retroactively flip older counts. Default 1% in basis points.
  variance_threshold_bps    integer NOT NULL DEFAULT 100,
  -- Computed at review / post. max_variance_bps = max over lines of
  -- abs(variance_qty / system_qty) × 10000. total_variance_value_cents is
  -- signed (positive = net gain, negative = net loss).
  max_variance_bps          integer,
  total_variance_value_cents bigint,
  requires_approval         boolean NOT NULL DEFAULT false,

  counted_at                timestamptz,                          -- when last line was counted
  reviewed_at               timestamptz,                          -- when user moved draft → review
  posted_at                 timestamptz,
  posted_by_user_id         uuid,
  approved_at               timestamptz,
  approved_by_user_id       uuid,
  cancelled_at              timestamptz,
  cancelled_reason          text,
  journal_entry_id          uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  notes                     text,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by_user_id        uuid,
  deleted_at                timestamptz,

  CONSTRAINT stock_count_status_check CHECK (
    status IN ('draft','review','pending_approval','posted','cancelled')
  ),
  CONSTRAINT stock_count_scope_check CHECK (
    scope_type IN ('warehouse','items')
  )
);

CREATE INDEX IF NOT EXISTS stock_counts_tenant_status
  ON stock_counts(tenant_id, status, count_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS stock_counts_tenant_warehouse
  ON stock_counts(tenant_id, warehouse_id, count_date DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_counts_isolation ON stock_counts;
CREATE POLICY stock_counts_isolation ON stock_counts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ------------------------------------------------------------------------------
-- stock_count_lines — one per item in scope.
--
-- system_qty + system_avg_cost_cents are snapshotted at count-start so even if
-- bills / invoices post during the count, variance is computed against the
-- "books as of start". counted_qty stays NULL until a counter enters it; the
-- blind-count UI reveals system_qty only after it's filled in. reason_code
-- becomes mandatory on any line with a non-zero variance at review time.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_count_lines (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stock_count_id            uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  line_no                   smallint NOT NULL,
  item_id                   uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  system_qty                numeric(18,4) NOT NULL,
  system_avg_cost_cents     bigint NOT NULL,
  counted_qty               numeric(18,4),               -- null until counted
  variance_qty              numeric(18,4),               -- signed, computed
  variance_value_cents      bigint,                      -- signed, computed
  reason_code               varchar(32),                 -- required on variance != 0
  notes                     varchar(500),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_count_lines_header
  ON stock_count_lines(stock_count_id, line_no);
CREATE UNIQUE INDEX IF NOT EXISTS stock_count_lines_unique_item
  ON stock_count_lines(stock_count_id, item_id);

ALTER TABLE stock_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_count_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_count_lines_isolation ON stock_count_lines;
CREATE POLICY stock_count_lines_isolation ON stock_count_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Reason code catalog is v1-hardcoded in the application layer (the
-- constants list matches the SL-typical set from inventory-spec §4.3:
-- damage / theft / expiry / shrinkage / miscount / sample / system_error /
-- other). A tenant-configurable table can slot in later without touching the
-- stock_count schema — reason_code is just a varchar here on purpose.
