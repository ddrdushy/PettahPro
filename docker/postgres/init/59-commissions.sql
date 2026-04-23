-- Commission engine v1 (roadmap #29)
--
-- Tiered + flat + on-collection sales-commission accrual, with payroll hand-off.
--
-- Shape:
--   commission_salespeople  — link a user to an employee (payroll hand-off)
--   commission_rules        — tenant-defined rules (formula + scope + trigger)
--   commission_earnings     — one row per (rule, source_document) accrual;
--                             positive = earned, negative = claw-back
--   invoices.salesperson_user_id — the tag that drives attribution
--
-- Accrual triggers (wired in the API layer, not here):
--   · invoice.post         → evaluate rules with trigger_event='invoice_posted'
--   · credit_note.post     → insert claw-back rows against matching earnings
--                            (proportional to the CN amount vs original invoice)
--   · payment.record       → evaluate rules with trigger_event='payment_received'
--                            against each allocated invoice
--
-- Formulas supported in v1:
--   · flat_pct        — config {"bps": N}           — amount = base × N / 10_000
--   · tiered_volume   — config {"tiers": [{upToCents,bps}…]}
--                       marginal by month-to-date salesperson volume
--
-- Filters (all optional, applied as AND; NULL = no filter, matches everything):
--   · salesperson_user_ids  — restrict rule to N salespeople
--   · item_ids              — only lines containing these items contribute base
--   · customer_ids          — only these customers trigger
--
-- Payroll integration:
--   · GET /commissions/earnings?status=accrued&upTo=<periodEnd> is summed per
--     employee when a payroll run draft is created. The run claim atomically
--     stamps paid_in_run_id so a subsequent run can't double-pay. On voidRun,
--     reset paid_in_run_id = NULL.
--
-- Idempotent.

-- =============================================================================
-- 1. commission_salespeople — user ↔ employee link (optional employee)
-- =============================================================================

CREATE TABLE IF NOT EXISTS commission_salespeople (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  employee_id        uuid REFERENCES employees(id)        ON DELETE SET NULL,
  is_active          boolean NOT NULL DEFAULT true,
  default_rate_bps   integer,  -- quick-set flat rate when no rule scoped to them
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS commission_salespeople_employee_idx
  ON commission_salespeople (tenant_id, employee_id)
  WHERE employee_id IS NOT NULL;

ALTER TABLE commission_salespeople ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_salespeople FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commission_salespeople_rw ON commission_salespeople;
CREATE POLICY commission_salespeople_rw ON commission_salespeople
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 2. commission_rules — the rule engine
-- =============================================================================

CREATE TABLE IF NOT EXISTS commission_rules (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    varchar(120) NOT NULL,
  description             text,
  status                  varchar(12) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'inactive')),
  -- When does this rule fire?
  --   invoice_posted   — at invoice.post (commission accrues immediately)
  --   payment_received — at payment.record (commission on collection)
  trigger_event           varchar(24) NOT NULL
                            CHECK (trigger_event IN ('invoice_posted', 'payment_received')),
  -- Formula: how the amount is computed.
  formula                 varchar(24) NOT NULL
                            CHECK (formula IN ('flat_pct', 'tiered_volume')),
  -- Formula-specific config (see comment at top of file for shapes).
  config                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Scope filters (NULL = unrestricted).
  salesperson_user_ids    jsonb,   -- array of user_id strings
  item_ids                jsonb,   -- array of item_id strings
  customer_ids            jsonb,   -- array of customer_id strings
  -- Lifecycle dates. effective_from <= entry_date <= effective_to (inclusive).
  effective_from          date NOT NULL DEFAULT CURRENT_DATE,
  effective_to            date,
  -- Priority for deterministic ordering in rule picker. Lower = earlier.
  priority                smallint NOT NULL DEFAULT 100,
  -- Meta
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at              timestamptz
);

CREATE INDEX IF NOT EXISTS commission_rules_tenant_status_idx
  ON commission_rules (tenant_id, status, trigger_event, priority)
  WHERE deleted_at IS NULL;

ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commission_rules_rw ON commission_rules;
CREATE POLICY commission_rules_rw ON commission_rules
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 3. commission_earnings — accrual ledger
-- =============================================================================

