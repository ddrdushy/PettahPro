-- Recurring invoice templates. A tenant creates a template linked to a
-- customer + line items; a worker cron (hourly) finds templates due today
-- (next_run_date <= CURRENT_DATE) and generates a draft invoice from each.
--
-- Frequency is 'monthly' in v1 (covers the SME retainer / subscription /
-- rent use cases). Weekly / fortnightly can slot in later — the worker
-- computes next_run_date by bumping from the current one using the
-- frequency+day-of-month knobs, so adding frequencies is a worker change.

CREATE TABLE IF NOT EXISTS recurring_invoices (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id        uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  branch_id          uuid REFERENCES branches(id) ON DELETE SET NULL,
  schedule_name      varchar(200) NOT NULL,
  frequency          varchar(16) NOT NULL DEFAULT 'monthly',  -- monthly (v1)
  day_of_month       smallint NOT NULL DEFAULT 1,             -- 1..28 clamp on UI
  start_date         date NOT NULL,
  end_date           date,
  next_run_date      date NOT NULL,
  last_run_date      date,
  due_days           integer NOT NULL DEFAULT 30,             -- invoice due N days after issue
  currency           varchar(3) NOT NULL DEFAULT 'LKR',
  reference          varchar(64),
  notes              text,
  terms              text,
  is_active          boolean NOT NULL DEFAULT true,
  paused_at          timestamptz,                              -- set when user pauses
  generated_count    integer NOT NULL DEFAULT 0,
  last_generated_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  deleted_at         timestamptz
);

CREATE INDEX IF NOT EXISTS recurring_invoices_tenant_active_next
  ON recurring_invoices(tenant_id, is_active, next_run_date)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS recurring_invoices_tenant_customer
  ON recurring_invoices(tenant_id, customer_id)
  WHERE deleted_at IS NULL;

ALTER TABLE recurring_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recurring_invoices_isolation ON recurring_invoices;
CREATE POLICY recurring_invoices_isolation ON recurring_invoices
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Template lines. Same shape as invoice_lines but no stored totals —
-- quantity × unit price is recomputed at generate time against the current
-- tax_code rate in case VAT/SSCL rates change between cycles.
CREATE TABLE IF NOT EXISTS recurring_invoice_lines (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recurring_invoice_id  uuid NOT NULL REFERENCES recurring_invoices(id) ON DELETE CASCADE,
  line_no               smallint NOT NULL,
  item_id               uuid REFERENCES items(id) ON DELETE SET NULL,
  description           varchar(500) NOT NULL,
  quantity              numeric(18,4) NOT NULL DEFAULT 1,
  unit_price_cents      bigint NOT NULL DEFAULT 0,
  discount_pct_bps      integer NOT NULL DEFAULT 0,
  tax_code_id           uuid REFERENCES tax_codes(id) ON DELETE SET NULL,
  income_account_id     uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recurring_invoice_lines_header
  ON recurring_invoice_lines(recurring_invoice_id, line_no);

ALTER TABLE recurring_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_invoice_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recurring_invoice_lines_isolation ON recurring_invoice_lines;
CREATE POLICY recurring_invoice_lines_isolation ON recurring_invoice_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Cross-tenant helper for the worker cron. SECURITY DEFINER runs as the
-- function owner (postgres superuser), so it bypasses RLS. The application
-- calls this without tenant context set, gets back (template_id, tenant_id)
-- pairs, then enters each tenant's context in turn to do the actual work.
CREATE OR REPLACE FUNCTION list_due_recurring_invoices(as_of date)
RETURNS TABLE(id uuid, tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT r.id, r.tenant_id
    FROM recurring_invoices r
   WHERE r.is_active = true
     AND r.deleted_at IS NULL
     AND r.next_run_date <= as_of
     AND (r.end_date IS NULL OR r.end_date >= as_of);
$$;
