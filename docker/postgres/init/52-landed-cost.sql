-- Landed cost allocation (buy-module-spec §16.2, inventory-module-spec §5.4,
-- roadmap #9).
--
-- Captures freight / insurance / customs / clearing / loading / other charges
-- as extra lines on a supplier Bill. At post time those amounts are allocated
-- pro-rata across the bill's inventory lines (by value or by quantity) and
-- folded into each item's unit cost before the stock receipt posts, so WAVG
-- reflects the true landed cost. Charges on a bill with no inventory lines
-- expense to a fallback '5130 Freight & handling' account (rare path —
-- freight-only clearing-agent invoices).
--
-- v1 scope (matches the architecture where stock + AP both post at Bill,
-- not GRN):
--   · Charges live on the Bill, entered alongside item lines
--   · Two allocation methods: 'value' (default) and 'quantity'
--   · Journal stays balanced: DR Inventory grows by (base + allocated), CR
--     AP grows by the same delta
--
-- v2 follow-ups (explicitly deferred — see roadmap #9b once scoped):
--   · Post-GRN retrospective landed-cost bills linking to an earlier GRN
--     with a Landed Cost Variance account for WAVG retro-adjustment
--   · Pro-rata by weight (needs items.weight_per_unit)
--   · Per-line manual allocation override
--   · FX-tied landed cost (waits for #17/18 multi-currency)
--
-- Idempotent: every DDL uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS. Safe
-- to re-run.

-- 1. Bill-level columns -------------------------------------------------------

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS charge_allocation_method varchar(16) NOT NULL DEFAULT 'value';

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS charges_total_cents bigint NOT NULL DEFAULT 0;

-- Enforce valid allocation method values. DROP first so the CHECK can be
-- added idempotently (ALTER TABLE ... ADD CONSTRAINT errors if it already
-- exists).
ALTER TABLE bills
  DROP CONSTRAINT IF EXISTS bills_charge_allocation_method_check;
ALTER TABLE bills
  ADD CONSTRAINT bills_charge_allocation_method_check
  CHECK (charge_allocation_method IN ('value', 'quantity'));


-- 2. Charges table ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bill_charges (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bill_id         uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  line_no         smallint NOT NULL,
  kind            varchar(20) NOT NULL,
    -- 'freight' | 'insurance' | 'customs' | 'clearing' | 'loading' | 'other'
  description     varchar(500),
  amount_cents    bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bill_charges_kind_check CHECK (
    kind IN ('freight','insurance','customs','clearing','loading','other')
  ),
  CONSTRAINT bill_charges_amount_check CHECK (amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_charges_bill
  ON bill_charges (tenant_id, bill_id, line_no);

ALTER TABLE bill_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_charges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bill_charges_isolation ON bill_charges;
CREATE POLICY bill_charges_isolation ON bill_charges
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());


-- 3. CoA backfill: 5130 Freight & handling ------------------------------------
--
-- Used only when a bill has charges but no inventory lines (e.g. a clearing-
-- agent bill with freight only). Normal case: charges capitalize into the
-- inventory lines' unit cost and never touch this account.

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);

    IF NOT EXISTS (
      SELECT 1 FROM chart_of_accounts
      WHERE tenant_id = t.id AND code = '5130' AND deleted_at IS NULL
    ) THEN
      INSERT INTO chart_of_accounts
        (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
      VALUES
        (t.id, '5130', 'Freight & handling', 'expense', 'cogs', 'dr', true);
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
