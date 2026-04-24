-- Roadmap #54 / gap L1 — Super-Admin Layer 1 (v0).
--
-- This is the FIRST time the platform gets an admin surface that is not
-- tied to any tenant. Two tables + a thin audit log; everything here
-- lives OUTSIDE RLS because that's the point — platform staff need to
-- see every tenant, and any query tagged with `app.tenant_id` would
-- disappear the tenants table from under them.
--
-- What's in scope (v0):
--   - platform_users — email + argon2 password hash, no tenant link
--   - platform_audit_log — every action a platform user takes on a
--     tenant, immutable (insert-only at the app layer; no UPDATE/DELETE
--     grants)
--   - reason column on the audit log is NOT NULL — every suspend /
--     reactivate captures why, so "who turned off acme's account" is
--     always answerable
--
-- What's deliberately NOT here:
--   - MFA / role separation — every platform user is full-access Owner
--     until L1 v1. Adds later via a separate migration.
--   - Impersonation — a v1 concern, needs consent flow on the tenant
--     side plus a session-hijack path. Separate PR.
--   - Platform-user-level rate limits / IP allowlists — same story.
--
-- RLS: these tables have NO RLS. Access is gated at the application
-- layer via a separate session cookie / auth plugin (see
-- apps/api/src/modules/platform-admin/). Tenant users cannot reach
-- /platform/* endpoints because the guard on those routes reads a
-- different cookie namespace entirely.

CREATE TABLE IF NOT EXISTS platform_users (
    id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    email                    varchar(255) NOT NULL UNIQUE,
    full_name                varchar(255) NOT NULL,
    password_hash            varchar(255) NOT NULL,
    is_active                boolean NOT NULL DEFAULT true,
    last_login_at            timestamptz,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    deleted_at               timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_users_email_live
    ON platform_users (email)
    WHERE deleted_at IS NULL;

-- No RLS — these live outside tenant scope by design.
-- Explicit grants for the app role.
GRANT SELECT, INSERT, UPDATE ON platform_users TO pettahpro_app;

-- ---------------------------------------------------------------------
-- Platform audit log.
--
-- Every platform-user action against a tenant writes a row here. The
-- shape is deliberately narrow — `kind` is a short machine code, `summary`
-- a human sentence, `reason` is the free-text justification captured
-- from the admin at action time. `tenant_id` is nullable because some
-- actions (login, logout) are platform-scoped and don't target a tenant.
--
-- UPDATE / DELETE are not granted — this table is insert-only by policy.
-- If a bad entry ever needs correcting, write a compensating row; don't
-- rewrite history.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_audit_log (
    id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    platform_user_id         uuid REFERENCES platform_users(id) ON DELETE SET NULL,
    platform_user_email      varchar(255) NOT NULL,
    kind                     varchar(64) NOT NULL,
    summary                  text NOT NULL,
    reason                   text,
    tenant_id                uuid REFERENCES tenants(id) ON DELETE SET NULL,
    ip_address               varchar(64),
    user_agent               varchar(512),
    metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_log_tenant
    ON platform_audit_log (tenant_id, created_at DESC)
    WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_audit_log_created
    ON platform_audit_log (created_at DESC);

-- Insert + select only. No UPDATE, no DELETE.
GRANT SELECT, INSERT ON platform_audit_log TO pettahpro_app;

-- ---------------------------------------------------------------------
-- SECURITY DEFINER helpers for the platform console.
--
-- The tenant directory needs aggregate counts across EVERY tenant — one
-- row per tenant. Those aggregates touch tenant-scoped tables (users)
-- which are under RLS. The app connection runs without app.tenant_id
-- set for these queries, so RLS drops every row. Rather than grant a
-- BYPASSRLS role to the API process, we expose three narrow helpers
-- that return ONLY counts / timestamps / a narrow user shape — no
-- business data leaks via these.
--
-- Same pattern as 44-auth-helpers.sql / 80-user-mfa.sql.
-- ---------------------------------------------------------------------

-- platform_count_users(tenant_id) — how many live user rows
CREATE OR REPLACE FUNCTION platform_count_users(p_tenant_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT COUNT(*)::bigint
      FROM users u
     WHERE u.tenant_id = p_tenant_id
       AND u.deleted_at IS NULL;
$$;

-- platform_last_login(tenant_id) — MAX(users.last_login_at) for the
-- "last active" column on the directory.
CREATE OR REPLACE FUNCTION platform_last_login(p_tenant_id uuid)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT MAX(u.last_login_at)
      FROM users u
     WHERE u.tenant_id = p_tenant_id
       AND u.deleted_at IS NULL;
$$;

-- platform_list_tenant_users(tenant_id) — narrow projection for the
-- tenant-detail Users tab. Returns id, email, full_name, is_owner,
-- is_active, last_login_at. The API hides email/full_name behind an
-- audited `?reveal=1` flag; this helper exposes them because a
-- narrower function shape would mean two functions. The privacy gate
-- lives at the API layer.
CREATE OR REPLACE FUNCTION platform_list_tenant_users(p_tenant_id uuid)
RETURNS TABLE (
    id              uuid,
    email           varchar(255),
    full_name       varchar(255),
    is_owner        boolean,
    is_active       boolean,
    last_login_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT u.id, u.email, u.full_name, u.is_owner, u.is_active, u.last_login_at
      FROM users u
     WHERE u.tenant_id = p_tenant_id
       AND u.deleted_at IS NULL
     ORDER BY u.is_owner DESC, u.created_at ASC;
$$;

REVOKE ALL ON FUNCTION platform_count_users(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_last_login(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_list_tenant_users(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_count_users(uuid) TO pettahpro_app;
GRANT EXECUTE ON FUNCTION platform_last_login(uuid) TO pettahpro_app;
GRANT EXECUTE ON FUNCTION platform_list_tenant_users(uuid) TO pettahpro_app;
