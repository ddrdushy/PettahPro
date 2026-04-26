-- #136 / gaps I1 — Demo data toggle.
--
-- New tenants today land on an empty system: no customers, no items,
-- no invoices to look at. That's a terrible first impression for a
-- trial-mode user evaluating whether PettahPro fits. This migration
-- adds:
--
--   1. demo_data_seeds   — tracking table that records every row
--      inserted by seed_demo_data() so clear_demo_data() can find and
--      remove them later (no naming convention / tag scanning).
--
--   2. seed_demo_data(p_tenant_id) — inserts a small but realistic
--      set of customers / suppliers / items / invoices / bills /
--      payments dated across the past ~60 days. Status mix on
--      invoices/bills reflects normal usage (paid / partially paid /
--      posted unpaid) so the dashboards look alive.
--
--   3. clear_demo_data(p_tenant_id) — walks demo_data_seeds in
--      reverse insertion order and deletes each record. FK cascades
--      take care of dependent rows (invoice_lines, payment_allocations,
--      journal_lines).
--
-- Demo records are functionally indistinguishable from real ones —
-- they go through the same tables, RLS, and constraints. The only
-- difference is the seeds-table audit trail. That means the user can
-- click around freely (edit, post, delete) and nothing breaks; the
-- "Clear demo data" button only removes what's still tracked, so any
-- record the user has detached (e.g. by editing the reference) stays.

