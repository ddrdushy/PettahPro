-- 98-tenant-health-scores.sql — per-tenant health snapshots (#134 /
-- super-admin spec §4.10, §11, §14.5).
--
-- Pairs with the L1 revenue analytics dashboard (#131): operators
-- need per-tenant churn-risk signal, not just aggregate MRR. The
-- score is a v1 heuristic — login activity, transaction trend,
-- subscription state — combined into 0-100. Real ML-based churn
-- prediction is L3 work; this is the "directional credibility on
-- one screen" version.
--
-- Snapshot table rather than a derived view: the cron computes
-- daily, persists, and the UI reads from the latest row. Two
-- benefits over recomputing on every page load: (1) historical
-- trend is queryable (did the score drop?), (2) the dashboard
-- doesn't trigger N expensive aggregate queries per render.
--
-- Score components (each 0-25):
--   * login_score — days since last login + frequency over 30d
--   * transaction_score — invoice/bill posting trend in last 30d
--   * subscription_score — status (active=full marks, past_due
--     mid, paused/trial-near-expiry low)
--   * setup_score — completeness signals: branches, customers,
--     items, fiscal periods seeded, etc.
--
-- Risk levels derived from total:
--   * 80-100 = healthy (low risk)
--   * 60-79  = medium
--   * 40-59  = high
--   * 0-39   = critical
--
-- All four sub-scores are independent + auditable so an operator can
-- drill in: "this tenant scored 42 because they haven't logged in in
-- 14 days AND no invoices last week."
--
-- Idempotent migration. The cron is in apps/api/src/modules/platform-
-- admin/health-cron.ts.

CREATE TABLE IF NOT EXISTS tenant_health_scores (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    tenant_id uuid NOT NULL
        REFERENCES tenants(id) ON DELETE CASCADE,
    -- Aggregate score 0-100. Recomputed daily; latest row per
    -- (tenant_id) drives UI display. Older rows kept for trend
    -- analysis (deferred to v2 — query it directly today).
    score smallint NOT NULL,
    risk_level varchar(16) NOT NULL,
    login_score smallint NOT NULL,
    transaction_score smallint NOT NULL,
    subscription_score smallint NOT NULL,
    setup_score smallint NOT NULL,
    -- Free-form reasons array — short strings the UI renders as
    -- pills under each tenant: "No login in 14 days", "Invoice
    -- volume down 60%", etc. Operator-friendly explanation of WHY
    -- the score is what it is.
    reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
    calculated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT health_score_range CHECK (score BETWEEN 0 AND 100),
    CONSTRAINT health_risk_allowed CHECK (
        risk_level IN ('low', 'medium', 'high', 'critical')
    )
);

-- Latest-per-tenant lookups dominate the workload. Composite index
-- on (tenant_id, calculated_at DESC) makes the "most recent score"
-- query an index-only seek.
CREATE INDEX IF NOT EXISTS tenant_health_scores_tenant_latest_idx
    ON tenant_health_scores (tenant_id, calculated_at DESC);

-- Risk-level fanout for the at-risk dashboard ("show me all critical
-- tenants"). Partial index on the latest row per tenant would be
-- ideal but Postgres doesn't have a clean way; the simpler index
-- below trades a tiny scan for simplicity.
CREATE INDEX IF NOT EXISTS tenant_health_scores_risk_calc_idx
    ON tenant_health_scores (risk_level, calculated_at DESC);

-- Outside RLS — platform-side aggregates, super-admin/support/billing
-- read.
GRANT SELECT, INSERT ON tenant_health_scores TO pettahpro_app;
