-- 100-dunning.sql — failed-payment retry workflow
-- (pricing-plan-architecture-spec §10).
--
-- L2's last big gateway-agnostic piece. Three tables and one column:
--
--   * dunning_policies             — retry schedule + grace periods.
--                                    Per-plan with a platform default.
--   * subscription_charge_attempts — one row per attempt at billing
--                                    a subscription. Stub or real,
--                                    success or failure, with full
--                                    state machine transitions captured
--                                    in audit log on every write.
--   * tenant_subscriptions.next_charge_attempt_at  — when the worker
--                                    should next try this subscription.
--                                    NULL = no charge pending; non-NULL
--                                    means "try at or after this time".
--
-- The workflow:
--   1. Daily cron picks subs whose period is rolling soon (or whose
--      last charge failed and next_retry_at is in the past).
--   2. Charge attempt is recorded as 'pending' → calls gateway → flips
--      to 'succeeded' or 'failed' with gateway response captured.
--   3. On failure, look up the dunning policy for the sub's plan, find
--      the next retry interval based on attempt_number, schedule it
--      on the subscription, and write the audit log.
--   4. After N failed attempts (suspend_after_attempts in the policy),
--      the subscription transitions to cancelled. No more retries.
--
-- The `SUBSCRIPTION_PAYMENT_STUB=1` env flag is preserved — it makes
-- the gateway call a no-op (always succeed). For testing dunning,
-- `SUBSCRIPTION_STUB_FAILURE_TENANTS` (comma-separated tenant UUIDs)
-- forces failure for specific tenants so we can exercise the retry +
-- escalation flow without a real gateway.
--
-- Outside RLS: dunning is platform-managed, not tenant-managed. The
-- tenant-side queries scope to their own tenant_id at the API layer.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF
-- NOT EXISTS, seed default policy via WHERE NOT EXISTS.

-- =====================================================================
-- dunning_policies — per-plan retry schedule + escalation rules
-- =====================================================================

