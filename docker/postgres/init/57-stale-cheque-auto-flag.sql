-- Stale cheque auto-flag (roadmap #37)
--
-- Context: Sri Lanka banking convention (and our create.ts) set every cheque's
-- stale_at = cheque_date + 6 months. Banks will refuse to present a cheque past
-- that date. Before this migration, `stale_at` was recorded but nothing
-- transitioned cheques into `status='stale'` — users had to eyeball the date
-- themselves, and stale cheques kept showing up in "active" lists as if they
-- could still clear.
--
-- What this ships:
--   · replaced_by_cheque_id — nullable self-ref on cheques. When a stale issued
--     cheque is reissued to the supplier, the old row flips to status='replaced'
--     and points to the new cheque. Keeps the audit chain intact without
--     changing the old row's amount / JE linkage.
--   · idx_cheques_active_stale — partial index on (tenant_id, stale_at) for
--     only the states the daily flagger touches. Small, cheap, keeps the cron
--     job's seq-scan off the main table.
--   · flag_stale_cheques(tenant_id) — SQL function that does the UPDATE and
--     RETURNs the flipped rows so the worker can emit per-cheque notifications.
--     Runs under RLS: the worker impersonates each tenant in turn rather than
--     doing a global UPDATE as superuser.
--
-- States the flagger transitions OUT of:
--   received direction: received, deposited, in_clearing  (not yet cleared)
--   issued direction:   drafted, issued, presented        (not yet cleared)
-- States we never touch: cleared, bounced, cancelled, stale, reissued, replaced,
--   returned_to_customer. Already settled one way or another.
--
-- Idempotent: safe to re-run. Column adds are IF NOT EXISTS, function is
-- CREATE OR REPLACE, index is IF NOT EXISTS.

-- 1. Link column for reissue flow.
ALTER TABLE cheques
  ADD COLUMN IF NOT EXISTS replaced_by_cheque_id uuid
    REFERENCES cheques(id) ON DELETE SET NULL;

COMMENT ON COLUMN cheques.replaced_by_cheque_id IS
  'When a stale issued cheque is reissued to the supplier, the old row points here at the new cheque. Old row status flips to ''replaced''.';

-- 2. Partial index so the daily flagger stays cheap.
CREATE INDEX IF NOT EXISTS idx_cheques_active_stale
  ON cheques (tenant_id, stale_at)
  WHERE status IN ('drafted', 'issued', 'presented', 'received', 'deposited', 'in_clearing');

-- 3. Flagger. Runs per-tenant under RLS. Returns the flipped rows so the
--    worker can fan out notifications (one "cheque stale" event per row).
CREATE OR REPLACE FUNCTION flag_stale_cheques()
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  cheque_number varchar,
  direction varchar,
  amount_cents bigint,
  stale_at date,
  customer_id uuid,
  supplier_id uuid,
  bank_account_id uuid
)
LANGUAGE sql
AS $$
  UPDATE cheques
     SET status     = 'stale',
         updated_at = now()
   WHERE status IN (
           'drafted', 'issued', 'presented',
           'received', 'deposited', 'in_clearing'
         )
     AND stale_at IS NOT NULL
     AND stale_at <= CURRENT_DATE
  RETURNING
    cheques.id,
    cheques.tenant_id,
    cheques.cheque_number,
    cheques.direction,
    cheques.amount_cents,
    cheques.stale_at,
    cheques.customer_id,
    cheques.supplier_id,
    cheques.bank_account_id;
$$;

COMMENT ON FUNCTION flag_stale_cheques() IS
  'Flips all cheques whose stale_at has passed to status=stale. Respects RLS — callers set app.current_tenant_id first. Returns flipped rows for notification fan-out.';

-- Grant execution to the app role (matches the pattern used by customer_bounce_count).
-- Guarded for envs that predate 44-auth-helpers.sql — ALTER DEFAULT PRIVILEGES
-- from that migration handles future functions automatically, but an explicit
-- grant here makes this migration self-contained when re-run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pettahpro_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION flag_stale_cheques() TO pettahpro_app';
  END IF;
END
$$;
