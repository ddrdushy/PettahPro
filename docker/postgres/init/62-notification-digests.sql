-- Notification digest windows (roadmap #45).
--
-- Extends the per-user per-kind notification_preferences table shipped
-- in PR #63 with a `cadence` column that captures "immediate in-app"
-- (current behaviour, the default) vs "daily" / "weekly" rollup emails.
-- A pending queue + email log sit alongside so emitNotification() can
-- divert digest-flagged events into a rollup instead of an in-app bell,
-- and a scheduled worker can coalesce them into one email per user per
-- window.
--
-- Design notes:
--
--  * Cadence extends, doesn't replace, the existing `enabled` flag.
--    `enabled=false` still means "drop this kind entirely" — the UI
--    maps that onto cadence='off' for UX clarity, but the server keeps
--    honouring both so existing rows remain correct without a backfill.
--
--  * notification_digest_queue holds ungrouped pending events. A row is
--    created by emitNotification() when the user's cadence for that kind
--    is daily/weekly. The scheduled worker groups by (user, cadence),
--    composes one email, and stamps `delivered_at` + `digest_email_id`
--    so the rows don't fire again.
--
--  * notification_digest_emails is the send-side log (parallel to
--    customer_statement_emails from PR #55). Same shape: one row per
--    attempt with status (sent/failed), message_id, transport, window
--    boundaries. Acts as the dedupe source: before sending a fresh
--    digest we verify there's no `status='sent'` row inside the min-gap
--    so an early cron tick plus a late one in the same tenant-local
--    hour can't double-send.
--
--  * Tenant-local timing: the worker reads `tenants.timezone` (default
--    'Asia/Colombo') and only fires for users whose tenant is in the
--    configured digest hour window (env `DIGEST_SEND_HOUR`, default 8).
--    v1 uses one global hour — per-user hour is a trivial follow-up if
--    tenants start asking for it. Weekly digests also require
--    tenant-local day-of-week == Monday.
--
--  * RLS: both new tables follow the same tenant-id RLS pattern as the
--    rest of the app. The scheduled worker already iterates tenants
--    outside RLS (same pattern as the depreciation cron) so it can
--    drive sends without per-tenant context-switching.

-- =============================================================================
-- notification_preferences.cadence
-- =============================================================================

-- Add `cadence` as a text-enum column with a CHECK constraint. Default is
-- 'immediate' so existing rows keep the current per-event in-app bell
-- behaviour. Values: 'off' | 'immediate' | 'daily' | 'weekly'. We keep
-- `enabled` because emitNotification() still honours it as a hard off
-- switch — server code treats enabled=false as equivalent to cadence='off',
-- so nothing needs a data backfill.

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS cadence varchar(16) NOT NULL DEFAULT 'immediate';

-- Drop-and-recreate the check so re-runs of this migration don't fail
-- when the column + constraint already exist.
ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_cadence_check;
ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_cadence_check
  CHECK (cadence IN ('off', 'immediate', 'daily', 'weekly'));

-- =============================================================================
-- notification_digest_queue — pending events waiting for the next digest
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification_digest_queue (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              varchar(64) NOT NULL,
  cadence           varchar(16) NOT NULL,
  title             varchar(255) NOT NULL,
  body              text NULL,
  ref_type          varchar(32) NULL,
  ref_id            uuid NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  delivered_at      timestamptz NULL,
  digest_email_id   uuid NULL,
  CONSTRAINT notification_digest_queue_cadence_check
    CHECK (cadence IN ('daily', 'weekly'))
);

-- Hot path is "pending items for a user" — this is what the worker scans
-- once per cron tick. Partial index keeps it lean.
CREATE INDEX IF NOT EXISTS notification_digest_queue_pending_idx
  ON notification_digest_queue (tenant_id, user_id, cadence, created_at)
  WHERE delivered_at IS NULL;

ALTER TABLE notification_digest_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_digest_queue FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_digest_queue_rw ON notification_digest_queue;
CREATE POLICY notification_digest_queue_rw ON notification_digest_queue
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- notification_digest_emails — send-side log
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification_digest_emails (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_email      varchar(255) NOT NULL,
  cadence       varchar(16) NOT NULL,
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  event_count   integer NOT NULL DEFAULT 0,
  kind_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        varchar(16) NOT NULL,
  error_message text NULL,
  message_id    varchar(255) NULL,
  transport     varchar(16) NOT NULL DEFAULT 'smtp',
  sent_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_digest_emails_cadence_check
    CHECK (cadence IN ('daily', 'weekly')),
  CONSTRAINT notification_digest_emails_status_check
    CHECK (status IN ('sent', 'failed', 'skipped'))
);

-- Dedupe support: the cron uses this index to answer "has this user
-- already been sent a 'daily' digest in the last N hours?" before
-- composing a fresh one. Weekly guard uses the same pattern with a
-- wider lookback.
CREATE INDEX IF NOT EXISTS notification_digest_emails_dedupe_idx
  ON notification_digest_emails (tenant_id, user_id, cadence, sent_at DESC)
  WHERE status = 'sent';

ALTER TABLE notification_digest_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_digest_emails FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_digest_emails_rw ON notification_digest_emails;
CREATE POLICY notification_digest_emails_rw ON notification_digest_emails
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Backfill FK on queue table (deferred so the emails table exists first).
-- IF NOT EXISTS pattern: check pg_constraint so reruns are safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_digest_queue_digest_email_id_fkey'
  ) THEN
    ALTER TABLE notification_digest_queue
      ADD CONSTRAINT notification_digest_queue_digest_email_id_fkey
      FOREIGN KEY (digest_email_id)
      REFERENCES notification_digest_emails(id)
      ON DELETE SET NULL;
  END IF;
END $$;
