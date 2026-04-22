-- Auth helpers: non-superuser app role + SECURITY DEFINER functions for
-- cross-tenant auth lookups (signup uniqueness, login by email, /me by id,
-- last-login touch).
--
-- Why this exists
-- ---------------
-- Every tenant-scoped table has `FORCE ROW LEVEL SECURITY`, which means even
-- the table owner is subject to policies unless they carry BYPASSRLS. The
-- tenants table itself has no RLS (super-admin / provisioning needs
-- cross-tenant reads), but `users` does — and signup/login happen BEFORE we
-- know which tenant the user belongs to, so we can't set app.tenant_id ahead
-- of time.
--
-- Two ways to make those queries work against a non-superuser app role:
--   1. SECURITY DEFINER functions owned by the superuser (runs with the
--      owner's privileges — bypasses RLS because the owner is BYPASSRLS).
--   2. Give the app role BYPASSRLS (defeats the point of RLS).
--
-- We go with (1) — the same pattern `list_due_recurring_invoices` already
-- uses for the recurring-invoice worker. Each function returns only the
-- narrow row-shape callers actually need, so we don't accidentally hand the
-- app a password hash for a row it shouldn't see.

-- ------------------------------------------------------------------------------
-- App role. `pettahpro_app` is the role the API/worker connect as. NOBYPASSRLS
-- means every query through it is subject to RLS, forcing us to be explicit
-- via set_config('app.tenant_id', ...) or the SECURITY DEFINER helpers below.
-- The password is fine to hard-code in the init script — dev only; staging
-- and prod override it via psql after the fact.
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pettahpro_app') THEN
    CREATE ROLE pettahpro_app WITH LOGIN NOBYPASSRLS PASSWORD 'pettahpro_app_dev';
  ELSE
    -- Idempotent: make sure the flag is right even if role was created by hand.
    ALTER ROLE pettahpro_app WITH LOGIN NOBYPASSRLS;
  END IF;
END
$$;

-- Hand the app role the day-to-day privileges it needs on existing objects.
GRANT USAGE ON SCHEMA public TO pettahpro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pettahpro_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO pettahpro_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO pettahpro_app;

-- And default privileges so anything created later (more init scripts, future
-- migrations) is usable by the app role automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pettahpro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO pettahpro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO pettahpro_app;

-- ------------------------------------------------------------------------------
-- auth_email_in_use(email) — signup uniqueness check.
-- Returns true if any non-deleted user has this email in ANY tenant. The app
-- can't know the tenant yet; a collision means we should refuse signup.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_email_in_use(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM users
     WHERE email = lower(p_email)
       AND deleted_at IS NULL
  );
$$;

-- ------------------------------------------------------------------------------
-- auth_find_user_by_email(email) — login lookup. Returns the single (or zero)
-- non-deleted user with this email across all tenants, including fields the
-- login handler needs: password_hash, is_active, is_owner, tenant_id.
-- Returns at most one row because users_tenant_email_unique + the "one tenant
-- per email" convention keeps this unique in practice.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
RETURNS TABLE(
  id            uuid,
  tenant_id     uuid,
  email         varchar(255),
  full_name     varchar(255),
  password_hash varchar(255),
  is_active     boolean,
  is_owner      boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT u.id, u.tenant_id, u.email, u.full_name, u.password_hash, u.is_active, u.is_owner
    FROM users u
   WHERE u.email = lower(p_email)
     AND u.deleted_at IS NULL
   LIMIT 1;
$$;

-- ------------------------------------------------------------------------------
-- auth_find_user_by_id(user_id) — /me lookup for an already-authenticated
-- session. Same fields as the email lookup minus password_hash (the session
-- handler has no reason to see it again).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_find_user_by_id(p_user_id uuid)
RETURNS TABLE(
  id            uuid,
  tenant_id     uuid,
  email         varchar(255),
  full_name     varchar(255),
  is_active     boolean,
  is_owner      boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT u.id, u.tenant_id, u.email, u.full_name, u.is_active, u.is_owner
    FROM users u
   WHERE u.id = p_user_id
     AND u.deleted_at IS NULL
   LIMIT 1;
$$;

-- ------------------------------------------------------------------------------
-- auth_touch_last_login(user_id) — stamp last_login_at on successful login.
-- Cross-tenant write (we don't have app.tenant_id set on the raw login path),
-- so this needs SECURITY DEFINER too. Scoped to a single PK update so there's
-- no "oops, wrote across tenants" risk.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_touch_last_login(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE users SET last_login_at = now() WHERE id = p_user_id;
$$;

-- Narrow EXECUTE grants: the app role only needs these four. Revoke PUBLIC to
-- keep the blast radius small if someone ever connects with a lesser role.
REVOKE ALL ON FUNCTION auth_email_in_use(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_find_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_find_user_by_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_touch_last_login(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_email_in_use(text) TO pettahpro_app;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text) TO pettahpro_app;
GRANT EXECUTE ON FUNCTION auth_find_user_by_id(uuid) TO pettahpro_app;
GRANT EXECUTE ON FUNCTION auth_touch_last_login(uuid) TO pettahpro_app;
