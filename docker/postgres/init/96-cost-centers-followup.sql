-- 96-cost-centers-followup.sql — extend cost-center dimension to
-- bills + manual journal entries (#132).
--
-- v1 (95-cost-centers.sql) shipped the dimension on invoices only —
-- bills, payments, payroll, and manual JEs all kept journal_lines
-- .cost_center_id NULL. This adds the next two highest-volume sources:
--
--   * bills.cost_center_id — propagates on bill post, same pattern
--     as invoice. Bills are the AP-side mirror; tenants who tag
--     invoices by cost center expect bills to roll into the same
--     buckets for "P&L by branch / project."
--   * journal_entries.cost_center_id — manual JEs let an accountant
--     tag a one-off entry (year-end adjustment, accrual reversal)
--     to a specific center. Auto-posted JEs inherit the dimension
--     from their source doc (invoice/bill); the column is mostly
--     for the manual-entry path.
--
-- Payments, payroll, and per-line splits stay deferred — payments
-- inherit the parent doc's center implicitly via the AR/AP lines
-- already getting tagged in step 1; payroll has multi-employee
-- complexity worth its own PR; per-line splits are a UX-heavy
-- feature most tenants don't need on day one.
--
-- Idempotent — ADD COLUMN IF NOT EXISTS.

ALTER TABLE bills
    ADD COLUMN IF NOT EXISTS cost_center_id uuid
        REFERENCES cost_centers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bills_cost_center_idx
    ON bills (tenant_id, cost_center_id)
    WHERE cost_center_id IS NOT NULL;

ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS cost_center_id uuid
        REFERENCES cost_centers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS journal_entries_cost_center_idx
    ON journal_entries (tenant_id, cost_center_id)
    WHERE cost_center_id IS NOT NULL;
