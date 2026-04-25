-- 93-coupons.sql — promotional coupon engine (pricing-spec §8 / super-
-- admin §8.1).
--
-- Two tables, mirroring the plans / tenant_addons split:
--   * coupons — catalog. Each row is one redeemable code with its
--     discount type, eligibility rules, validity window, and usage
--     caps.
--   * coupon_redemptions — one row per (coupon, tenant) successful
--     redemption. Snapshots the discount fields at redemption time so
--     a later catalog edit doesn't retroactively change what a tenant
--     already received.
--
-- v1 supports the two most common discount types — `percent_off` and
-- `amount_off_cents`. Both are tracked here today; they're applied to
-- the next billing cycle when real billing lands. Until then the
-- redemption row is the audit trail saying "this tenant is owed this
-- discount." `first_n_months_free` and `trial_days_extension` are
-- spec'd but deferred to v2 — schema accommodates them via the same
-- discount_type CHECK widening.
--
-- Idempotent — safe to re-run. Seed at the bottom skips on conflict.

CREATE TABLE IF NOT EXISTS coupons (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    -- Stable handle the user types in. Case-insensitive at the API
    -- layer (we store as written, look up via lower()=lower()).
    code varchar(64) NOT NULL UNIQUE,
    -- Internal-friendly description; never shown to tenants.
    name varchar(160) NOT NULL,

    -- Discount type — percent_off uses bps in discount_value (2000 =
    -- 20%); amount_off_cents uses LKR cents directly. See deferred
    -- types in the file header.
    discount_type varchar(32) NOT NULL,
    discount_value bigint NOT NULL,

    -- Application duration. v1 ships `once` (single-shot at next
    -- billing cycle) and `forever` (every cycle until cancelled).
    -- `months` (with applies_for_months) is reserved for v2.
    applies_for varchar(16) NOT NULL DEFAULT 'once',
    applies_for_months integer,

    -- Eligibility filters. Empty arrays = no restriction.
    eligible_plan_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- new_signups_only — coupon can only be redeemed during the
    -- signup flow, not after. Useful for acquisition-only deals.
    new_signups_only boolean NOT NULL DEFAULT false,

    -- Validity window. NULL = unbounded on that side.
    valid_from timestamptz,
    valid_until timestamptz,

    -- Usage caps. NULL = unlimited.
    max_redemptions integer,
    -- Denormalized counter — incremented on every successful
    -- redemption inside the same transaction. Reads are O(1) and
    -- consistent.
    redemption_count integer NOT NULL DEFAULT 0,

    -- One-redemption-per-tenant flag. When true, a tenant who
    -- previously redeemed this coupon (any status) cannot redeem
    -- again. Most marketing codes need this; growth/referral codes
    -- can leave it off.
    one_per_tenant boolean NOT NULL DEFAULT true,

    is_active boolean NOT NULL DEFAULT true,
    is_archived boolean NOT NULL DEFAULT false,

    notes text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by_platform_user_id uuid REFERENCES platform_users(id),

    CONSTRAINT coupons_discount_type_allowed CHECK (
        discount_type IN ('percent_off', 'amount_off_cents')
    ),
    CONSTRAINT coupons_applies_for_allowed CHECK (
        applies_for IN ('once', 'forever', 'months')
    ),
    CONSTRAINT coupons_discount_value_nonneg CHECK (discount_value >= 0),
    -- Percent off can't exceed 100% (10_000 bps). Amount off has no
    -- upper-bound check — it's clamped at the actual invoice amount
    -- when applied at billing time.
    CONSTRAINT coupons_percent_under_100 CHECK (
        discount_type <> 'percent_off' OR discount_value <= 10000
    )
);

CREATE INDEX IF NOT EXISTS coupons_code_lower_idx
    ON coupons (LOWER(code));
