-- POS terminal v1 (roadmap #28)
--
-- Shift-based retail POS. Each shift = one cashier at one branch between an
-- opening cash count and a closing cash count. Sales posted during the shift
-- go through the normal invoice + customer_payment plumbing — POS is just a
-- different UI surface and a different pay-now default. The shift row is what
-- makes end-of-day cash reconciliation possible.
--
-- What this migration adds:
--   1. pos_shifts table (open/close header with denominations, variance, Z-ref)
--   2. invoices.channel = 'web' | 'pos' (so the sales list can filter/report)
--   3. customer_payments.pos_shift_id — link tenders to a shift for the Z close
--   4. chart_of_accounts seed for 5190 Cash Over/Short (variance posting target)
--   5. RLS + signup hook updates
--
-- Scope notes (v1):
--   · One open shift per (tenant, branch, cashier) enforced by unique partial.
--   · Walk-in customer — seeded per tenant with code 'WALKIN', used as default
--     for cash sales so the existing invoice.customer_id NOT NULL invariant
--     holds without special-casing in the invoice module.
--   · Variance posting: DR 5190 (short) or CR 5190 (over) with the other leg
--     on the bank/cash account. No separate approval path in v1 — supervisor
--     sign-off is captured as a text field for now.
--
-- Idempotent.

-- =============================================================================
-- 1. pos_shifts header
-- =============================================================================

CREATE TABLE IF NOT EXISTS pos_shifts (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id                uuid REFERENCES branches(id) ON DELETE SET NULL,
  cashier_user_id          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status                   varchar(12) NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open', 'closed')),
  -- Opening
  opened_at                timestamptz NOT NULL DEFAULT now(),
  opening_float_cents      bigint NOT NULL DEFAULT 0 CHECK (opening_float_cents >= 0),
  opening_notes            text,
  -- Bank/cash account the float belongs to. For most SL SMEs this is the
  -- till/petty-cash account (e.g. 1020 Cash on hand), not a bank account.
  cash_account_id          uuid REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  -- Closing
  closed_at                timestamptz,
  closed_by_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Denomination breakdown captured at close. Shape:
  --   { "5000": 12, "1000": 30, "500": 40, "100": 25, "50": 10, "20": 5, "coins_cents": 45500 }
  -- (keys are note values in LKR; 'coins_cents' for the fiddly bits.)
  closing_denominations    jsonb,
  closing_cash_cents       bigint,          -- physical count total
  expected_cash_cents      bigint,          -- opening_float + cash in − cash out
  variance_cents           bigint,          -- closing - expected (positive = over, negative = short)
  variance_reason_code     varchar(32),     -- change_error | theft_suspicion | miscount | other
  variance_reason_notes    text,
  variance_journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  supervisor_signature     text,            -- captured as free-text name for v1
  -- Meta
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- One open shift per (tenant, branch, cashier). Closed shifts unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_one_open_per_cashier
  ON pos_shifts (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), cashier_user_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS pos_shifts_tenant_status_idx
  ON pos_shifts (tenant_id, status, opened_at DESC);

ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_shifts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_shifts_rw ON pos_shifts;
CREATE POLICY pos_shifts_rw ON pos_shifts
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 2. invoices.channel  (web | pos)
-- =============================================================================

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS channel varchar(16) NOT NULL DEFAULT 'web';

-- Guard valid values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_channel_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_channel_check CHECK (channel IN ('web', 'pos'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS invoices_tenant_channel_idx
  ON invoices (tenant_id, channel, issue_date DESC)
  WHERE channel = 'pos';

-- =============================================================================
-- 3. customer_payments.pos_shift_id  (for Z-close aggregation)
-- =============================================================================

ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS pos_shift_id uuid REFERENCES pos_shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS customer_payments_pos_shift_idx
  ON customer_payments (pos_shift_id)
  WHERE pos_shift_id IS NOT NULL;

-- =============================================================================
-- 4. Seed 5190 Cash Over/Short (and walk-in customer) per tenant
-- =============================================================================

-- Cash Over/Short: an expense account that absorbs till-count variance.
-- Using 'admin_expense' subtype so it rolls into operating expenses on the P&L.
INSERT INTO chart_of_accounts
  (tenant_id, code, name, account_type, account_subtype, normal_side, is_system, is_active, currency)
SELECT t.id, '5190', 'Cash Over/Short', 'expense', 'admin_expense', 'dr', true, true, 'LKR'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.code = '5190'
);

-- Walk-in customer (for cash sales where no customer is attached).
-- Always one per tenant, code 'WALKIN'. Flagged as not emailable.
INSERT INTO customers (tenant_id, name, code, email, phone, is_active, created_at, updated_at)
SELECT t.id, 'Walk-in customer', 'WALKIN', NULL, NULL, true, now(), now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM customers c
  WHERE c.tenant_id = t.id AND c.code = 'WALKIN'
);

-- Extend the tenant-signup hook so new tenants get both the account and the
-- walk-in customer seeded automatically.
CREATE OR REPLACE FUNCTION seed_pos_defaults_for_tenant(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO chart_of_accounts
    (tenant_id, code, name, account_type, account_subtype, normal_side, is_system, is_active, currency)
  VALUES
    (p_tenant_id, '5190', 'Cash Over/Short', 'expense', 'admin_expense', 'dr', true, true, 'LKR')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO customers (tenant_id, name, code, is_active, created_at, updated_at)
  VALUES (p_tenant_id, 'Walk-in customer', 'WALKIN', true, now(), now())
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 5. updated_at trigger on pos_shifts (pattern used elsewhere)
-- =============================================================================

CREATE OR REPLACE FUNCTION pos_shifts_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pos_shifts_updated_at ON pos_shifts;
CREATE TRIGGER pos_shifts_updated_at
  BEFORE UPDATE ON pos_shifts
  FOR EACH ROW
  EXECUTE FUNCTION pos_shifts_set_updated_at();

-- Grants (guarded for envs without the app role).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pettahpro_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON pos_shifts TO pettahpro_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION seed_pos_defaults_for_tenant(uuid) TO pettahpro_app';
  END IF;
END
$$;
