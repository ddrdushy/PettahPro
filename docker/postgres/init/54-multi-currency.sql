-- Multi-currency infrastructure (sell-spec §17, accounting-spec §4.1, roadmap #17 + #18)
--
-- Sri Lankan SMEs increasingly invoice regional clients in USD / EUR / GBP
-- and hold foreign-currency bank accounts for exporter receipts. This
-- migration adds the infrastructure and visible surface for multi-currency
-- transactions without moving the ledger off LKR.
--
-- v1 scope (this migration):
--   · `chart_of_accounts.currency` already exists — expose it in the UI so
--     bank/cash accounts can be USD / EUR / GBP.
--   · `invoices.currency` + `invoices.fx_rate` already exist. Backfill the
--     same columns on credit_notes, debit_notes, customer payments, and
--     supplier payments (all default 'LKR' / 1.0) so every transaction row
--     can answer "what currency was this in, at what rate."
--   · `fx_rates` table — tenant-scoped daily rate history. Manual entry in
--     v1 (no external rate API). Primary key guards against duplicate rates
--     on the same (from, to, date).
--   · Seed `4500 Realized FX gain` (income) + `5500 Realized FX loss`
--     (expense) accounts per tenant so the ledger has somewhere to book FX
--     differences when settlement math lands in v2.
--
-- IMPORTANT: `amount_cents` on every transaction table continues to hold
-- BASE-CURRENCY cents (LKR). `currency` + `fx_rate` are DISPLAY metadata
-- and the source of truth for what the customer/supplier sees on the PDF.
-- The ledger stays in LKR for v1 — realized FX gain/loss at settlement
-- time and multi-currency report translation are v2 work (see roadmap
-- deferrals).
--
-- v2 follow-ups (deferred — do NOT quietly add them to v1):
--   · Cross-currency settlement: when a USD invoice is paid into an LKR
--     bank at a different rate than the issue date, auto-post the
--     difference to 4500 / 5500.
--   · Multi-currency P&L / Balance Sheet translation for foreign-currency
--     bank accounts (revaluation at report date).
--   · Line-level foreign pricing (currently headers carry the rate; lines
--     are LKR-only).
--   · External rate auto-lookup (cbsl.gov.lk / exchangerate.host daily
--     feed), alerts when today's rate deviates >2% from the captured one.
--   · Base-currency override per tenant (LKR-hardcoded in v1).

-- Backfill fx_rate on tables that have `currency` but no `fx_rate`
ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS fx_rate numeric(18,6) NOT NULL DEFAULT 1.0;
ALTER TABLE debit_notes
  ADD COLUMN IF NOT EXISTS fx_rate numeric(18,6) NOT NULL DEFAULT 1.0;
ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS fx_rate numeric(18,6) NOT NULL DEFAULT 1.0;
ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS fx_rate numeric(18,6) NOT NULL DEFAULT 1.0;

-- Also add foreign_amount_cents on transaction headers so the foreign
-- amount shown on the PDF is stored alongside the LKR base amount rather
-- than re-derived (lossy when the rate has rounding).
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS foreign_total_cents bigint;
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS foreign_total_cents bigint;
ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS foreign_total_cents bigint;
ALTER TABLE debit_notes
  ADD COLUMN IF NOT EXISTS foreign_total_cents bigint;
ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS foreign_amount_cents bigint;
ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS foreign_amount_cents bigint;

-- FX rate history — manual entry in v1. Used for display lookups on new
-- transactions, and for future revaluation runs.
CREATE TABLE IF NOT EXISTS fx_rates (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_currency      varchar(3) NOT NULL,
  to_currency        varchar(3) NOT NULL,
  rate_date          date NOT NULL,
  rate               numeric(18,6) NOT NULL,
  source             varchar(32) NOT NULL DEFAULT 'manual',
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  CONSTRAINT fx_rates_rate_positive CHECK (rate > 0),
  CONSTRAINT fx_rates_diff_currencies CHECK (from_currency <> to_currency),
  CONSTRAINT fx_rates_tenant_pair_date_unique
    UNIQUE (tenant_id, from_currency, to_currency, rate_date)
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_tenant_date
  ON fx_rates (tenant_id, rate_date DESC);

ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_rates_tenant_isolation ON fx_rates;
CREATE POLICY fx_rates_tenant_isolation ON fx_rates
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Seed FX gain/loss accounts per tenant. Idempotent — skipped if already
-- present (by code).
INSERT INTO chart_of_accounts
  (tenant_id, code, name, account_type, account_subtype, normal_side, is_system, is_active, currency)
SELECT t.id, a.code, a.name, a.account_type, a.account_subtype, a.normal_side, true, true, 'LKR'
FROM tenants t
CROSS JOIN (VALUES
  ('4500', 'Realized FX gain', 'income', 'other_income', 'cr'),
  ('5500', 'Realized FX loss', 'expense', 'fx_loss', 'dr')
) AS a(code, name, account_type, account_subtype, normal_side)
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.code = a.code
);

-- Signup hook: ensure new tenants get FX accounts too. The existing
-- seed_defaults_for_tenant function in 07-seed-defaults.sql handles the
-- standard chart; we extend it here rather than edit that file so this
-- migration stays self-contained.
CREATE OR REPLACE FUNCTION seed_fx_accounts_for_tenant(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO chart_of_accounts
    (tenant_id, code, name, account_type, account_subtype, normal_side, is_system, is_active, currency)
  VALUES
    (p_tenant_id, '4500', 'Realized FX gain',  'income',  'other_income', 'cr', true, true, 'LKR'),
    (p_tenant_id, '5500', 'Realized FX loss',  'expense', 'fx_loss',      'dr', true, true, 'LKR')
  ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