CREATE INDEX IF NOT EXISTS coupons_active_idx
    ON coupons (valid_from, valid_until)
    WHERE is_active = true AND is_archived = false;

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_coupons_updated_at ON coupons;
CREATE TRIGGER trg_coupons_updated_at
    BEFORE UPDATE ON coupons
    FOR EACH ROW
    EXECUTE FUNCTION set_subscriptions_updated_at();

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    coupon_id uuid NOT NULL
        REFERENCES coupons(id) ON DELETE RESTRICT,
    tenant_id uuid NOT NULL
        REFERENCES tenants(id) ON DELETE CASCADE,

    -- Snapshot of the coupon fields at redemption time. A later
    -- catalog edit doesn't change what the tenant already got.
    discount_type varchar(32) NOT NULL,
    discount_value bigint NOT NULL,
    applies_for varchar(16) NOT NULL,
    applies_for_months integer,

    -- Plan + version they were on when redeeming. Useful when ops is
    -- reconciling "why did we discount Scale rate but they're now on
    -- Growth?" Versioning carries forward via plan_version_id from
    -- #119, so this answers the audit question without joining.
    plan_id uuid,
    plan_version_id uuid,

    -- Lifecycle:
    --   active     — currently being applied (or queued for next bill)
    --   consumed   — applies_for='once' and the single shot was used
    --                (set when real billing wires up; for now we keep
    --                redemptions in 'active' until manually consumed)
    --   cancelled  — manually invalidated (admin or refund flow)
    status varchar(20) NOT NULL DEFAULT 'active',

    -- For applies_for='months' / 'forever' — bookkeeping for how
    -- many cycles have been billed against this redemption.
    months_applied integer NOT NULL DEFAULT 0,

    redeemed_at timestamptz NOT NULL DEFAULT now(),
    redeemed_by_user_id uuid,
    redeemed_by_platform_user_id uuid,

    consumed_at timestamptz,
    cancelled_at timestamptz,
    cancel_reason varchar(500),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT coupon_redemptions_status_allowed CHECK (
        status IN ('active', 'consumed', 'cancelled')
    )
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx
    ON coupon_redemptions (coupon_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_tenant_idx
    ON coupon_redemptions (tenant_id);
-- Partial unique enforcing one-per-tenant on coupons that opt in.
-- Cancelled redemptions don't block re-redemption — that's the
-- "we comped you, then comped you again" case which is legal.
CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_one_per_tenant
    ON coupon_redemptions (coupon_id, tenant_id)
    WHERE status <> 'cancelled';

DROP TRIGGER IF EXISTS trg_coupon_redemptions_updated_at ON coupon_redemptions;
CREATE TRIGGER trg_coupon_redemptions_updated_at
    BEFORE UPDATE ON coupon_redemptions
    FOR EACH ROW
    EXECUTE FUNCTION set_subscriptions_updated_at();

-- Seed two sample coupons so the editor isn't empty on first load.
-- Operators can archive these or replace them with real campaigns.
INSERT INTO coupons (
    code, name,
    discount_type, discount_value, applies_for,
    eligible_plan_codes, new_signups_only,
    max_redemptions, one_per_tenant, notes
) VALUES
    (
        'AVURUDU2026',
        'Avurudu 2026 — 20% off first 3 months',
        'percent_off', 2000, 'months',
        '[]'::jsonb,
        false,
        500, true,
        'Sample coupon — example of a percent-off campaign'
    ),
    (
        'WELCOME5K',
        'Welcome — LKR 5,000 off first invoice',
        'amount_off_cents', 500000, 'once',
        '["growth", "scale"]'::jsonb,
        true,
        NULL, true,
        'Sample coupon — fixed amount-off for new signups on Growth/Scale'
    )
ON CONFLICT (code) DO NOTHING;

-- v1: applies_for='months' is in the CHECK but not yet honored at
-- redemption time. We seed AVURUDU2026 with it anyway to surface the
-- shape; redemption will treat it like 'once' until the renewal
-- worker lands.
UPDATE coupons SET applies_for_months = 3
    WHERE code = 'AVURUDU2026' AND applies_for_months IS NULL;

GRANT SELECT, INSERT, UPDATE ON coupons TO pettahpro_app;
GRANT SELECT, INSERT, UPDATE ON coupon_redemptions TO pettahpro_app;
