-- 87-platform-saved-views.sql — per-user saved filter/sort bundles
-- for the platform console (#59).
--
-- A "view" is just a name + the querystring it expands to, pinned to
-- one platform user. We persist the QS verbatim (no schema per page)
-- so adding a new sort/filter to /platform/tenants doesn't require a
-- migration — the same table serves the audit page, future reports
-- page, etc. `scope` is the discriminator.
--
-- Deliberately outside RLS: platform_users don't live in a tenant
-- context, and the table is already partitioned by platform_user_id.
-- Cross-user visibility is never wanted (one operator's saved views
-- are their business), so every query MUST filter by
-- platform_user_id — enforced at the API layer.

CREATE TABLE IF NOT EXISTS platform_user_saved_views (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    platform_user_id uuid NOT NULL
        REFERENCES platform_users(id) ON DELETE CASCADE,
    scope varchar(32) NOT NULL,
    name varchar(80) NOT NULL,
    -- Raw querystring without leading `?`. Stored verbatim so the UI
    -- can round-trip it into the same form it came from. Length cap
    -- stops someone from shoving a novel in here.
    query_string varchar(2000) NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- A user can't have two views with the same name in the same
    -- scope. Different scopes (tenants/audit) can share names.
    CONSTRAINT platform_user_saved_views_unique_name
        UNIQUE (platform_user_id, scope, name),
    CONSTRAINT platform_user_saved_views_scope_allowed
        CHECK (scope IN ('tenants', 'audit'))
);

CREATE INDEX IF NOT EXISTS platform_user_saved_views_user_scope_idx
    ON platform_user_saved_views (platform_user_id, scope, name);

-- Keep updated_at accurate without relying on the app. Same trigger
-- pattern as the rest of the platform_* tables.
CREATE OR REPLACE FUNCTION set_platform_saved_views_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_saved_views_updated_at
    ON platform_user_saved_views;
CREATE TRIGGER trg_platform_saved_views_updated_at
    BEFORE UPDATE ON platform_user_saved_views
    FOR EACH ROW
    EXECUTE FUNCTION set_platform_saved_views_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_user_saved_views TO pettahpro_app;
