-- Customer statement email delivery (#21)
--
-- Two concerns here:
--   1. Tenants need a button to email a customer their statement of account
--      (transactions + aging) on demand.
--   2. Tenants want to schedule that same email to go out automatically on a
--      specific day each month for specific customers (typically 1st of the
--      month, for every credit customer).
--
-- What this migration adds:
--   · customers.auto_statement_email  — toggle per customer
--   · customers.statement_email_day   — 1..28 day-of-month to send
--   · customer_statement_emails       — send log: one row per delivery attempt,
--                                       whether it succeeded or failed
--
-- The log table is append-only at the application layer but doesn't enforce
-- it at the DB layer — unlike audit_events, a stuck/flaky send may need an
-- admin to retry or mark as failed. Keeping it editable lets us keep that
-- door open without hacks.
--
-- Idempotent: every DDL uses IF NOT EXISTS / DROP...CREATE, safe to re-apply.

-- 1. Per-customer auto-send flags ------------------------------------------

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS auto_statement_email boolean NOT NULL DEFAULT false;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS statement_email_day smallint;

-- Clamp to a real day-of-month. Using 1..28 keeps it safe across every month
-- (Feb has only 28 days in non-leap years; choosing 31 would silently skip
-- short months). Tenants who really want "last day of month" can pick 28 for
-- now — a LAST_DAY option can be added later.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_statement_email_day_check;
ALTER TABLE customers ADD CONSTRAINT customers_statement_email_day_check
  CHECK (statement_email_day IS NULL OR (statement_email_day BETWEEN 1 AND 28));

-- 2. Send log --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_statement_emails (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id        uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- Snapshot of the email we sent — surviving customer email edits so history
  -- reads true even if the address later changes.
  to_email           varchar(255) NOT NULL,
  cc_emails          jsonb NOT NULL DEFAULT '[]',
  subject            varchar(500) NOT NULL,
  -- Statement window the email covered, captured so the history view can show
  -- "Feb 1 – Feb 28 statement sent on Mar 1" without re-deriving.
  statement_from     date,
  statement_to       date NOT NULL,
  opening_balance_cents bigint NOT NULL DEFAULT 0,
  closing_balance_cents bigint NOT NULL DEFAULT 0,
  transaction_count  integer NOT NULL DEFAULT 0,
  status             varchar(16) NOT NULL,  -- 'sent' | 'failed' | 'skipped'
  error_message      text,
  message_id         varchar(255),           -- SMTP Message-Id for reference
  transport          varchar(16) NOT NULL DEFAULT 'smtp',  -- 'smtp' | 'console'
  -- 'manual' | 'scheduled' — lets the UI group ad-hoc sends apart from cron.
  trigger_kind       varchar(16) NOT NULL DEFAULT 'manual',
  triggered_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_statement_emails_status_check
    CHECK (status IN ('sent','failed','skipped')),
  CONSTRAINT customer_statement_emails_trigger_check
    CHECK (trigger_kind IN ('manual','scheduled'))
);

CREATE INDEX IF NOT EXISTS customer_statement_emails_tenant_customer_idx
  ON customer_statement_emails(tenant_id, customer_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS customer_statement_emails_tenant_sent_idx
  ON customer_statement_emails(tenant_id, sent_at DESC);

-- Partial index for "did we already send a scheduled email this cycle" lookup.
-- The monthly cron uses it to avoid duplicate sends on the same day.
CREATE INDEX IF NOT EXISTS customer_statement_emails_scheduled_today
  ON customer_statement_emails(tenant_id, customer_id, sent_at)
  WHERE trigger_kind = 'scheduled';

ALTER TABLE customer_statement_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_statement_emails FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_statement_emails_isolation ON customer_statement_emails;
CREATE POLICY customer_statement_emails_isolation ON customer_statement_emails
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 3. Cross-tenant helper for the monthly cron ------------------------------
--
-- The daily dispatcher (apps/api/src/worker.ts) runs without tenant context
-- set and needs to see every tenant's customers. SECURITY DEFINER bypasses
-- RLS so we get a flat list of (customer_id, tenant_id) to iterate through.
--
-- Day-of-month match is intentionally inclusive on both sides — a customer
-- set for day 31 won't match in Feb, so we cap the column at 28 above. If a
-- cron run is missed (worker down), the following day won't resend — this is
-- deliberate. Operators can re-run by toggling the flag off and back on or
-- using the manual send button.
CREATE OR REPLACE FUNCTION list_customers_for_statement_email(as_of date)
RETURNS TABLE(customer_id uuid, tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT c.id, c.tenant_id
    FROM customers c
   WHERE c.auto_statement_email = true
     AND c.is_active = true
     AND c.deleted_at IS NULL
     AND c.statement_email_day = EXTRACT(day FROM as_of)::smallint
     AND NOT EXISTS (
       -- Dedupe: if we already logged a scheduled send for this customer
       -- today, don't send again. Protects against the dispatcher running
       -- multiple times per day (e.g. after a worker restart).
       SELECT 1
         FROM customer_statement_emails e
        WHERE e.tenant_id = c.tenant_id
          AND e.customer_id = c.id
          AND e.trigger_kind = 'scheduled'
          AND e.sent_at::date = as_of
     );
$$;
