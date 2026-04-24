-- 86-platform-overview.sql — aggregate helpers for /platform overview
-- dashboard (#58).
--
-- Users table is under RLS; cross-tenant aggregates from the app role
-- need SECURITY DEFINER wrappers (same pattern as 82-platform-admin.sql
-- for the per-tenant helpers). Tenants, impersonation_*, and
-- platform_audit_log are all outside RLS so those aggregates go via
-- plain drizzle queries — no wrapper needed.

-- Total live users across every tenant. Excludes soft-deleted rows.
CREATE OR REPLACE FUNCTION platform_total_user_count()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT COUNT(*)::bigint
      FROM users u
     WHERE u.deleted_at IS NULL;
$$;

-- Users whose last_login_at falls within the last N days. The interval
-- is parameterised because we want both 7-day (active this week) and
-- 30-day (active this month) on the same dashboard without calling
-- two near-identical functions.
CREATE OR REPLACE FUNCTION platform_users_active_since(p_days integer)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT COUNT(*)::bigint
      FROM users u
     WHERE u.deleted_at IS NULL
       AND u.last_login_at IS NOT NULL
       AND u.last_login_at >= (now() - (p_days || ' days')::interval);
$$;

REVOKE ALL ON FUNCTION platform_total_user_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_users_active_since(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_total_user_count() TO pettahpro_app;
GRANT EXECUTE ON FUNCTION platform_users_active_since(integer) TO pettahpro_app;
