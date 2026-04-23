-- Petty Cash Float (roadmap #38)
--
-- Per-branch operational cash floats that back shop-floor expenses,
-- staff advances, and quick purchases. A float has a ceiling, a single
-- named holder, a starting balance, and ends its life either by getting
-- closed out (remaining balance transferred back to a real cash/bank
-- account) or absorbed into a new float when the holder changes.
--
-- Shape — four tables wire the full lifecycle:
--
--   petty_cash_floats           — header: branch, holder, ceiling,
--                                  current_balance_cents (denormalised),
--                                  status ('active'|'closed').
--   petty_cash_transactions     — ledger: every movement (expense,
--                                  advance_out/return, top_up,
--                                  variance_short/over, close_transfer)
--                                  with a mandatory JE linkage.
--   petty_cash_top_up_requests  — workflow: holder requests → Owner /
--                                  Accountant approves → posts as a
--                                  `top_up` transaction against a
--                                  caller-chosen cash/bank source.
--   petty_cash_reconciliations  — EOD physical count records with
--                                  expected vs counted, variance booked
--                                  to 5190 Cash Over/Short.
--
-- Key design choices (mirrored in the API layer):
--
--   · **Single shared `1005 Petty Cash` asset account per tenant.** Every
--     float posts to the same GL account; per-float balance is tracked
--     denormalised on `petty_cash_floats.current_balance_cents`. Simpler
--     reporting than one COA account per float; per-float ledger is a
--     module-level report against `petty_cash_transactions`, not GL.
--     Code `1005` is unused in the seed CoA (the standard seed uses
--     `1000 Cash on hand`, `1010 Bank — primary`, `1020 Bank — cheques
--     in transit`, `1030 Bank — cheques in clearing`), so `1005` slots
--     in cleanly between cash-on-hand and bank-primary.
--
--   · **Floats are per-branch but NOT mandatory per-branch.** A tenant
--     can run floats on a subset of their branches. Partial unique
--     index `(tenant_id, branch_id) WHERE status='active'` enforces
--     one active float per branch at a time.
--
--   · **Float-holder is a single user per float.** Reassigning the
--     holder = close the old float and open a new one. Simpler audit
--     trail than tracking holder changes in-place.
--
--   · **LKR-only v1.** Petty cash is shop-floor operational; FX is
--     out of scope. No currency column on the tables.
--
--   · **JE-per-transaction.** Every petty-cash transaction posts its
--     own journal entry via the shared `postJournal` choke point.
--     Batching deferred to v2.
--
--   · **Variance on reconciliation posts to 5190 Cash Over/Short** —
--     same account the POS shift close uses (seeded in migration 58).
--
--   · **Attachments via `document_attachments`** — the entity-type
--     whitelist is widened below to allow `'petty_cash_transaction'`
--     so receipts can be attached to expense/advance rows using the
--     existing #32 infrastructure.
--
-- Fully idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS, DROP POLICY + CREATE POLICY, DO $$ LOOP seeding. Re-run the
-- file without error.

-- =============================================================================
-- 1. petty_cash_floats — header
-- =============================================================================

CREATE TABLE IF NOT EXISTS petty_cash_floats (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id                uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name                     varchar(120) NOT NULL,
  -- Single holder per float — reassignment = close + open new.
  float_holder_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ceiling_cents            bigint NOT NULL CHECK (ceiling_cents >= 0),
  -- Denormalised running balance — maintained atomically by every
  -- transaction/top-up/reconciliation inside the same DB tx. Every
  -- movement path must read-modify-write this column or it drifts.
  current_balance_cents    bigint NOT NULL DEFAULT 0,
  -- The tenant-scoped 1005 Petty Cash COA account. Seeded below; every
  -- float for a tenant points to the same row.
  petty_cash_account_id    uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  status                   varchar(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','closed')),
  opened_at                timestamptz NOT NULL DEFAULT now(),
  opened_by_user_id        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  closed_at                timestamptz,
  closed_by_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_reason            text,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

-- One active float per (tenant, branch). Partial so closed floats
-- don't block a fresh open on the same branch.
CREATE UNIQUE INDEX IF NOT EXISTS petty_cash_floats_one_active_per_branch
  ON petty_cash_floats(tenant_id, branch_id)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS petty_cash_floats_tenant_status_idx
  ON petty_cash_floats(tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS petty_cash_floats_holder_idx
  ON petty_cash_floats(tenant_id, float_holder_user_id)
  WHERE status = 'active' AND deleted_at IS NULL;

ALTER TABLE petty_cash_floats ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_floats FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS petty_cash_floats_tenant_isolation ON petty_cash_floats;
CREATE POLICY petty_cash_floats_tenant_isolation ON petty_cash_floats
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 2. petty_cash_transactions — ledger
-- =============================================================================

CREATE TABLE IF NOT EXISTS petty_cash_transactions (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  petty_cash_float_id      uuid NOT NULL REFERENCES petty_cash_floats(id) ON DELETE RESTRICT,
  -- Movement type. Sign is DERIVED from txn_type — amount_cents is
  -- always positive; the JE posting logic picks DR/CR accordingly.
  --   expense          → DR <category>  / CR petty cash (balance ↓)
  --   advance_out      → DR <staff_adv> / CR petty cash (balance ↓)
  --   advance_return   → DR petty cash  / CR <staff_adv> (balance ↑)
  --   top_up           → DR petty cash  / CR <cash_or_bank> (balance ↑)
  --   variance_short   → DR 5190        / CR petty cash (balance ↓)
  --   variance_over    → DR petty cash  / CR 5190 (balance ↑)
  --   close_transfer   → DR <dest_acct> / CR petty cash (balance → 0)
  txn_type                 varchar(24) NOT NULL
    CHECK (txn_type IN (
      'expense','advance_out','advance_return',
      'top_up','variance_short','variance_over','close_transfer'
    )),
  amount_cents             bigint NOT NULL CHECK (amount_cents > 0),
  txn_date                 date NOT NULL,
  description              text NOT NULL,
  -- Expense GL for expense-type rows, Staff Advances for advance-type
  -- rows. Nullable because top_up / variance_* / close_transfer use
  -- counterparty_account_id instead.
  category_account_id      uuid REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  counterparty_employee_id uuid REFERENCES employees(id) ON DELETE RESTRICT,
  -- Filled on top_up (cash/bank source) and close_transfer (dest).
  counterparty_account_id  uuid REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  receipt_number           varchar(64),
  -- Every posted petty-cash txn has a JE. ON DELETE RESTRICT keeps
  -- the ledger intact — hard-deleting a JE with a referencing txn
  -- row is blocked.
  journal_entry_id         uuid NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  posted_at                timestamptz NOT NULL DEFAULT now(),
  posted_by_user_id        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Void metadata. Voiding a txn posts a reversing JE (DR/CR swap)
  -- and points at it via void_journal_entry_id. Voided rows stay
  -- in the list (never deleted) so the audit trail is lossless.
  voided_at                timestamptz,
  voided_by_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  void_reason              text,
  void_journal_entry_id    uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  -- Reconciliation + top-up-request FKs are forward-declared below
  -- (tables don't exist yet at this point in the file).
  reconciliation_id        uuid,
  top_up_request_id        uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS petty_cash_transactions_float_date_idx
  ON petty_cash_transactions(tenant_id, petty_cash_float_id, txn_date DESC);

CREATE INDEX IF NOT EXISTS petty_cash_transactions_journal_idx
  ON petty_cash_transactions(journal_entry_id);

CREATE INDEX IF NOT EXISTS petty_cash_transactions_reconciliation_idx
  ON petty_cash_transactions(reconciliation_id)
  WHERE reconciliation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS petty_cash_transactions_top_up_request_idx
  ON petty_cash_transactions(top_up_request_id)
  WHERE top_up_request_id IS NOT NULL;

ALTER TABLE petty_cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS petty_cash_transactions_tenant_isolation ON petty_cash_transactions;
CREATE POLICY petty_cash_transactions_tenant_isolation ON petty_cash_transactions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 3. petty_cash_top_up_requests — request → approve → post workflow
-- =============================================================================

CREATE TABLE IF NOT EXISTS petty_cash_top_up_requests (
  id                         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  petty_cash_float_id        uuid NOT NULL REFERENCES petty_cash_floats(id) ON DELETE RESTRICT,
  requested_amount_cents     bigint NOT NULL CHECK (requested_amount_cents > 0),
  reason                     text NOT NULL,
  status                     varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','posted','cancelled')),
  requested_at               timestamptz NOT NULL DEFAULT now(),
  requested_by_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at                 timestamptz,
  decided_by_user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  decision_notes             text,
  -- Set when the approved request is posted — points at the `top_up`
  -- txn created by the post step.
  posted_transaction_id      uuid REFERENCES petty_cash_transactions(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS petty_cash_top_up_requests_float_status_idx
  ON petty_cash_top_up_requests(tenant_id, petty_cash_float_id, status);

CREATE INDEX IF NOT EXISTS petty_cash_top_up_requests_tenant_status_idx
  ON petty_cash_top_up_requests(tenant_id, status, requested_at DESC);

ALTER TABLE petty_cash_top_up_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_top_up_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS petty_cash_top_up_requests_tenant_isolation ON petty_cash_top_up_requests;
CREATE POLICY petty_cash_top_up_requests_tenant_isolation ON petty_cash_top_up_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 4. petty_cash_reconciliations — EOD physical count records
-- =============================================================================

CREATE TABLE IF NOT EXISTS petty_cash_reconciliations (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  petty_cash_float_id       uuid NOT NULL REFERENCES petty_cash_floats(id) ON DELETE RESTRICT,
  recon_date                date NOT NULL,
  -- Expected opening at the start of this recon window — the counted
  -- close of the previous recon, or the float open balance if first.
  opening_balance_cents     bigint NOT NULL,
  movements_in_cents        bigint NOT NULL DEFAULT 0,
  movements_out_cents       bigint NOT NULL DEFAULT 0,
  expected_close_cents      bigint NOT NULL,
  counted_cents             bigint NOT NULL,
  -- counted − expected. Negative = short, positive = over.
  variance_cents            bigint NOT NULL,
  variance_reason           text,
  -- If variance ≠ 0 a variance_short / variance_over txn is posted
  -- and linked here. Null when variance = 0 (no txn needed).
  variance_transaction_id   uuid REFERENCES petty_cash_transactions(id) ON DELETE SET NULL,
  reconciled_at             timestamptz NOT NULL DEFAULT now(),
  reconciled_by_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- One reconciliation per float per day — partial so soft-deletes
-- (none today, but the column is already on other tables) can't block.
CREATE UNIQUE INDEX IF NOT EXISTS petty_cash_reconciliations_float_date_unique
  ON petty_cash_reconciliations(tenant_id, petty_cash_float_id, recon_date);

CREATE INDEX IF NOT EXISTS petty_cash_reconciliations_float_idx
  ON petty_cash_reconciliations(tenant_id, petty_cash_float_id, recon_date DESC);

ALTER TABLE petty_cash_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_reconciliations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS petty_cash_reconciliations_tenant_isolation ON petty_cash_reconciliations;
CREATE POLICY petty_cash_reconciliations_tenant_isolation ON petty_cash_reconciliations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 5. Deferred FKs on petty_cash_transactions
-- =============================================================================
-- The reconciliation_id + top_up_request_id columns were forward-declared
-- above because the referenced tables hadn't been created yet. Add the
-- FKs now with IF NOT EXISTS-guarded ALTER statements so re-runs are safe.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'petty_cash_transactions_reconciliation_fk'
  ) THEN
    ALTER TABLE petty_cash_transactions
      ADD CONSTRAINT petty_cash_transactions_reconciliation_fk
      FOREIGN KEY (reconciliation_id)
      REFERENCES petty_cash_reconciliations(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'petty_cash_transactions_top_up_request_fk'
  ) THEN
    ALTER TABLE petty_cash_transactions
      ADD CONSTRAINT petty_cash_transactions_top_up_request_fk
      FOREIGN KEY (top_up_request_id)
      REFERENCES petty_cash_top_up_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =============================================================================
-- 6. Seed `1005 Petty Cash` COA account per tenant
-- =============================================================================
--
-- Single shared asset account per tenant; every float posts DR/CR
-- against this one row. Code `1005` chosen to fit between the standard
-- `1000 Cash on hand` and `1010 Bank — primary` seeds. Subtype 'cash'
-- so it surfaces alongside cash-on-hand on the CoA tree and in
-- cash-or-bank pickers.

INSERT INTO chart_of_accounts
  (tenant_id, code, name, account_type, account_subtype, normal_side, is_system, is_active, currency)
SELECT t.id, '1005', 'Petty Cash', 'asset', 'cash', 'dr', true, true, 'LKR'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.code = '1005'
);

-- Extend the tenant-signup CoA seed so fresh tenants get `1005 Petty
-- Cash` out of the box. CREATE OR REPLACE only overrides the function
-- body; `seed_pos_defaults_for_tenant` (migration 58) stays as-is.
--
-- Note: we DON'T modify `seed_full_defaults_for_tenant` in 07-seed-defaults.sql
-- directly (that file is the seed contract). A new helper, called after
-- the main seed via a wrapper, is cleaner than mutating the core seed.
CREATE OR REPLACE FUNCTION seed_petty_cash_defaults_for_tenant(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO chart_of_accounts
    (tenant_id, code, name, account_type, account_subtype, normal_side, is_system, is_active, currency)
  VALUES
    (p_tenant_id, '1005', 'Petty Cash', 'asset', 'cash', 'dr', true, true, 'LKR')
  ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 7. Widen document_attachments entity_type CHECK to add petty_cash_transaction
-- =============================================================================
--
-- Receipt files attached to expense / advance rows reuse the generic
-- #32 attachment infrastructure. Drop + re-add the constraint idempotently
-- with the widened list. Keep in sync with both
--   packages/db/src/schema/document-attachments.ts    (DOCUMENT_ATTACHMENT_ENTITY_TYPES)
-- and
--   apps/api/src/modules/platform/attachments.ts      (ENTITY_TABLE map).

ALTER TABLE document_attachments
  DROP CONSTRAINT IF EXISTS document_attachments_entity_type_check;
ALTER TABLE document_attachments
  ADD CONSTRAINT document_attachments_entity_type_check CHECK (
    entity_type IN (
      'invoice',
      'sales_order',
      'quotation',
      'credit_note',
      'bill',
      'purchase_order',
      'purchase_requisition',
      'goods_received_note',
      'expense_claim',
      'payment',
      'receipt',
      'final_settlement',
      'journal_entry',
      'petty_cash_transaction'
    )
  );

-- =============================================================================
-- 8. updated_at trigger helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION petty_cash_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS petty_cash_floats_updated_at ON petty_cash_floats;
CREATE TRIGGER petty_cash_floats_updated_at
  BEFORE UPDATE ON petty_cash_floats
  FOR EACH ROW EXECUTE FUNCTION petty_cash_set_updated_at();

DROP TRIGGER IF EXISTS petty_cash_transactions_updated_at ON petty_cash_transactions;
CREATE TRIGGER petty_cash_transactions_updated_at
  BEFORE UPDATE ON petty_cash_transactions
  FOR EACH ROW EXECUTE FUNCTION petty_cash_set_updated_at();

DROP TRIGGER IF EXISTS petty_cash_top_up_requests_updated_at ON petty_cash_top_up_requests;
CREATE TRIGGER petty_cash_top_up_requests_updated_at
  BEFORE UPDATE ON petty_cash_top_up_requests
  FOR EACH ROW EXECUTE FUNCTION petty_cash_set_updated_at();

DROP TRIGGER IF EXISTS petty_cash_reconciliations_updated_at ON petty_cash_reconciliations;
CREATE TRIGGER petty_cash_reconciliations_updated_at
  BEFORE UPDATE ON petty_cash_reconciliations
  FOR EACH ROW EXECUTE FUNCTION petty_cash_set_updated_at();

-- =============================================================================
-- 9. Permission seeds — petty_cash.operate + petty_cash.approve
-- =============================================================================
--
-- Two keys:
--   · petty_cash.operate — request top-ups, record expenses / advances
--                          (held by Owner, Admin, Accountant — and any
--                          custom role the tenant grants).
--   · petty_cash.approve — approve+post top-ups (Owner / Admin /
--                          Accountant). SOD: requester ≠ approver at
--                          the API layer.
--
-- Rewrites `seed_admin_role_templates_for_tenant` to bake both keys
-- into new-tenant Owner / Admin / Accountant defaults. Then backfills
-- existing system-role rows (is_system=true, deleted_at IS NULL) so
-- that tenants live today inherit the keys without a data migration
-- step. Custom tenant-edited roles are left alone — tenant admins
-- grant the keys through the roles UI.

CREATE OR REPLACE FUNCTION seed_admin_role_templates_for_tenant(tenant_uuid uuid)
RETURNS void AS $$
DECLARE
  full_perms jsonb := jsonb_build_object(
    'accounting.manage', true,
    'invoices.create',   true,
    'invoices.post',     true,
    'invoices.void',     true,
    'bills.create',      true,
    'bills.post',        true,
    'bills.void',        true,
    'payments.manage',   true,
    'payroll.manage',    true,
    'hr.manage',         true,
    'inventory.manage',  true,
    'pos.operate',       true,
    'pos.close',         true,
    'reports.view',      true,
    'settings.manage',   true,
    'users.manage',      true,
    'approval.decide',   true,
    'purchase_requisitions.manage', true,
    'petty_cash.operate', true,
    'petty_cash.approve', true
  );
  accountant_perms jsonb := jsonb_build_object(
    'accounting.manage', true,
    'invoices.create',   true,
    'invoices.post',     true,
    'bills.create',      true,
    'bills.post',        true,
    'payments.manage',   true,
    'reports.view',      true,
    'approval.decide',   true,
    'purchase_requisitions.manage', true,
    'petty_cash.operate', true,
    'petty_cash.approve', true
  );
  sales_perms jsonb := jsonb_build_object(
    'invoices.create',   true,
    'invoices.post',     true,
    'pos.operate',       true,
    'reports.view',      true
  );
  readonly_perms jsonb := jsonb_build_object(
    'reports.view',      true
  );
BEGIN
  INSERT INTO roles (tenant_id, name, description, permissions, is_system)
  VALUES
    (tenant_uuid, 'Owner', 'Full access — nothing can strip this.', full_perms, true),
    (tenant_uuid, 'Admin', 'Day-to-day admin with full app access.', full_perms, true),
    (tenant_uuid, 'Accountant', 'Post invoices, bills, payments, view reports.', accountant_perms, true),
    (tenant_uuid, 'Sales', 'Create and post invoices; view reports.', sales_perms, true),
    (tenant_uuid, 'Read-only', 'View reports only — no create/post.', readonly_perms, true)
  ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Backfill: merge the two new keys into existing Owner / Admin /
-- Accountant system rows. Idempotent — the UPDATE is a no-op if the
-- key already maps to true.
UPDATE roles
   SET permissions = permissions
         || jsonb_build_object('petty_cash.operate', true)
         || jsonb_build_object('petty_cash.approve', true),
       updated_at = now()
 WHERE is_system = true
   AND deleted_at IS NULL
   AND name IN ('Owner', 'Admin', 'Accountant')
   AND (
     COALESCE((permissions ->> 'petty_cash.operate')::boolean, false) = false
     OR COALESCE((permissions ->> 'petty_cash.approve')::boolean, false) = false
   );