CREATE TABLE IF NOT EXISTS demo_data_seeds (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_name  text NOT NULL,
  record_id   uuid NOT NULL,
  seeded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_data_seeds_tenant_idx
  ON demo_data_seeds(tenant_id, seeded_at DESC);

ALTER TABLE demo_data_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_data_seeds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demo_data_seeds_tenant_isolation ON demo_data_seeds;
CREATE POLICY demo_data_seeds_tenant_isolation ON demo_data_seeds
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON demo_data_seeds TO pettahpro_app;

-- ---------------------------------------------------------------
-- seed_demo_data(p_tenant_id) — populates a realistic mini-dataset.
-- Idempotent guard: if any demo row already exists for this tenant
-- the function NOTICEs and returns 0 without inserting again, so the
-- "Load demo data" button is safe to double-click.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_demo_data(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing            integer;
  v_inserted            integer := 0;

  -- Account / branch / tax lookups (must already exist via seed_tenant_defaults)
  v_branch_id           uuid;
  v_bank_id             uuid;
  v_cash_id             uuid;
  v_ar_id               uuid;
  v_ap_id               uuid;
  v_inv_acct_id         uuid;
  v_sales_id            uuid;
  v_cogs_id             uuid;
  v_vat_pay_id          uuid;
  v_vat_rec_id          uuid;
  v_vat18_tax_id        uuid;

  -- Customers
  v_cust_lanka_mart     uuid;
  v_cust_spice_garden   uuid;
  v_cust_eastern        uuid;
  v_cust_sea_breeze     uuid;
  v_cust_sunrise        uuid;

  -- Suppliers
  v_sup_galaxy          uuid;
  v_sup_nimal           uuid;
  v_sup_abc_print       uuid;
  v_sup_reliable        uuid;

  -- Items (5 products, 3 services)
  v_item_cement         uuid;
  v_item_steel          uuid;
  v_item_pipe           uuid;
  v_item_chair          uuid;
  v_item_lamp           uuid;
  v_item_consult        uuid;
  v_item_maint          uuid;
  v_item_delivery       uuid;

  -- Invoices
  v_inv1                uuid;
  v_inv2                uuid;
  v_inv3                uuid;
  v_inv4                uuid;
  v_inv5                uuid;
  v_inv6                uuid;

  -- Bills
  v_bill1               uuid;
  v_bill2               uuid;
  v_bill3               uuid;
  v_bill4               uuid;

  -- Payments
  v_pay1                uuid;
  v_pay2                uuid;
  v_pay3                uuid;

  v_today               date := current_date;
BEGIN
  -- Set tenant context for RLS for the duration of this transaction.
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);

  -- Idempotency: bail if we've already seeded.
  SELECT count(*) INTO v_existing
    FROM demo_data_seeds WHERE tenant_id = p_tenant_id;
  IF v_existing > 0 THEN
    RAISE NOTICE 'seed_demo_data: tenant % already has % demo rows — skipping.',
      p_tenant_id, v_existing;
    RETURN 0;
  END IF;

  -- ---- Lookups ----
  SELECT id INTO v_branch_id FROM branches
    WHERE tenant_id = p_tenant_id AND is_head_office = true LIMIT 1;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'seed_demo_data: tenant % has no head-office branch — run seed_tenant_defaults first.', p_tenant_id;
  END IF;

  SELECT id INTO v_bank_id    FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '1010' LIMIT 1;
  SELECT id INTO v_cash_id    FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '1000' LIMIT 1;
  SELECT id INTO v_ar_id      FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '1100' LIMIT 1;
  SELECT id INTO v_ap_id      FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '2000' LIMIT 1;
  SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '1200' LIMIT 1;
  SELECT id INTO v_sales_id   FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '4000' LIMIT 1;
  SELECT id INTO v_cogs_id    FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '5000' LIMIT 1;
  SELECT id INTO v_vat_pay_id FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '2100' LIMIT 1;
  SELECT id INTO v_vat_rec_id FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '1300' LIMIT 1;

  SELECT id INTO v_vat18_tax_id FROM tax_codes
    WHERE tenant_id = p_tenant_id AND code = 'VAT18' LIMIT 1;

  -- ---- Customers (5) ----
  INSERT INTO customers (tenant_id, code, name, legal_name, email, phone,
                         address_line1, city, country, payment_terms_days,
                         credit_limit_cents, tags)
    VALUES (p_tenant_id, 'CUST-DEMO-01', 'Lanka Mart (Pvt) Ltd', 'Lanka Mart Private Limited',
            'accounts@lankamart.lk', '+94 11 222 3344',
            '125 Galle Road', 'Colombo 03', 'LK', 30, 50000000, '["demo"]'::jsonb)
    RETURNING id INTO v_cust_lanka_mart;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'customers', v_cust_lanka_mart);

  INSERT INTO customers (tenant_id, code, name, email, phone,
                         address_line1, city, country, payment_terms_days, tags)
    VALUES (p_tenant_id, 'CUST-DEMO-02', 'Spice Garden Restaurant',
            'manager@spicegarden.lk', '+94 91 224 5566',
            '48 Lighthouse Street', 'Galle', 'LK', 14, '["demo"]'::jsonb)
    RETURNING id INTO v_cust_spice_garden;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'customers', v_cust_spice_garden);

  INSERT INTO customers (tenant_id, code, name, legal_name, email, phone,
                         address_line1, city, country, payment_terms_days,
                         credit_limit_cents, tags)
    VALUES (p_tenant_id, 'CUST-DEMO-03', 'Eastern Holdings (Pvt) Ltd', 'Eastern Holdings Private Limited',
            'finance@easternholdings.lk', '+94 81 220 7788',
            '12 Peradeniya Road', 'Kandy', 'LK', 45, 100000000, '["demo"]'::jsonb)
    RETURNING id INTO v_cust_eastern;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'customers', v_cust_eastern);

  INSERT INTO customers (tenant_id, code, name, email, phone,
                         address_line1, city, country, payment_terms_days, tags)
    VALUES (p_tenant_id, 'CUST-DEMO-04', 'Sea Breeze Hotels',
            'accounts@seabreeze.lk', '+94 31 222 9900',
            '301 Beach Road', 'Negombo', 'LK', 21, '["demo"]'::jsonb)
    RETURNING id INTO v_cust_sea_breeze;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'customers', v_cust_sea_breeze);

  INSERT INTO customers (tenant_id, code, name, email, phone,
                         address_line1, city, country, payment_terms_days, tags)
    VALUES (p_tenant_id, 'CUST-DEMO-05', 'Sunrise Trading',
            'sales@sunrise.lk', '+94 11 285 4422',
            '64 High Level Road', 'Maharagama', 'LK', 0, '["demo"]'::jsonb)
    RETURNING id INTO v_cust_sunrise;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'customers', v_cust_sunrise);

  -- ---- Suppliers (4) ----
  INSERT INTO suppliers (tenant_id, code, name, email, phone, address_line1, city,
                         country, payment_terms_days, tags)
    VALUES (p_tenant_id, 'SUPP-DEMO-01', 'Galaxy Distributors',
            'orders@galaxydist.lk', '+94 11 244 1100',
            '88 Sri Sangaraja Mawatha', 'Colombo 10', 'LK', 30, '["demo"]'::jsonb)
    RETURNING id INTO v_sup_galaxy;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'suppliers', v_sup_galaxy);

  INSERT INTO suppliers (tenant_id, code, name, email, phone, address_line1, city,
                         country, payment_terms_days, tags)
    VALUES (p_tenant_id, 'SUPP-DEMO-02', 'Nimal Stationery',
            'nimal@nimalstationery.lk', '+94 11 233 5577',
            '14 Maradana Road', 'Colombo 08', 'LK', 14, '["demo"]'::jsonb)
    RETURNING id INTO v_sup_nimal;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'suppliers', v_sup_nimal);

  INSERT INTO suppliers (tenant_id, code, name, email, phone, address_line1, city,
                         country, payment_terms_days, tags)
    VALUES (p_tenant_id, 'SUPP-DEMO-03', 'ABC Printing Services',
            'jobs@abcprint.lk', '+94 11 298 4400',
            '22 Negombo Road', 'Wattala', 'LK', 7, '["demo"]'::jsonb)
    RETURNING id INTO v_sup_abc_print;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'suppliers', v_sup_abc_print);

  INSERT INTO suppliers (tenant_id, code, name, email, phone, address_line1, city,
                         country, payment_terms_days, tags)
    VALUES (p_tenant_id, 'SUPP-DEMO-04', 'Reliable Logistics',
            'dispatch@reliable.lk', '+94 11 263 7711',
            '105 Galle Road', 'Ratmalana', 'LK', 30, '["demo"]'::jsonb)
    RETURNING id INTO v_sup_reliable;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'suppliers', v_sup_reliable);

  -- ---- Items (5 products + 3 services) ----
  INSERT INTO items (tenant_id, sku, name, description, item_type, unit,
                     sell_price_cents, buy_price_cents, tax_code_id,
                     income_account_id, expense_account_id, asset_account_id,
                     track_inventory, tags)
    VALUES (p_tenant_id, 'PROD-DEMO-001', 'Cement bag (50kg)', 'Ordinary Portland cement, 50kg bag.',
            'product', 'bag', 250000, 195000, v_vat18_tax_id,
            v_sales_id, v_cogs_id, v_inv_acct_id, true, '["demo"]'::jsonb)
    RETURNING id INTO v_item_cement;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'items', v_item_cement);

  INSERT INTO items (tenant_id, sku, name, description, item_type, unit,
                     sell_price_cents, buy_price_cents, tax_code_id,
                     income_account_id, expense_account_id, asset_account_id,
                     track_inventory, tags)
    VALUES (p_tenant_id, 'PROD-DEMO-002', 'Steel reinforcement bar (12mm)', 'TMT steel bar, 12mm × 6m length.',
            'product', 'unit', 320000, 245000, v_vat18_tax_id,
            v_sales_id, v_cogs_id, v_inv_acct_id, true, '["demo"]'::jsonb)
    RETURNING id INTO v_item_steel;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'items', v_item_steel);

  INSERT INTO items (tenant_id, sku, name, description, item_type, unit,
                     sell_price_cents, buy_price_cents, tax_code_id,
                     income_account_id, expense_account_id, asset_account_id,
                     track_inventory, tags)
    VALUES (p_tenant_id, 'PROD-DEMO-003', 'PVC pipe (2-inch)', '2-inch PVC pipe, 6m length.',
            'product', 'unit', 145000, 102500, v_vat18_tax_id,
            v_sales_id, v_cogs_id, v_inv_acct_id, true, '["demo"]'::jsonb)
    RETURNING id INTO v_item_pipe;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'items', v_item_pipe);

  INSERT INTO items (tenant_id, sku, name, description, item_type, unit,
                     sell_price_cents, buy_price_cents, tax_code_id,
                     income_account_id, expense_account_id, asset_account_id,
                     track_inventory, tags)
    VALUES (p_tenant_id, 'PROD-DEMO-004', 'Office chair (ergonomic)', 'Mid-back ergonomic chair with armrests.',
            'product', 'unit', 1850000, 1320000, v_vat18_tax_id,
            v_sales_id, v_cogs_id, v_inv_acct_id, true, '["demo"]'::jsonb)
    RETURNING id INTO v_item_chair;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'items', v_item_chair);

  INSERT INTO items (tenant_id, sku, name, description, item_type, unit,
                     sell_price_cents, buy_price_cents, tax_code_id,
                     income_account_id, expense_account_id, asset_account_id,
                     track_inventory, tags)
    VALUES (p_tenant_id, 'PROD-DEMO-005', 'LED desk lamp', 'Adjustable LED desk lamp with USB port.',
            'product', 'unit', 480000, 322000, v_vat18_tax_id,
            v_sales_id, v_cogs_id, v_inv_acct_id, true, '["demo"]'::jsonb)
    RETURNING id INTO v_item_lamp;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'items', v_item_lamp);

  INSERT INTO items (tenant_id, sku, name, description, item_type, unit,
                     sell_price_cents, buy_price_cents, tax_code_id,
                     income_account_id, expense_account_id,
                     track_inventory, tags)
    VALUES (p_tenant_id, 'SVC-DEMO-001', 'Consulting (per hour)', 'Professional consulting services billed hourly.',
            'service', 'hour', 750000, 0, v_vat18_tax_id,
            v_sales_id, v_cogs_id,
            false, '["demo"]'::jsonb)
    RETURNING id INTO v_item_consult;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'items', v_item_consult);

  INSERT INTO items (tenant_id, sku, name, description, item_type, unit,
                     sell_price_cents, buy_price_cents, tax_code_id,
                     income_account_id, expense_account_id,
                     track_inventory, tags)
    VALUES (p_tenant_id, 'SVC-DEMO-002', 'Maintenance visit', 'On-site maintenance call (per visit).',
            'service', 'unit', 1250000, 0, v_vat18_tax_id,
            v_sales_id, v_cogs_id,
            false, '["demo"]'::jsonb)
    RETURNING id INTO v_item_maint;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'items', v_item_maint);

  INSERT INTO items (tenant_id, sku, name, description, item_type, unit,
                     sell_price_cents, buy_price_cents, tax_code_id,
                     income_account_id, expense_account_id,
                     track_inventory, tags)
    VALUES (p_tenant_id, 'SVC-DEMO-003', 'Delivery fee', 'Delivery charge for local Colombo area.',
            'service', 'unit', 150000, 0, v_vat18_tax_id,
            v_sales_id, v_cogs_id,
            false, '["demo"]'::jsonb)
    RETURNING id INTO v_item_delivery;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'items', v_item_delivery);

  -- ---- Invoices (6, mixed status, dated across past 60 days) ----
  -- Each invoice helper inlined for clarity. Money math uses 18% VAT
  -- on the subtotal. We don't post a journal_entry — Reports that
  -- need GL movements stay quiet, but the listing pages, dashboards,
  -- aging reports and customer balances all light up.

  -- Inv 1: Lanka Mart, paid in full, 55 days ago
  INSERT INTO invoices (tenant_id, invoice_number, customer_id, branch_id,
                        status, issue_date, due_date,
                        subtotal_cents, tax_cents, total_cents,
                        amount_paid_cents, balance_due_cents,
                        notes, posted_at)
    VALUES (p_tenant_id, 'INV-DEMO-001', v_cust_lanka_mart, v_branch_id,
            'paid', v_today - 55, v_today - 25,
            5000000, 900000, 5900000,
            5900000, 0,
            'Demo: bulk cement order.', (v_today - 55)::timestamptz)
    RETURNING id INTO v_inv1;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'invoices', v_inv1);
  INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, item_id, description,
                             quantity, unit_price_cents, line_subtotal_cents,
                             tax_code_id, tax_rate_bps, tax_cents, line_total_cents,
                             income_account_id)
    VALUES (p_tenant_id, v_inv1, 1, v_item_cement, 'Cement bag (50kg)',
            20, 250000, 5000000,
            v_vat18_tax_id, 1800, 900000, 5900000,
            v_sales_id);

  -- Inv 2: Spice Garden, partially paid, 30 days ago
  INSERT INTO invoices (tenant_id, invoice_number, customer_id, branch_id,
                        status, issue_date, due_date,
                        subtotal_cents, tax_cents, total_cents,
                        amount_paid_cents, balance_due_cents,
                        notes, posted_at)
    VALUES (p_tenant_id, 'INV-DEMO-002', v_cust_spice_garden, v_branch_id,
            'partially_paid', v_today - 30, v_today - 16,
            3700000, 666000, 4366000,
            2000000, 2366000,
            'Demo: monthly maintenance.', (v_today - 30)::timestamptz)
    RETURNING id INTO v_inv2;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'invoices', v_inv2);
  INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, item_id, description,
                             quantity, unit_price_cents, line_subtotal_cents,
                             tax_code_id, tax_rate_bps, tax_cents, line_total_cents,
                             income_account_id)
    VALUES
    (p_tenant_id, v_inv2, 1, v_item_maint,    'Maintenance visit',
     2, 1250000, 2500000, v_vat18_tax_id, 1800, 450000, 2950000, v_sales_id),
    (p_tenant_id, v_inv2, 2, v_item_consult,  'Consulting (per hour)',
     1.6, 750000, 1200000, v_vat18_tax_id, 1800, 216000, 1416000, v_sales_id);

  -- Inv 3: Eastern Holdings, posted unpaid, 12 days ago
  INSERT INTO invoices (tenant_id, invoice_number, customer_id, branch_id,
                        status, issue_date, due_date,
                        subtotal_cents, tax_cents, total_cents,
                        amount_paid_cents, balance_due_cents,
                        notes, posted_at)
    VALUES (p_tenant_id, 'INV-DEMO-003', v_cust_eastern, v_branch_id,
            'posted', v_today - 12, v_today + 33,
            27500000, 4950000, 32450000,
            0, 32450000,
            'Demo: office furnishing.', (v_today - 12)::timestamptz)
    RETURNING id INTO v_inv3;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'invoices', v_inv3);
  INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, item_id, description,
                             quantity, unit_price_cents, line_subtotal_cents,
                             tax_code_id, tax_rate_bps, tax_cents, line_total_cents,
                             income_account_id)
    VALUES
    (p_tenant_id, v_inv3, 1, v_item_chair, 'Office chair (ergonomic)',
     12, 1850000, 22200000, v_vat18_tax_id, 1800, 3996000, 26196000, v_sales_id),
    (p_tenant_id, v_inv3, 2, v_item_lamp,  'LED desk lamp',
     10, 480000, 4800000, v_vat18_tax_id, 1800, 864000, 5664000, v_sales_id),
    (p_tenant_id, v_inv3, 3, v_item_delivery, 'Delivery fee',
     1, 500000, 500000, v_vat18_tax_id, 1800, 90000, 590000, v_sales_id);

  -- Inv 4: Sea Breeze Hotels, paid, 18 days ago
  INSERT INTO invoices (tenant_id, invoice_number, customer_id, branch_id,
                        status, issue_date, due_date,
                        subtotal_cents, tax_cents, total_cents,
                        amount_paid_cents, balance_due_cents,
                        notes, posted_at)
    VALUES (p_tenant_id, 'INV-DEMO-004', v_cust_sea_breeze, v_branch_id,
            'paid', v_today - 18, v_today + 3,
            6000000, 1080000, 7080000,
            7080000, 0,
            'Demo: Q-end consulting engagement.', (v_today - 18)::timestamptz)
    RETURNING id INTO v_inv4;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'invoices', v_inv4);
  INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, item_id, description,
                             quantity, unit_price_cents, line_subtotal_cents,
                             tax_code_id, tax_rate_bps, tax_cents, line_total_cents,
                             income_account_id)
    VALUES (p_tenant_id, v_inv4, 1, v_item_consult, 'Consulting (per hour)',
            8, 750000, 6000000, v_vat18_tax_id, 1800, 1080000, 7080000, v_sales_id);

  -- Inv 5: Sunrise Trading, posted overdue, 5 days ago issue / due 0 days
  INSERT INTO invoices (tenant_id, invoice_number, customer_id, branch_id,
                        status, issue_date, due_date,
                        subtotal_cents, tax_cents, total_cents,
                        amount_paid_cents, balance_due_cents,
                        notes, posted_at)
    VALUES (p_tenant_id, 'INV-DEMO-005', v_cust_sunrise, v_branch_id,
            'posted', v_today - 5, v_today - 5,
            1450000, 261000, 1711000,
            0, 1711000,
            'Demo: walk-in piping order.', (v_today - 5)::timestamptz)
    RETURNING id INTO v_inv5;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'invoices', v_inv5);
  INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, item_id, description,
                             quantity, unit_price_cents, line_subtotal_cents,
                             tax_code_id, tax_rate_bps, tax_cents, line_total_cents,
                             income_account_id)
    VALUES (p_tenant_id, v_inv5, 1, v_item_pipe, 'PVC pipe (2-inch)',
            10, 145000, 1450000, v_vat18_tax_id, 1800, 261000, 1711000, v_sales_id);

  -- Inv 6: Lanka Mart, posted, 2 days ago — fresh receivable
  INSERT INTO invoices (tenant_id, invoice_number, customer_id, branch_id,
                        status, issue_date, due_date,
                        subtotal_cents, tax_cents, total_cents,
                        amount_paid_cents, balance_due_cents,
                        notes, posted_at)
    VALUES (p_tenant_id, 'INV-DEMO-006', v_cust_lanka_mart, v_branch_id,
            'posted', v_today - 2, v_today + 28,
            9600000, 1728000, 11328000,
            0, 11328000,
            'Demo: steel re-stock.', (v_today - 2)::timestamptz)
    RETURNING id INTO v_inv6;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'invoices', v_inv6);
  INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, item_id, description,
                             quantity, unit_price_cents, line_subtotal_cents,
                             tax_code_id, tax_rate_bps, tax_cents, line_total_cents,
                             income_account_id)
    VALUES (p_tenant_id, v_inv6, 1, v_item_steel, 'Steel reinforcement bar (12mm)',
            30, 320000, 9600000, v_vat18_tax_id, 1800, 1728000, 11328000, v_sales_id);

  -- ---- Customer payments (3, allocated against the paid/partial invoices) ----
  -- Pay 1: full payment for Inv 1
  INSERT INTO customer_payments (tenant_id, payment_number, customer_id,
                                 payment_date, method, amount_cents,
                                 bank_account_id, reference, status, posted_at)
    VALUES (p_tenant_id, 'PAY-DEMO-001', v_cust_lanka_mart,
            v_today - 40, 'bank_transfer', 5900000,
            v_bank_id, 'BOC-REF-DEMO-1', 'posted', (v_today - 40)::timestamptz)
    RETURNING id INTO v_pay1;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'customer_payments', v_pay1);
  INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, allocated_cents)
    VALUES (p_tenant_id, v_pay1, v_inv1, 5900000);

  -- Pay 2: partial payment for Inv 2 (Rs 20,000)
  INSERT INTO customer_payments (tenant_id, payment_number, customer_id,
                                 payment_date, method, amount_cents,
                                 bank_account_id, reference, status, posted_at)
    VALUES (p_tenant_id, 'PAY-DEMO-002', v_cust_spice_garden,
            v_today - 18, 'cash', 2000000,
            v_cash_id, NULL, 'posted', (v_today - 18)::timestamptz)
    RETURNING id INTO v_pay2;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'customer_payments', v_pay2);
  INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, allocated_cents)
    VALUES (p_tenant_id, v_pay2, v_inv2, 2000000);

  -- Pay 3: full payment for Inv 4
  INSERT INTO customer_payments (tenant_id, payment_number, customer_id,
                                 payment_date, method, amount_cents,
                                 bank_account_id, reference, status, posted_at)
    VALUES (p_tenant_id, 'PAY-DEMO-003', v_cust_sea_breeze,
            v_today - 10, 'bank_transfer', 7080000,
            v_bank_id, 'COMM-REF-DEMO-3', 'posted', (v_today - 10)::timestamptz)
    RETURNING id INTO v_pay3;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'customer_payments', v_pay3);
  INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, allocated_cents)
    VALUES (p_tenant_id, v_pay3, v_inv4, 7080000);

  -- ---- Bills (4, mixed status) ----
  -- Bill 1: Galaxy Distributors, paid, 35 days ago
  INSERT INTO bills (tenant_id, internal_reference, supplier_bill_number,
                     supplier_id, branch_id, status,
                     bill_date, due_date,
                     subtotal_cents, tax_cents, total_cents,
                     amount_paid_cents, balance_due_cents,
                     notes, posted_at)
    VALUES (p_tenant_id, 'BIL-DEMO-001', 'GAL-INV-2026-441',
            v_sup_galaxy, v_branch_id, 'paid',
            v_today - 35, v_today - 5,
            3900000, 702000, 4602000,
            4602000, 0,
            'Demo: cement re-stock.', (v_today - 35)::timestamptz)
    RETURNING id INTO v_bill1;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'bills', v_bill1);
  INSERT INTO bill_lines (tenant_id, bill_id, line_no, item_id, description,
                          quantity, unit_price_cents, line_subtotal_cents,
                          tax_code_id, tax_rate_bps, tax_cents, line_total_cents,
                          expense_account_id)
    VALUES (p_tenant_id, v_bill1, 1, v_item_cement, 'Cement bag (50kg)',
            20, 195000, 3900000, v_vat18_tax_id, 1800, 702000, 4602000, v_cogs_id);

  -- Bill 2: Nimal Stationery, posted, 8 days ago
  INSERT INTO bills (tenant_id, internal_reference, supplier_bill_number,
                     supplier_id, branch_id, status,
                     bill_date, due_date,
                     subtotal_cents, tax_cents, total_cents,
                     amount_paid_cents, balance_due_cents,
                     notes, posted_at)
    VALUES (p_tenant_id, 'BIL-DEMO-002', 'NS-2604',
            v_sup_nimal, v_branch_id, 'posted',
            v_today - 8, v_today + 6,
            450000, 81000, 531000,
            0, 531000,
            'Demo: office stationery.', (v_today - 8)::timestamptz)
    RETURNING id INTO v_bill2;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'bills', v_bill2);
  INSERT INTO bill_lines (tenant_id, bill_id, line_no, description,
                          quantity, unit_price_cents, line_subtotal_cents,
                          tax_code_id, tax_rate_bps, tax_cents, line_total_cents,
                          expense_account_id)
    VALUES (p_tenant_id, v_bill2, 1, 'Stationery, printer paper, pens',
            1, 450000, 450000, v_vat18_tax_id, 1800, 81000, 531000, v_cogs_id);

  -- Bill 3: ABC Printing, posted unpaid, 15 days ago
  INSERT INTO bills (tenant_id, internal_reference, supplier_bill_number,
                     supplier_id, branch_id, status,
                     bill_date, due_date,
                     subtotal_cents, tax_cents, total_cents,
                     amount_paid_cents, balance_due_cents,
                     notes, posted_at)
    VALUES (p_tenant_id, 'BIL-DEMO-003', 'ABC-2026-088',
            v_sup_abc_print, v_branch_id, 'posted',
            v_today - 15, v_today - 8,
            1200000, 216000, 1416000,
            0, 1416000,
            'Demo: brochure print run.', (v_today - 15)::timestamptz)
    RETURNING id INTO v_bill3;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'bills', v_bill3);
  INSERT INTO bill_lines (tenant_id, bill_id, line_no, description,
                          quantity, unit_price_cents, line_subtotal_cents,
                          tax_code_id, tax_rate_bps, tax_cents, line_total_cents,
                          expense_account_id)
    VALUES (p_tenant_id, v_bill3, 1, 'A4 brochure print run (2,000 copies)',
            1, 1200000, 1200000, v_vat18_tax_id, 1800, 216000, 1416000, v_cogs_id);

  -- Bill 4: Reliable Logistics, partially paid, 20 days ago
  INSERT INTO bills (tenant_id, internal_reference, supplier_bill_number,
                     supplier_id, branch_id, status,
                     bill_date, due_date,
                     subtotal_cents, tax_cents, total_cents,
                     amount_paid_cents, balance_due_cents,
                     notes, posted_at)
    VALUES (p_tenant_id, 'BIL-DEMO-004', 'RL-26-1102',
            v_sup_reliable, v_branch_id, 'posted',
            v_today - 20, v_today + 10,
            2800000, 504000, 3304000,
            0, 3304000,
            'Demo: Q1 transport charges.', (v_today - 20)::timestamptz)
    RETURNING id INTO v_bill4;
  INSERT INTO demo_data_seeds(tenant_id, table_name, record_id) VALUES (p_tenant_id, 'bills', v_bill4);
  INSERT INTO bill_lines (tenant_id, bill_id, line_no, description,
                          quantity, unit_price_cents, line_subtotal_cents,
                          tax_code_id, tax_rate_bps, tax_cents, line_total_cents,
                          expense_account_id)
    VALUES (p_tenant_id, v_bill4, 1, 'Inter-province transport — January',
            1, 2800000, 2800000, v_vat18_tax_id, 1800, 504000, 3304000, v_cogs_id);

  SELECT count(*) INTO v_inserted FROM demo_data_seeds WHERE tenant_id = p_tenant_id;
  RAISE NOTICE 'seed_demo_data: tenant % seeded with % records.', p_tenant_id, v_inserted;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION seed_demo_data(uuid) TO pettahpro_app;

