-- Roadmap #56 / gap L1 v1 — Multi-role platform staff.
--
-- v0 of the platform console (PR #54) minted every platform user as
-- a full-access super-admin. This migration adds a role column so we
-- can split staff into three tiers:
--
--   super_admin — full access, including managing other platform users,
--                 suspending/reactivating tenants, and all reads.
--   support     — read every tenant for triage, reveal PII with an
--                 audit reason, but NO suspend / reactivate / user-mgmt.
--   billing     — read tenants for account-health triage; cannot
--                 reveal PII; cannot suspend. When billing ops (plan
--                 changes, refunds) land, this role gains those powers
--                 exclusively.
--
-- Why a single `role` column vs a platform_user_roles join table:
--   - A platform staffer has exactly one role. "Support engineer who
--     also does billing" doesn't exist in our ops model — we prefer
--     the clear separation. Join tables add complexity for no real use.
--   - Cheap to query, easy to invalidate sessions on change.
--
-- Backfill: every existing platform user becomes super_admin, which
-- preserves today's behaviour (v0 = everyone full-access) without
-- surprising anyone already signed in. The NOT NULL + DEFAULT combo
-- makes that backfill implicit.

-- Role column + CHECK constraint enforcing the enum.
ALTER TABLE platform_users
    ADD COLUMN IF NOT EXISTS role varchar(32) NOT NULL DEFAULT 'super_admin';

-- Drop first in case we're re-running; DO block keeps it idempotent.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'platform_users_role_check'
    ) THEN
        ALTER TABLE platform_users DROP CONSTRAINT platform_users_role_check;
    END IF;
END $$;

ALTER TABLE platform_users
    ADD CONSTRAINT platform_users_role_check
    CHECK (role IN ('super_admin', 'support', 'billing'));

-- Index: most route-level role checks happen through the session payload
-- (role is cached there — see sessions.ts), but we still filter by role
-- on the staff list page ("show me all super_admins").
CREATE INDEX IF NOT EXISTS idx_platform_users_role_live
    ON platform_users (role)
    WHERE deleted_at IS NULL;