CREATE TABLE IF NOT EXISTS dunning_policies (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    -- NULL = platform-wide default applied to any plan that doesn't
    -- have its own policy. Exactly one NULL row enforced via partial
    -- unique index below.
    plan_id uuid REFERENCES plans(id) ON DELETE CASCADE,
    -- Display name for ops UI. "Default", "Starter", "Custom — Acme".
    name varchar(80) NOT NULL DEFAULT 'Default',
    -- jsonb array of integers, days from initial failure. Index 0 is
    -- the wait between fail-1 and fail-2; index 1 is fail-2 → fail-3;
    -- etc. Length determines how many retries before suspension.
    -- Default [1, 3, 7, 14] = retry 1d, 3d, 7d, 14d after first fail
    -- (4 retries total, 5 attempts including the initial), then
    -- suspend if all five fail. Spec §10 lists this as a typical
    -- cadence.
    retry_intervals_days jsonb NOT NULL DEFAULT '[1, 3, 7, 14]'::jsonb,
    -- After this many TOTAL failed attempts (including the initial),
    -- the subscription transitions to cancelled. Should match the
    -- length of retry_intervals_days + 1 (initial + retries). Stored
    -- explicitly so the worker doesn't have to count.
    suspend_after_attempts smallint NOT NULL DEFAULT 5,
    -- Days of grace between final failed attempt and actual
    -- suspension. The tenant gets a "last warning" email at the
    -- start of this window. Default 7 days = "you have a week to
    -- update your card before service stops".
    grace_period_days smallint NOT NULL DEFAULT 7,
    -- When (relative to next_charge_attempt_at) to send the first
    -- "your payment will be charged" reminder. NULL = no reminder.
    -- Negative = days BEFORE the charge (e.g. -3 = remind 3 days
    -- before billing).
    pre_charge_reminder_days smallint,
    -- Whether to show the past-due banner inside the tenant app once
    -- the first retry fails. Spec §10 says yes; default true. Some
    -- enterprise contracts may want it suppressed.
    show_in_app_banner boolean NOT NULL DEFAULT true,
    -- Email cadence. Each value is the attempt number AFTER which to
    -- send a "payment failed" email. [1, 3] = email after attempt 1
    -- (initial failure) and after attempt 3 (mid-retry warning).
    -- Final-warning email (24h before suspension) is hardcoded
    -- separately because its timing is policy-dependent.
    email_after_attempts jsonb NOT NULL DEFAULT '[1, 3, 5]'::jsonb,
    -- "Pause dunning" override. Super-admin sets this true on an
    -- individual policy or via the per-tenant override table when
    -- a customer is in a billing dispute and shouldn't be retried.
    -- Worker skips any subscription whose effective policy has this
    -- flag set.
    is_paused boolean NOT NULL DEFAULT false,
    notes varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Exactly one default (plan_id IS NULL) row.
CREATE UNIQUE INDEX IF NOT EXISTS dunning_policies_default_unique
    ON dunning_policies (plan_id)
    WHERE plan_id IS NULL;

-- One policy per plan when bound to a plan. plan_id NULL is excluded
-- by the partial unique index above; this one covers the bound case.
CREATE UNIQUE INDEX IF NOT EXISTS dunning_policies_plan_unique
    ON dunning_policies (plan_id)
    WHERE plan_id IS NOT NULL;

-- Seed the platform default. Re-running is a no-op via ON CONFLICT
-- (we'd hit the partial unique index).
INSERT INTO dunning_policies (plan_id, name)
SELECT NULL, 'Platform default'
WHERE NOT EXISTS (
    SELECT 1 FROM dunning_policies WHERE plan_id IS NULL
);

-- =====================================================================
-- subscription_charge_attempts — every charge attempt, ever
-- =====================================================================

CREATE TABLE IF NOT EXISTS subscription_charge_attempts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subscription_id uuid NOT NULL
        REFERENCES tenant_subscriptions(id) ON DELETE CASCADE,
    -- 1 = initial attempt for a given billing period. Subsequent
    -- attempts for the SAME period bump this. Resets to 1 when the
    -- period rolls over (next billing cycle starts).
    attempt_number smallint NOT NULL,
    -- LKR cents. Captured at attempt-time so retroactive plan price
    -- changes don't rewrite history. BIGINT to match plans.price.
    amount_cents bigint NOT NULL,
    -- Period this attempt is billing for. Lets us tie multiple
    -- attempts within a period together when the worker retries.
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    -- Status flow: pending → succeeded | failed | skipped
    --   * pending  — worker has scheduled / started the attempt
    --   * succeeded — gateway returned success
    --   * failed   — gateway returned failure
    --   * skipped  — worker decided not to charge (paused dunning,
    --                manual mark-paid, etc.)
    status varchar(16) NOT NULL DEFAULT 'pending',
    -- When the worker (or human) initiated the attempt.
    attempted_at timestamptz NOT NULL DEFAULT now(),
    -- Set when status flips off pending.
    completed_at timestamptz,
    -- Free-form. For real gateways, the response body or a structured
    -- subset. For the stub, "stub:success" or "stub:forced_failure".
    gateway_response varchar(2000),
    -- For failed attempts, machine-readable code (e.g. "card_expired",
    -- "insufficient_funds"). NULL when status != 'failed'.
    failure_code varchar(64),
    failure_reason varchar(500),
    -- The platform user who manually triggered this attempt. NULL for
    -- worker-driven retries. Lets ops see "who clicked Retry now?"
    triggered_by_platform_user_id uuid,
    -- The dunning_policies row in effect at attempt time. Stored so
    -- analytics on policy effectiveness over time stay accurate.
    dunning_policy_id uuid REFERENCES dunning_policies(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT charge_attempts_status_allowed CHECK (
        status IN ('pending', 'succeeded', 'failed', 'skipped')
    ),
    CONSTRAINT charge_attempts_amount_nonneg CHECK (amount_cents >= 0),
    CONSTRAINT charge_attempts_attempt_pos CHECK (attempt_number >= 1)
);

CREATE INDEX IF NOT EXISTS charge_attempts_tenant_idx
    ON subscription_charge_attempts (tenant_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS charge_attempts_subscription_idx
    ON subscription_charge_attempts (subscription_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS charge_attempts_status_idx
    ON subscription_charge_attempts (status)
    WHERE status = 'pending';

-- =====================================================================
-- tenant_subscriptions.next_charge_attempt_at
-- =====================================================================
--
-- The worker's queue field. Set when:
--   * A new period starts → set to current_period_end (charge at
--     period boundary).
--   * A charge fails and there are retries remaining → set to now() +
--     retry_intervals_days[attempt_number].
--   * Manual "retry now" → set to now().
-- Cleared when:
--   * Charge succeeds.
--   * Subscription transitions to cancelled / paused.
--   * Manual "skip to suspension".

ALTER TABLE tenant_subscriptions
    ADD COLUMN IF NOT EXISTS next_charge_attempt_at timestamptz,
    -- Counter of consecutive failed attempts in the CURRENT period.
    -- Resets to 0 on success or when the period rolls over without
    -- any attempts. Used by the worker to look up the next retry
    -- interval and to know when to give up.
    ADD COLUMN IF NOT EXISTS consecutive_failed_attempts smallint NOT NULL DEFAULT 0;

-- Partial index — only sub rows the worker needs to scan.
CREATE INDEX IF NOT EXISTS tenant_subscriptions_next_charge_idx
    ON tenant_subscriptions (next_charge_attempt_at)
    WHERE next_charge_attempt_at IS NOT NULL
      AND status IN ('active', 'past_due');
