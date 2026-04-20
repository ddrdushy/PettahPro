-- Seed-defaults function — called once per tenant at signup.
-- Populates: head-office branch, main warehouse, standard SL COA, SL tax codes,
-- and the current fiscal period.

CREATE OR REPLACE FUNCTION seed_tenant_defaults(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_branch_id          uuid;
  v_bank_id            uuid;
  v_cash_id            uuid;
  v_ar_id              uuid;
  v_ap_id              uuid;
  v_inv_id             uuid;
  v_vat_pay_id         uuid;
  v_vat_rec_id         uuid;
  v_wht_pay_id         uuid;
  v_retained_id        uuid;
  v_sales_id           uuid;
  v_sales_ret_id       uuid;
  v_cogs_id            uuid;
  v_rent_id            uuid;
  v_salary_id          uuid;
  v_util_id            uuid;
  v_other_inc_id       uuid;
  v_other_exp_id       uuid;
  v_now                date := current_date;
  v_fy                 smallint := EXTRACT(year FROM v_now)::smallint;
  v_month_start        date := date_trunc('month', v_now)::date;
  v_month_end          date := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;
BEGIN
  -- Set tenant context for RLS inside this transaction.
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);

  -- 1. Branch + warehouse
  INSERT INTO branches (tenant_id, code, name, is_head_office, is_active)
    VALUES (p_tenant_id, 'HO', 'Head Office', true, true)
    RETURNING id INTO v_branch_id;

  INSERT INTO warehouses (tenant_id, branch_id, code, name, is_default, is_active)
    VALUES (p_tenant_id, v_branch_id, 'MAIN', 'Main Warehouse', true, true);

  -- 2. Chart of accounts — compact SL-typical template.
  -- Assets (1xxx)
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '1000', 'Cash on hand',            'asset',     'cash',      'dr', true) RETURNING id INTO v_cash_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '1010', 'Bank — primary',          'asset',     'bank',      'dr', true) RETURNING id INTO v_bank_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '1020', 'Bank — cheques in transit',  'asset',  'bank_transit',  'dr', true);
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '1030', 'Bank — cheques in clearing', 'asset',  'bank_clearing', 'dr', true);
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '1100', 'Accounts receivable',     'asset',     'ar',        'dr', true) RETURNING id INTO v_ar_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '1200', 'Inventory',               'asset',     'inventory', 'dr', true) RETURNING id INTO v_inv_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '1300', 'VAT recoverable',         'asset',     'tax',       'dr', true) RETURNING id INTO v_vat_rec_id;

  -- Liabilities (2xxx)
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '2000', 'Accounts payable',        'liability', 'ap',        'cr', true) RETURNING id INTO v_ap_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '2100', 'VAT payable',             'liability', 'tax',       'cr', true) RETURNING id INTO v_vat_pay_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '2110', 'WHT payable',             'liability', 'tax',       'cr', true) RETURNING id INTO v_wht_pay_id;

  -- Equity (3xxx)
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '3000', 'Owner''s equity',         'equity',    'equity',    'cr', true);
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '3100', 'Retained earnings',       'equity',    'retained',  'cr', true) RETURNING id INTO v_retained_id;

  -- Income (4xxx)
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '4000', 'Sales revenue',           'income',    'sales',     'cr', true) RETURNING id INTO v_sales_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '4010', 'Sales returns & allowances','income',  'returns',   'dr', true) RETURNING id INTO v_sales_ret_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '4900', 'Other income',            'income',    'other',     'cr', true) RETURNING id INTO v_other_inc_id;

  -- Expenses (5xxx cost of goods, 6xxx operating)
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '5000', 'Cost of goods sold',      'expense',   'cogs',      'dr', true) RETURNING id INTO v_cogs_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '6000', 'Salaries & wages',        'expense',   'payroll',   'dr', true) RETURNING id INTO v_salary_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '6100', 'Rent',                    'expense',   'rent',      'dr', true) RETURNING id INTO v_rent_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '6200', 'Utilities',               'expense',   'utilities', 'dr', true) RETURNING id INTO v_util_id;
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '6300', 'Bank charges',            'expense',   'bank_fees', 'dr', true);
  INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
    VALUES (p_tenant_id, '6900', 'Other operating expenses','expense',   'other',     'dr', true) RETURNING id INTO v_other_exp_id;

  -- 3. Tax codes — SL defaults
  INSERT INTO tax_codes (tenant_id, code, name, tax_kind, rate_bps, applies_to,
                         payable_account_id, receivable_account_id, is_system, effective_from)
    VALUES
    (p_tenant_id, 'VAT18', 'VAT 18%',       'vat',    1800, 'both',     v_vat_pay_id, v_vat_rec_id, true, v_month_start),
    (p_tenant_id, 'VAT0',  'VAT 0% (zero)', 'zero',   0,    'both',     NULL,         NULL,         true, v_month_start),
    (p_tenant_id, 'EXEMPT','Exempt',        'exempt', 0,    'both',     NULL,         NULL,         true, v_month_start),
    (p_tenant_id, 'SSCL25','SSCL 2.5%',     'sscl',   250,  'both',     v_vat_pay_id, NULL,         true, v_month_start),
    (p_tenant_id, 'WHT5',  'WHT 5% (services)', 'wht', 500, 'purchase', v_wht_pay_id, NULL,         true, v_month_start),
    (p_tenant_id, 'WHT10', 'WHT 10% (rent)',   'wht', 1000, 'purchase', v_wht_pay_id, NULL,         true, v_month_start);

  -- 4. Current fiscal period (monthly)
  INSERT INTO fiscal_periods (tenant_id, fiscal_year, period_no, starts_on, ends_on, status)
    VALUES (p_tenant_id, v_fy, EXTRACT(month FROM v_now)::smallint, v_month_start, v_month_end, 'open');

  -- 5. Document-number sequences
  -- Only insert if the table exists (idempotent across schema versions).
  IF to_regclass('public.document_sequences') IS NOT NULL THEN
    INSERT INTO document_sequences (tenant_id, sequence_name, prefix, scope, pad_width)
    VALUES
      (p_tenant_id, 'invoice',       'INV', 'year', 4),
      (p_tenant_id, 'bill',          'BIL', 'year', 4),
      (p_tenant_id, 'payment',       'PAY', 'year', 4),
      (p_tenant_id, 'receipt',       'RCP', 'year', 4),
      (p_tenant_id, 'journal',       'JV',  'year', 4),
      (p_tenant_id, 'credit_note',   'CN',  'year', 4),
      (p_tenant_id, 'quotation',     'QUO', 'year', 4),
      (p_tenant_id, 'purchase_order','PO',  'year', 4),
      (p_tenant_id, 'grn',           'GRN', 'year', 4)
    ON CONFLICT (tenant_id, sequence_name) DO NOTHING;
  END IF;
END;
$$;