-- ---------------------------------------------------------------
-- clear_demo_data(p_tenant_id) — removes everything seed_demo_data
-- inserted (or whatever subset survives — see file header). Walks
-- the tracking table newest-first because invoices/bills depend on
-- customers/suppliers/items via FK.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION clear_demo_data(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  r           record;
  v_deleted   integer := 0;
  v_existed   boolean;
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);

  FOR r IN
    SELECT id, table_name, record_id
      FROM demo_data_seeds
      WHERE tenant_id = p_tenant_id
      ORDER BY seeded_at DESC, id DESC
  LOOP
    -- Use dynamic SQL because table name varies per row.
    -- format(%I,...) properly quotes the identifier; record_id is
    -- a typed uuid bound parameter so no SQL-injection risk.
    BEGIN
      EXECUTE format('DELETE FROM %I WHERE tenant_id = $1 AND id = $2', r.table_name)
        USING p_tenant_id, r.record_id;
      GET DIAGNOSTICS v_existed = ROW_COUNT;
      IF v_existed THEN
        v_deleted := v_deleted + 1;
      END IF;
    EXCEPTION WHEN foreign_key_violation THEN
      -- The user posted a payment / journal entry / etc. that now
      -- references a demo record. Skip the demo row rather than
      -- failing the whole reset — leave it for the user to handle.
      RAISE NOTICE 'clear_demo_data: skipping % %: still referenced.', r.table_name, r.record_id;
    END;
    DELETE FROM demo_data_seeds WHERE id = r.id;
  END LOOP;

  RAISE NOTICE 'clear_demo_data: tenant % — % demo records removed.', p_tenant_id, v_deleted;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_demo_data(uuid) TO pettahpro_app;
