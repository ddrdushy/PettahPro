-- Withholding tax on supplier payments.
-- SL practice: buyer withholds tax at payment time (not bill time), forwards
-- to IRD monthly. Three new columns carry the withheld amount + the rate
-- code applied + the WHT Payable GL account it went to.
--
-- Posting convention on a payment with WHT:
--   DR Accounts Payable         (gross / full bill allocation)
--   CR Bank                     (net = gross − wht)
--   CR WHT Payable              (wht portion; stays on the books until remit)
--
-- Remittance is a separate JE:
--   DR WHT Payable
--   CR Bank
-- ...with sourceType='wht_remit' so the history view can filter it.

ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS wht_cents         bigint NOT NULL DEFAULT 0;
ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS wht_tax_code_id   uuid
    REFERENCES tax_codes(id) ON DELETE SET NULL;
ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS wht_account_id    uuid
    REFERENCES chart_of_accounts(id) ON DELETE SET NULL;

-- WHT Payable account (code 2110) is already seeded per-tenant in
-- 07-seed-defaults.sql and the WHT5/WHT10 tax codes point at it via
-- payable_account_id, so we don't need to seed anything here.
