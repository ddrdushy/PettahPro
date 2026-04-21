-- Customer credit enforcement: hold flag (hard block) + exposure check
-- against customers.credit_limit_cents at invoice-post time (soft block,
-- unless the customer is also on hold — then it's hard).
--
-- Triggers (added in application code, not SQL):
--   • Invoice post  → if credit_hold, 409. Else if limit > 0 and the
--     post would push open balance above limit, 409.
--   • Cheque bounce → if this is the customer's 2nd+ bounce, auto-set
--     credit_hold with reason "2+ bounced cheques".

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_hold         boolean NOT NULL DEFAULT false;
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_hold_reason  text;
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_hold_at      timestamptz;

-- Helper: sum of open (posted / partially_paid) invoice balances for a
-- customer. Used at invoice-post to calculate exposure.
CREATE OR REPLACE FUNCTION customer_open_ar_cents(p_customer_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(balance_due_cents), 0)::bigint
    FROM invoices
   WHERE tenant_id   = current_tenant_id()
     AND customer_id = p_customer_id
     AND deleted_at IS NULL
     AND status IN ('posted', 'partially_paid')
$$;

-- Helper: count bounced cheques (direction='received' ∩ status='bounced')
-- for a customer. Used for the 2-bounce auto-flag.
CREATE OR REPLACE FUNCTION customer_bounce_count(p_customer_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::int
    FROM cheques
   WHERE tenant_id   = current_tenant_id()
     AND customer_id = p_customer_id
     AND direction   = 'received'
     AND status      = 'bounced'
$$;