CREATE TABLE IF NOT EXISTS commission_earnings (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id                 uuid NOT NULL REFERENCES commission_rules(id) ON DELETE RESTRICT,
  salesperson_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Source document that created this accrual. The triples (source_type, source_id)
  -- + rule_id form a natural uniqueness constraint so duplicate triggers no-op.
  source_type             varchar(20) NOT NULL
                            CHECK (source_type IN ('invoice', 'payment', 'credit_note')),
  source_id               uuid NOT NULL,
  source_number           varchar(48),       -- for display
  customer_id             uuid REFERENCES customers(id) ON DELETE SET NULL,
  -- Monetary fields (LKR cents — ledger stays single-currency for v1; foreign
  -- invoices contribute at their LKR-equivalent total_cents which was already
  -- fx-normalized at posting time).
  base_cents              bigint NOT NULL,   -- sale value or collection amount
  rate_bps                integer NOT NULL,  -- effective rate (average for tiered)
  amount_cents            bigint NOT NULL,   -- signed: positive earn, negative claw-back
  -- Lifecycle
  status                  varchar(16) NOT NULL DEFAULT 'accrued'
                            CHECK (status IN ('accrued', 'paid', 'clawed_back', 'voided')),
  earned_at               date NOT NULL,     -- the invoice/payment date
  paid_in_run_id          uuid REFERENCES payroll_runs(id) ON DELETE SET NULL,
  clawback_of_earning_id  uuid REFERENCES commission_earnings(id) ON DELETE SET NULL,
  memo                    text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Dedup: one earning per (rule, source) pair. Claw-back rows carry their own
-- rule (cloned from the original earning) + source=credit_note so they don't
-- collide with the positive row.
CREATE UNIQUE INDEX IF NOT EXISTS commission_earnings_rule_source_uniq
  ON commission_earnings (rule_id, source_type, source_id);

CREATE INDEX IF NOT EXISTS commission_earnings_sp_status_idx
  ON commission_earnings (tenant_id, salesperson_user_id, status, earned_at);

CREATE INDEX IF NOT EXISTS commission_earnings_paid_run_idx
  ON commission_earnings (paid_in_run_id)
  WHERE paid_in_run_id IS NOT NULL;

ALTER TABLE commission_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_earnings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commission_earnings_rw ON commission_earnings;
CREATE POLICY commission_earnings_rw ON commission_earnings
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 4. invoices.salesperson_user_id — attribution tag
-- =============================================================================

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS salesperson_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_salesperson_idx
  ON invoices (tenant_id, salesperson_user_id, issue_date DESC)
  WHERE salesperson_user_id IS NOT NULL;

-- =============================================================================
-- 5. updated_at triggers
-- =============================================================================

CREATE OR REPLACE FUNCTION commission_rules_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commission_rules_updated_at ON commission_rules;
CREATE TRIGGER commission_rules_updated_at
  BEFORE UPDATE ON commission_rules
  FOR EACH ROW EXECUTE FUNCTION commission_rules_set_updated_at();

CREATE OR REPLACE FUNCTION commission_salespeople_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commission_salespeople_updated_at ON commission_salespeople;
CREATE TRIGGER commission_salespeople_updated_at
  BEFORE UPDATE ON commission_salespeople
  FOR EACH ROW EXECUTE FUNCTION commission_salespeople_set_updated_at();

CREATE OR REPLACE FUNCTION commission_earnings_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commission_earnings_updated_at ON commission_earnings;
CREATE TRIGGER commission_earnings_updated_at
  BEFORE UPDATE ON commission_earnings
  FOR EACH ROW EXECUTE FUNCTION commission_earnings_set_updated_at();

-- =============================================================================
-- 6. Seed a COMMISSION salary component per tenant (payroll integration)
-- =============================================================================
--
-- This is the earnings line that shows up on the payslip when commission
-- earnings for the payroll period get rolled up. Counts for EPF/ETF/PAYE per
-- SL convention (commission is part of gross remuneration).

INSERT INTO salary_components
  (tenant_id, code, name, kind, calculation_basis, default_amount_cents,
   counts_for_epf, counts_for_etf, counts_for_paye, sort_order, is_active)
SELECT t.id, 'COMMISSION', 'Sales commission', 'earning', 'fixed', 0,
       true, true, true, 80, true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM salary_components s
  WHERE s.tenant_id = t.id AND s.code = 'COMMISSION' AND s.deleted_at IS NULL
);

-- Extend the tenant-signup hook so new tenants get the component seeded.
CREATE OR REPLACE FUNCTION seed_commission_defaults_for_tenant(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO salary_components
    (tenant_id, code, name, kind, calculation_basis, default_amount_cents,
     counts_for_epf, counts_for_etf, counts_for_paye, sort_order, is_active)
  VALUES
    (p_tenant_id, 'COMMISSION', 'Sales commission', 'earning', 'fixed', 0,
     true, true, true, 80, true)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 7. Grants (guarded for envs without the app role)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pettahpro_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON commission_rules       TO pettahpro_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON commission_salespeople TO pettahpro_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON commission_earnings    TO pettahpro_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION seed_commission_defaults_for_tenant(uuid) TO pettahpro_app';
  END IF;
END
$$;
