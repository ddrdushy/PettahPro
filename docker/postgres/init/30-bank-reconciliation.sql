-- Bank reconciliation — match bank statement lines against posted payments.
-- accounting-module-spec §14.3 / tenant-admin-ux month-end close item.
--
-- v1 flow: user pastes CSV → we parse into bank_statement_lines →
-- auto-match unique candidates by (amount, date ± N days) → user
-- manually fixes ambiguous / unmatched rows → marks the import reconciled.
--
-- No GL impact. A matched line is just metadata linking the statement
-- row to the payment (or cheque) that caused it.

CREATE TABLE IF NOT EXISTS bank_statement_imports (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bank_account_id           uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  statement_from_date       date NOT NULL,
  statement_to_date         date NOT NULL,
  opening_balance_cents     bigint,
  closing_balance_cents     bigint,
  total_lines               integer NOT NULL DEFAULT 0,
  matched_lines             integer NOT NULL DEFAULT 0,
  status                    varchar(16) NOT NULL DEFAULT 'pending',
  notes                     text,
  reconciled_at             timestamptz,
  reconciled_by_user_id     uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by_user_id        uuid,
  CONSTRAINT bank_stmt_imports_status_check CHECK (status IN ('pending','reconciled')),
  CONSTRAINT bank_stmt_imports_date_range CHECK (statement_from_date <= statement_to_date)
);

CREATE INDEX IF NOT EXISTS bank_stmt_imports_tenant_status
  ON bank_statement_imports(tenant_id, status);
CREATE INDEX IF NOT EXISTS bank_stmt_imports_tenant_account
  ON bank_statement_imports(tenant_id, bank_account_id);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_id                 uuid NOT NULL REFERENCES bank_statement_imports(id) ON DELETE CASCADE,
  line_no                   integer NOT NULL,
  transaction_date          date NOT NULL,
  description               varchar(500) NOT NULL,
  -- Signed cents: positive = inflow (debit to bank in our books),
  --               negative = outflow (credit to bank in our books).
  amount_cents              bigint NOT NULL,
  reference                 varchar(128),
  -- Match state
  match_status              varchar(16) NOT NULL DEFAULT 'unmatched',
  matched_ref_type          varchar(32),              -- customer_payment | supplier_payment | cheque | manual
  matched_ref_id            uuid,
  match_notes               text,
  matched_at                timestamptz,
  matched_by_user_id        uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_stmt_lines_match_status_check CHECK (match_status IN (
    'unmatched','matched','ignored','multiple_candidates'
  ))
);

CREATE INDEX IF NOT EXISTS bank_stmt_lines_import ON bank_statement_lines(import_id);
CREATE INDEX IF NOT EXISTS bank_stmt_lines_tenant_match
  ON bank_statement_lines(tenant_id, match_status);

ALTER TABLE bank_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_imports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_stmt_imports_tenant_isolation ON bank_statement_imports;
CREATE POLICY bank_stmt_imports_tenant_isolation ON bank_statement_imports
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_stmt_lines_tenant_isolation ON bank_statement_lines;
CREATE POLICY bank_stmt_lines_tenant_isolation ON bank_statement_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
