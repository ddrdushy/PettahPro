-- Immediate email delivery for notifications (roadmap #53, gap D1).
--
-- Extends the digest plumbing from #45 with a per-preference
-- `email_enabled` flag that turns a `cadence='immediate'` row into
-- "in-app bell AND email." Daily/weekly digests already email (via
-- the digest cron from PR #62) so for those cadences email is
-- implicit; the new flag is only meaningful when cadence='immediate'.
--
-- Design notes:
--
--  * Default OFF for back-compat. Existing users have no rows in
--    notification_preferences, which means `cadence='immediate',
--    email_enabled=false` — the exact pre-#53 behaviour.
--
--  * When a user flips cadence to 'off', we force email_enabled=false
--    at the server layer too, so the UI stays consistent ("off" really
--    means off, no ghost emails).
--
--  * notification_digest_emails gets a wider CHECK on `cadence` so we
--    can log immediate sends into the same table. Keeps "did this
--    email actually go out?" a single-table grep. The `event_count`
--    for an immediate send is always 1; `window_start` == `window_end`
--    == emit time.
--
--  * No new table. No new index. Just one column + a CHECK relaxation.

-- =============================================================================
-- notification_preferences.email_enabled
-- =============================================================================

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS email_enabled boolean NOT NULL DEFAULT false;

-- =============================================================================
-- notification_digest_emails.cadence — allow 'immediate'
-- =============================================================================

ALTER TABLE notification_digest_emails
  DROP CONSTRAINT IF EXISTS notification_digest_emails_cadence_check;
ALTER TABLE notification_digest_emails
  ADD CONSTRAINT notification_digest_emails_cadence_check
  CHECK (cadence IN ('immediate', 'daily', 'weekly'));
