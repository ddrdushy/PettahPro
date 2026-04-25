-- 94-subscription-pause.sql — pause/resume subscription lifecycle
-- (pricing-spec §11.3).
--
-- Adds a fifth state `paused` to tenant_subscriptions. Use case:
-- seasonal businesses (SL has plenty — tourism, monsoon trades) want
-- to suspend billing without losing their data. Spec rules:
--   * Available on every plan
--   * Tenant pauses → billing stops, data retained
--   * Max 90-day pause; re-pause allowed with 30-day gap (enforced
--     at app layer, not DB)
--   * Resume anytime → billing resumes from resume date (no
--     back-billing)
--
-- Five new columns capture pause metadata. Gate logic in plan-gate.ts
-- treats `paused` similarly to `cancelled` (denies gated features)
-- but with a distinct error code so the UI can render a "paused —
-- click resume" prompt instead of the "contact support" path.
--
-- Auto-resume is folded into the renewal-cron (#124): every daily
-- tick, paused rows whose resume_at has elapsed flip back to active.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DO $ block for the CHECK
-- widening so re-running on a partially-migrated DB is a no-op.

-- Widen the status CHECK constraint to include 'paused'. Postgres
-- doesn't have ALTER CHECK, so drop + recreate.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'tenant_subscriptions_status_allowed'
           AND conrelid = 'tenant_subscriptions'::regclass
    ) THEN
        ALTER TABLE tenant_subscriptions
            DROP CONSTRAINT tenant_subscriptions_status_allowed;
    END IF;
    ALTER TABLE tenant_subscriptions
        ADD CONSTRAINT tenant_subscriptions_status_allowed
        CHECK (status IN ('trial', 'active', 'past_due', 'paused', 'cancelled'));
END
$$;

ALTER TABLE tenant_subscriptions
    -- When the pause was requested. Cleared on resume so a re-pause
    -- starts a fresh window.
    ADD COLUMN IF NOT EXISTS paused_at timestamptz,
    -- Why the tenant paused. Free-form, captured for ops + audit.
    ADD COLUMN IF NOT EXISTS pause_reason varchar(500),
    -- Optional auto-resume date. NULL = manual resume only. When set,
    -- the renewal-cron flips status back to 'active' on the next tick
    -- after resume_at has elapsed.
    ADD COLUMN IF NOT EXISTS resume_at timestamptz,
    -- Who triggered the pause. Tenant-side pauses set the user_id;
    -- platform-admin pauses set the platform_user_id.
    ADD COLUMN IF NOT EXISTS paused_by_user_id uuid,
    ADD COLUMN IF NOT EXISTS paused_by_platform_user_id uuid;

-- Partial index on resume_at to make the auto-resume sweep cheap. Only
-- paused rows with a resume_at need scanning; everything else is
-- skipped at the index layer.
CREATE INDEX IF NOT EXISTS tenant_subscriptions_resume_at_idx
    ON tenant_subscriptions (resume_at)
    WHERE status = 'paused' AND resume_at IS NOT NULL;
