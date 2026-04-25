-- 90-plans-archive.sql — archive flag on the plan catalogue.
--
-- Motivation. The plan catalogue (#61 / 88-pricing-plans.sql) shipped
-- the three seeded tiers as the only plans, with no mechanism to wind
-- one down without breaking the tenants that bought it. The pricing
-- spec (§7.2 / §12.1) is explicit: "archive ≠ delete; old tenants on
-- archived plans grandfathered." We need that distinction to be a
-- first-class column rather than overloading is_public.
--
-- is_public already controls visibility in the public picker (Hide a
-- bespoke deal from the marketing-driven plan list). Archive is a
-- different concept: stop selling this plan to anyone (existing or new),
-- but leave existing tenants on it untouched. A plan can be archived
-- AND public (we're winding it down but old tenants still see it on
-- their settings page), or archived AND not-public (winding down a
-- bespoke deal). Two booleans, two concepts.
--
-- The plan-edit UI uses this flag to filter the picker (archived plans
-- don't show up as "switch to..." options on the tenant settings or
-- platform plan-change endpoint). Archive is reversible — set it back
-- to false to resume selling.
--
-- Idempotent. ADD COLUMN IF NOT EXISTS lets this script land cleanly
-- on a live DB without dropping the volume (per user memory).

ALTER TABLE plans
    ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

-- Partial index — most queries either list active plans (the picker)
-- or scan the whole catalogue (the platform admin). The picker's
-- "is_archived = false" filter benefits from this; full scans don't
-- care.
CREATE INDEX IF NOT EXISTS plans_active_sort_idx
    ON plans (sort_order, code)
    WHERE is_archived = false;
