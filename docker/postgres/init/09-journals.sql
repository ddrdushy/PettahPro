-- Journal entries — the ledger everything else posts to.
-- Each entry has 2+ lines. Sum of dr_cents must equal sum of cr_cents.

CREATE TABLE IF NOT EXISTS journal_entries (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_number  varchar(48) NOT NULL,
  entry_date    date NOT NULL,
  fiscal_period_id uuid REFERENCES fiscal_periods(id) ON DELETE SET NULL,
  memo          text,
  source_type   varchar(32),                -- 'invoice' | 'bill' | 'payment' | 'manual' | ...
  source_id     uuid,                        -- FK (logical) to the source document
  posted_at     timestamptz NOT NULL DEFAULT now(),
  posted_by_user_id uuid,
  is_reversed   boolean NOT NULL DEFAULT false,
  reversed_by_entry_id uuid REFERENCES journal_entries(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_tenant_number_unique
  ON journal_entries(tenant_id, entry_number);
CREATE INDEX IF NOT EXISTS journal_entries_tenant_date
  ON journal_entries(tenant_id, entry_date);
CREATE INDEX IF NOT EXISTS journal_entries_source
  ON journal_entries(tenant_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS journal_lines (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no       smallint NOT NULL,
  account_id    uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  dr_cents      bigint NOT NULL DEFAULT 0,
  cr_cents      bigint NOT NULL DEFAULT 0,
  currency      varchar(3) NOT NULL DEFAULT 'LKR',
  description   varchar(500),
  -- Optional references for reporting (customer/supplier/item)
  customer_id   uuid,
  supplier_id   uuid,
  item_id       uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_line_side_xor CHECK (
    (dr_cents > 0 AND cr_cents = 0) OR (cr_cents > 0 AND dr_cents = 0)
  )
);

CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_tenant_account ON journal_lines(tenant_id, account_id);
CREATE INDEX IF NOT EXISTS journal_lines_tenant_customer ON journal_lines(tenant_id, customer_id)
  WHERE customer_id IS NOT NULL;

-- Balance check: refuse to insert an unbalanced entry.
-- Enforced via deferred trigger so all lines can be inserted first.
CREATE OR REPLACE FUNCTION check_journal_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_dr bigint;
  v_cr bigint;
BEGIN
  SELECT COALESCE(SUM(dr_cents), 0), COALESCE(SUM(cr_cents), 0)
    INTO v_dr, v_cr
  FROM journal_lines
  WHERE journal_entry_id = NEW.id;

  IF v_dr <> v_cr THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: DR=% CR=%', NEW.id, v_dr, v_cr;
  END IF;
  IF v_dr = 0 THEN
    RAISE EXCEPTION 'Journal entry % has no lines', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS journal_entry_balanced ON journal_entries;
CREATE CONSTRAINT TRIGGER journal_entry_balanced
  AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_journal_balanced();

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journal_entries_tenant_isolation ON journal_entries;
CREATE POLICY journal_entries_tenant_isolation ON journal_entries
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journal_lines_tenant_isolation ON journal_lines;
CREATE POLICY journal_lines_tenant_isolation ON journal_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
