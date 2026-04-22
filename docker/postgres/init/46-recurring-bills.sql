-- Recurring bill templates — the AP symmetry of recurring_invoices (§buy 11.5).
--
-- A tenant creates a template linked to a supplier + expense lines; the
-- hourly worker cron finds templates due today (next_run_date <= CURRENT_DATE)
-- and generates a draft bill from each. Same plumbing as recurring_invoices:
-- `list_due_recurring_bills` is a SECURITY DEFINER cross-tenant helper so the
-- worker can see every tenant's due rows without RLS context, then each row
-- is processed inside its own withTenant tx.
--
-- Why templates vs. just "duplicate last bill"
-- --------------------------------------------
-- Rent, internet, SaaS subscriptions, insurance, software licences — these
-- are month-in month-out bills where the shape is identical and only the
-- date moves. The duplicate-last-bill pattern drifts: once someone edits a
-- copy, the next copy inherits the edit. A template is a stable source of
-- truth that survives edits to the drafts it spawns.
--
-- Frequency is 'monthly' in v1 (matches recurring_invoices). Adding weekly /
-- fortnightly / annual later is a worker-only change — compute_next_run_date
-- in TS decides how the date walks.

CREATE TABLE IF NOT EXISTS recurring_bills (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id        uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  branch_id          uuid REFERENCES branches(id) ON DELETE SET NULL,
  schedule_name      varchar(200) NOT NULL,
  frequency          varchar(16) NOT NULL DEFAULT 'monthly',  -- monthly (v1)
  day_of_month       smallint NOT NULL DEFAULT 1,             -- 1..28 clamp on UI
  start_date         date NOT NULL,
  end_date           date,
  next_run_date      date NOT NULL,
  last_run_date      date,
  due_days           integer NOT NULL DEFAULT 30,             -- bill due N days after issue
  currency           varchar(3) NOT NULL DEFAULT 'LKR',
  -- Supplier's own invoice number template. Uses {YYYY}/{MM}/{SEQ} tokens in
  -- v1 (e.g. "ACME-{YYYY}{MM}-01"). Left as a plain varchar on storage so new
  -- tokens can be added without migrations. Null = leave supplier_bill_number
  -- blank and let AP fill it after the supplier's actual invoice arrives.
  supplier_bill_number_template varchar(128),
  notes              text,
  is_active          boolean NOT NULL DEFAULT true,
  paused_at          timestamptz,
  generated_count    integer NOT NULL DEFAULT 0,
  last_generated_bill_id uuid REFERENCES bills(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  deleted_at         timestamptz
);

CREATE INDEX IF NOT EXISTS recurring_bills_tenant_active_next
  ON recurring_bills(tenant_id, is_active, next_run_date)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS recurring_bills_tenant_supplier
  ON recurring_bills(tenant_id, supplier_id)
  WHERE deleted_at IS NULL;

ALTER TABLE recurring_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recurring_bills_isolation ON recurring_bills;
CREATE POLICY recurring_bills_isolation ON recurring_bills
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Template lines. Same fields as bill_lines but without stored totals —
-- quantity × unit price is recomputed at generate time against the current
-- tax_code rate (so if VAT changes between cycles, the next draft picks up
-- the new rate). `expense_account_id` is cached on the template so a tenant
-- that's carefully mapped rent → '6200 Rent' doesn't have to re-pick every
-- month.
CREATE TABLE IF NOT EXISTS recurring_bill_lines (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recurring_bill_id     uuid NOT NULL REFERENCES recurring_bills(id) ON DELETE CASCADE,
  line_no               smallint NOT NULL,
  item_id               uuid REFERENCES items(id) ON DELETE SET NULL,
  description           varchar(500) NOT NULL,
  quantity              numeric(18,4) NOT NULL DEFAULT 1,
  unit_price_cents      bigint NOT NULL DEFAULT 0,
  discount_pct_bps      integer NOT NULL DEFAULT 0,
  tax_code_id           uuid REFERENCES tax_codes(id) ON DELETE SET NULL,
  expense_account_id    uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recurring_bill_lines_header
  ON recurring_bill_lines(recurring_bill_id, line_no);

ALTER TABLE recurring_bill_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_bill_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recurring_bill_lines_isolation ON recurring_bill_lines;
CREATE POLICY recurring_bill_lines_isolation ON recurring_bill_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Cross-tenant helper for the worker cron. SECURITY DEFINER runs as the
-- function owner (postgres superuser), so it bypasses RLS. The worker calls
-- this without tenant context, gets back (template_id, tenant_id) pairs, then
-- enters each tenant's context via withTenant to do the actual generation.
--
-- Mirrors list_due_recurring_invoices in 32-recurring-invoices.sql.
CREATE OR REPLACE FUNCTION list_due_recurring_bills(as_of date)
RETURNS TABLE(id uuid, tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT r.id, r.tenant_id
    FROM recurring_bills r
   WHERE r.is_active = true
     AND r.deleted_at IS NULL
     AND r.next_run_date <= as_of
     AND (r.end_date IS NULL OR r.end_date >= as_of);
$$;

-- 44-auth-helpers.sql sets ALTER DEFAULT PRIVILEGES so any function created
-- after it automatically gets EXECUTE granted to pettahpro_app. No explicit
-- GRANT needed here.
