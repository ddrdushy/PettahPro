-- 101-cleanup-supplier-portal.sql — drop the dead supplier_portal flag.
--
-- The 'supplier_portal' feature code was seeded into the Scale plan in
-- 88-pricing-plans.sql but never had an app surface — no route, no nav
-- entry, no API. It existed in plan-features.ts + sidebar.tsx +
-- platform clients as a gate stub for a feature that was never built.
-- That gave operators a false impression of capability when editing
-- plans in the platform console (the "Tier-gated capabilities" picker
-- listed it as a real toggle).
--
-- This script removes 'supplier_portal' from:
--   * plans.features            — every existing plan row
--   * plan_versions.features    — every snapshot, so version history
--                                 doesn't keep resurrecting the flag
--                                 if a tenant migrates back
--   * addons.grants_features    — any add-on that was wired to grant it
--
-- Idempotent: running multiple times is safe; the jsonb '-' operator
-- is a no-op when the key isn't present.

UPDATE plans
SET features = features - 'supplier_portal',
    updated_at = now()
WHERE features ? 'supplier_portal';

UPDATE plan_versions
SET features = features - 'supplier_portal'
WHERE features ? 'supplier_portal';

UPDATE addons
SET grants_features = grants_features - 'supplier_portal',
    updated_at = now()
WHERE grants_features ? 'supplier_portal';
