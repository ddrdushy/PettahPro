-- =============================================================================
-- Permission hardening — PR #69 follow-up to the shipped features audit.
-- =============================================================================
--
-- The role templates seeded in 55-tenant-admin.sql were missing two permission
-- keys that POS routes now enforce (pos.operate / pos.close), so the system
-- Owner / Admin / Sales roles in existing tenants have no way to grant POS
-- access. This migration:
--
--   1. Adds `pos.operate` + `pos.close` to the existing system roles
--      (Owner / Admin get both; Sales gets pos.operate only — variance
--      close stays with accountants / admins).
--   2. Is fully idempotent — re-applies cleanly even when the keys are
--      already present (jsonb `||` overwrites).
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     docker/postgres/init/60-permission-hardening.sql
-- =============================================================================

-- Owner + Admin: full POS (operate shifts + close-with-variance).
UPDATE roles
SET permissions = permissions || jsonb_build_object(
      'pos.operate', true,
      'pos.close',   true
    )
WHERE is_system = true
  AND name IN ('Owner', 'Admin')
  AND deleted_at IS NULL;

-- Sales: can run the terminal but not close shifts (keeps the money-count
-- moment with a supervisor — prevents "cashier closes own shift" pattern).
UPDATE roles
SET permissions = permissions || jsonb_build_object(
      'pos.operate', true
    )
WHERE is_system = true
  AND name = 'Sales'
  AND deleted_at IS NULL;
