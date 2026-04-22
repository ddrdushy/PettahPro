-- FX revaluation at period close (roadmap #44, follow-up to PR #61)
--
-- PR #61 shipped multi-currency on invoices / bills / credit+debit notes /
-- payments: every document carries `currency` + `fx_rate` + `foreign_total_cents`
-- alongside the LKR ledger amount. The ledger stays in LKR at the issue-date rate.
--
-- What was deferred: when the LKR/USD rate moves between issue and period end,
-- the foreign AR/AP on the balance sheet is no longer a true LKR representation.
-- At month-end, standard accounting (LKAS 21 / IFRS equivalent) requires
-- re-measuring open foreign monetary items at the closing rate and booking the
-- delta to Unrealized FX gain/loss — an income-statement line that's reversed
-- at the start of the next period (or incrementally replaced by the next run,
-- which is what we do here to keep the ledger clean without a separate
-- reversing step).
--
-- Seeded COA (this migration):
--   · 4510 Unrealized FX gain (income / other_income)
--   · 5510 Unrealized FX loss (expense / fx_loss)
--   Existing 4500 / 5500 (PR #61) continue to hold *realized* FX — on-settlement
--   differences when a foreign invoice is paid into an LKR bank at a new rate.
--   That settlement path is still deferred (see 54-multi-currency.sql v2 list).
--
-- Tables (this migration):
--   · fx_revaluations       — header per run (one per as-of date; enforced unique).
--   · fx_revaluation_lines  — per-document audit trail showing the math.
--
-- Run lifecycle:
--   draft    — preview computed, no GL posting yet.
--   posted   — journal_entry_id set, adjustment booked.
--   voided   — reversing JE posted, cumulative deltas of this run removed from
--              the baseline so the next run recomputes correctly.
--
-- Incremental-delta semantics:
--   Each line tracks `cumulative_delta_cents` (LKR delta from issue-date rate to
--   as-of rate) and `previous_cumulative_delta_cents` (what the last posted run
--   for the same document booked). The JE posts only the *incremental* change,
--   so each new revaluation naturally supersedes prior ones — no separate
--   month-start reversal needed.
--
-- v1 scope: invoices + bills only. Credit notes and debit notes are already
-- outside the "open balance" concept unless explicitly allocated to an invoice
-- (they float). Revaluing unapplied credit/debit notes is a v2 item — their
-- dollar impact is typically small and the UX of tracking unapplied CN float
-- needs its own pass first.
--
-- Permission: accounting.manage (see apps/api/src/lib/permissions.ts).
-- Period lock: the JE posts dated as_of_date — if that period is already
-- closed, postJournal will reject, matching existing month-end behaviour.

-- =============================================================================
-- Seed the unrealized FX accounts per tenant (backfill + signup hook).
-- =============================================================================

INSERT INTO chart_of_accounts
  (tenant_id, code, name, account_type, account_subtype, normal_side, is_system, is_active, currency)
SELECT t.id, a.code, a.name, a.account_type, a.account_subtype, a.normal_side, true, true, 'LKR'
FROM tenants t
CROSS JOIN (VALUES
  ('4510', 'Unrealized FX gain', 'income',  'other_income', 'cr'),
  ('5510', 'Unrealized FX loss', 'expense', 'fx_loss',      'dr')
) AS a(code, name, account_type, account_subtype, normal_side)
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.code = a.code
);

-- Extend the existing signup hook so new tenants get these too. Re-created
-- with both realized (4500/5500) and unrealized (4510/5510) pairs.
CREATE OR REPLACE FUNCTION seed_fx_accounts_for_tenant(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO chart_of_accounts
    (tenant_id, code, name, account_type, account_subtype, normal_side, is_system, is_active, currency)
  VALUES
    (p_tenant_id, '4500', 'Realized FX gain',   'income',  'other_income', 'cr', true, true, 'LKR'),
    (p_tenant_id, '5500', 'Realized FX loss',   'expense', 'fx_loss',      'dr', true, true, 'LKR'),
    (p_tenant_id, '4510', 'Unrealized FX gain', 'income',  'other_income', 'cr', true, true, 'LKR'),
    (p_tenant_id, '5510', 'Unrealized FX loss', 'expense', 'fx_loss',      'dr', true, true, 'LKR')
  ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- fx_revaluations — header per run
-- =============================================================================

CREATE TABLE IF NOT EXISTS fx_revaluations (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  as_of_date          date NOT NULL,
  status              varchar(16) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'posted', 'voided')),
  -- Aggregate totals (LKR cents). Signed: positive = gain side, negative = loss side.
  ar_gain_cents       bigint NOT NULL DEFAULT 0,
  ar_loss_cents       bigint NOT NULL DEFAULT 0,
  ap_gain_cents       bigint NOT NULL DEFAULT 0,
  ap_loss_cents       bigint NOT NULL DEFAULT 0,
  -- Per-currency summary for display; shape: { "USD": {openLkr, openForeign, asOfRate, deltaLkr}, ... }
  currency_summary    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Posting linkage
  journal_entry_id    uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  void_journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  posted_at           timestamptz,
  posted_by_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  voided_at           timestamptz,
  voided_by_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  void_reason         text
);

-- One non-voided revaluation per (tenant, as_of_date). Voided runs can be
-- re-run because we wipe their contribution from future cumulatives.
CREATE UNIQUE INDEX IF NOT EXISTS fx_revaluations_tenant_as_of_active_unique
  ON fx_revaluations (tenant_id, as_of_date)
  WHERE status <> 'voided';

CREATE INDEX IF NOT EXISTS fx_revaluations_tenant_status_idx
  ON fx_revaluations (tenant_id, status, as_of_date DESC);

ALTER TABLE fx_revaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_revaluations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_revaluations_rw ON fx_revaluations;
CREATE POLICY fx_revaluations_rw ON fx_revaluations
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- fx_revaluation_lines — per-document audit trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS fx_revaluation_lines (
  id                              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  revaluation_id                  uuid NOT NULL REFERENCES fx_revaluations(id) ON DELETE CASCADE,
  -- Which document did we revalue?
  source_type                     varchar(16) NOT NULL
                                    CHECK (source_type IN ('invoice', 'bill')),
  source_id                       uuid NOT NULL,
  -- Snapshot of the document at as-of time
  currency                        varchar(3) NOT NULL,
  issue_fx_rate                   numeric(18,6) NOT NULL,
  foreign_outstanding_cents       bigint NOT NULL,
  lkr_on_ledger_cents             bigint NOT NULL,
  as_of_rate                      numeric(18,6) NOT NULL,
  lkr_at_as_of_cents              bigint NOT NULL,
  -- Delta math
  cumulative_delta_cents          bigint NOT NULL,
  previous_cumulative_delta_cents bigint NOT NULL DEFAULT 0,
  incremental_delta_cents         bigint NOT NULL,
  -- is this an AR or AP line? (derived from source_type but stored for fast aggregation)
  direction                       varchar(2) NOT NULL
                                    CHECK (direction IN ('ar', 'ap')),
  created_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_revaluation_lines_revaluation_idx
  ON fx_revaluation_lines (revaluation_id);

CREATE INDEX IF NOT EXISTS fx_revaluation_lines_source_idx
  ON fx_revaluation_lines (tenant_id, source_type, source_id);

ALTER TABLE fx_revaluation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_revaluation_lines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_revaluation_lines_rw ON fx_revaluation_lines;
CREATE POLICY fx_revaluation_lines_rw ON fx_revaluation_lines
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
