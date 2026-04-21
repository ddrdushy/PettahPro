-- Bad-debt write-off with VAT relief.
-- SL rule: VAT charged on a bill that goes uncollected for >12 months can
-- be claimed back from IRD (Section 26 of the VAT Act). The write-off
-- workflow posts:
--
--   Write-off WITH VAT relief (invoice > 12 months old OR user opts in):
--     DR Bad debt expense    (balance_due − VAT portion)
--     DR VAT payable         (VAT portion)
--     CR Accounts receivable (balance_due)
--
--   Write-off WITHOUT VAT relief (recent invoices):
--     DR Bad debt expense    (balance_due)
--     CR Accounts receivable (balance_due)
--
-- Reversing the write-off (customer pays unexpectedly): flips every leg
-- and unmarks the invoice. Reversal uses today's date so it lands in an
-- open period regardless of when the original write-off was.

-- Extend status check to include 'written_off'.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft','posted','partially_paid','paid','void','written_off'));

-- Audit fields on invoices. vat_relief_cents captures how much of the
-- write-off was attributed to VAT recovery so the bad-debt report can
-- sum it up without re-deriving from journal lines.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS written_off_at           timestamptz;
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS writeoff_reason          text;
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS writeoff_journal_entry_id uuid
    REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS writeoff_vat_relief_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS writeoff_principal_cents  bigint NOT NULL DEFAULT 0;

-- Seed 6500 Bad debt expense for every tenant that doesn't have one.
INSERT INTO chart_of_accounts
  (tenant_id, code, name, account_type, account_subtype, normal_side, is_system)
SELECT t.id, '6500', 'Bad debt expense', 'expense', 'other', 'dr', true
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM chart_of_accounts c
    WHERE c.tenant_id = t.id AND c.code = '6500' AND c.deleted_at IS NULL
 );
