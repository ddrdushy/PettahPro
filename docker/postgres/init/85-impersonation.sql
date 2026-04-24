-- Roadmap #57 / gap L1 v1 — Operator impersonation.
--
-- Platform support staff sometimes need to see what a tenant sees — a
-- bug report says "the invoice list is broken" and screenshots aren't
-- enough. Direct database reads or faking a tenant login both break
-- the audit trail: we lose "which support engineer touched which
-- tenant, and when, and with whose permission."
--
-- This migration backs the consent-gated, time-boxed, fully-audited
-- impersonation flow described in super-admin-layer1-spec.md.
--
-- Flow (summary; full detail in the spec):
--   1. Platform super_admin or support presses "Request impersonation"
--      on /platform/tenants/:id. Captures reason + requested_minutes
--      (15/30/60). Row inserted here with status='pending'.
--   2. Every active tenant Owner gets an in-app notification + email
--      (via the normal notifications pipe). Nothing happens inside the
--      tenant until someone approves.
--   3. An Owner on /app/settings/security approves. Row updates to
--      status='approved', approved_by_user_id = owner.id. Still no
--      session minted — "approved" just means the platform user is
--      CLEARED to start, not that they're in.
--   4. Platform admin presses "Start" on /platform/impersonation.
--      API mints a tenant session stamped with impersonator fields,
--      drops a row into impersonation_sessions with ends_at =
--      started_at + approved_minutes. Cookie gets set; admin is
--      redirected to /app. Red banner renders on every page.
--   5. Session auto-expires on ends_at (sessions.ts refuses to extend
--      TTL for impersonation blobs). Either side — platform admin or
--      tenant Owner — can force-end at any time.
--
-- Dual-actor audit: every audit_events write during an active
-- impersonation session stamps the impersonator alongside the tenant
-- actor. See apps/api/src/lib/audit.ts + the new impersonation-context
-- AsyncLocalStorage helper. Columns added to audit_events below.
--
-- Why these tables live OUTSIDE RLS (same pattern as 82-platform-admin):
--   - Platform staff need to query across tenants for the dashboard
--     ("every active impersonation session right now"). An RLS policy
--     on current_tenant_id() would drop those rows.
--   - Tenant-side endpoints filter by req.tenantId at the application
--     layer explicitly. The API guard (tenant session presence) is
--     the gate, not a Postgres policy.

CREATE TABLE IF NOT EXISTS impersonation_requests (
    id                              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    -- Who's asking. platform_user_id can null out on account deletion
    -- but we keep the email so historical rows stay readable.
    requesting_platform_user_id     uuid REFERENCES platform_users(id) ON DELETE SET NULL,
    requesting_platform_user_email  varchar(255) NOT NULL,
    -- Who they're asking. Cascade because a deleted tenant has no
    -- ongoing need for stale impersonation history.
    target_tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    requested_minutes               int NOT NULL CHECK (requested_minutes IN (15, 30, 60)),
    reason                          text NOT NULL,
    status                          varchar(16) NOT NULL DEFAULT 'pending'
                                      CHECK (status IN ('pending','approved','refused','expired','cancelled')),
    -- Owner who approved (nullable until that happens). Cascade off
    -- user-delete sets null so the audit row still renders with the
    -- email snapshot below.
    approved_by_user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_by_user_email          varchar(255),
    approved_minutes                int CHECK (approved_minutes IN (15, 30, 60)),
    approved_at                     timestamptz,
    refused_at                      timestamptz,
    refused_by_user_id              uuid REFERENCES users(id) ON DELETE SET NULL,
    refused_reason                  text,
    -- Auto-expire for stale pending requests. Cron / lazy sweep on
    -- read flips status='expired' past this. Default window: 24h.
    expires_at                      timestamptz NOT NULL,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- Tenant Owner's "pending requests" list filters by (tenant_id, status).
CREATE INDEX IF NOT EXISTS idx_imp_req_tenant_status
    ON impersonation_requests (target_tenant_id, status, created_at DESC);

-- Platform admin's own history — "my requests, most recent first."
CREATE INDEX IF NOT EXISTS idx_imp_req_requester
    ON impersonation_requests (requesting_platform_user_id, created_at DESC)
    WHERE requesting_platform_user_id IS NOT NULL;

-- Dashboard: "show all impersonation activity this week." Flat time
-- index so the /platform/impersonation page doesn't fan out per
-- tenant.
CREATE INDEX IF NOT EXISTS idx_imp_req_created
    ON impersonation_requests (created_at DESC);

-- ---------------------------------------------------------------------
-- Impersonation sessions — one row per actual "logged in as tenant
-- user" instance. Separate from the request because a single approved
-- request could (in theory, later) be started + ended + restarted
-- inside the approved window. v1 starts exactly once, but modelling
-- the session as its own row makes force-end + force-expiry clean.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS impersonation_sessions (
    id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    request_id               uuid NOT NULL REFERENCES impersonation_requests(id) ON DELETE CASCADE,
    platform_user_id         uuid REFERENCES platform_users(id) ON DELETE SET NULL,
    platform_user_email      varchar(255) NOT NULL,
    target_tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- The tenant user the platform admin is logged in AS. Always
    -- equals the approving Owner at v1 (they approve = they lend
    -- their seat). Scope doc leaves room for "approve as another user"
    -- later; nullable column on approved_by_user_email covers that.
    target_user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_email        varchar(255) NOT NULL,
    -- The actual Redis session id we minted. Force-end revokes by
    -- nuking this key. Stored so /platform/impersonation can kill an
    -- active session without having to recover it from cookies.
    session_id               varchar(64) NOT NULL,
    started_at               timestamptz NOT NULL DEFAULT now(),
    ends_at                  timestamptz NOT NULL,
    ended_at                 timestamptz,
    ended_by                 varchar(16) CHECK (ended_by IN ('platform','tenant','expired')),
    ended_reason             text
);

-- Active sessions per tenant — the red banner and "revoke" card
-- read this.
CREATE INDEX IF NOT EXISTS idx_imp_sess_tenant_active
    ON impersonation_sessions (target_tenant_id)
    WHERE ended_at IS NULL;

-- Platform-side dashboards.
CREATE INDEX IF NOT EXISTS idx_imp_sess_platform
    ON impersonation_sessions (platform_user_id, started_at DESC)
    WHERE platform_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_imp_sess_started
    ON impersonation_sessions (started_at DESC);

-- One session key per row at most — stops accidental duplicate mints
-- from landing both rows active.
CREATE UNIQUE INDEX IF NOT EXISTS idx_imp_sess_session_unique
    ON impersonation_sessions (session_id);

GRANT SELECT, INSERT, UPDATE ON impersonation_requests TO pettahpro_app;
GRANT SELECT, INSERT, UPDATE ON impersonation_sessions TO pettahpro_app;

-- ---------------------------------------------------------------------
-- Dual-actor audit attribution.
--
-- Every write to audit_events during an active impersonation needs to
-- capture BOTH the tenant user (actor_user_id — existing column) AND
-- the platform user standing behind them (new columns below). So
-- after the dust settles, the tenant audit viewer can show a row as
-- "Owner — but actually support engineer support@pettah during
-- authorised session."
--
-- Implementation: request-scoped AsyncLocalStorage carries the
-- impersonator context; recordAuditEvent() reads it and populates.
-- No call-site changes required at the dozens of existing audit
-- writers.
-- ---------------------------------------------------------------------
ALTER TABLE audit_events
    ADD COLUMN IF NOT EXISTS impersonated_by_platform_user_id uuid,
    ADD COLUMN IF NOT EXISTS impersonated_by_platform_user_email varchar(255);

CREATE INDEX IF NOT EXISTS idx_audit_events_impersonator
    ON audit_events (impersonated_by_platform_user_id, created_at DESC)
    WHERE impersonated_by_platform_user_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Lazy-expiry sweep helper.
--
-- Called on read from both /platform/impersonation-requests and
-- /impersonation-requests (tenant side). Flips pending requests past
-- their expires_at to 'expired' so the UI never shows a stale "pending
-- since 3 days ago." Also flips active sessions past their ends_at to
-- ended_by='expired' so the banner clears without waiting for the
-- user's next request (Redis TTL handles the session blob itself).
--
-- SECURITY DEFINER so the app connection can call it without an RLS
-- context set; both tables are RLS-free anyway, but the pattern
-- matches 82-platform-admin.sql.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION impersonation_sweep_expired()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE impersonation_requests
       SET status = 'expired',
           updated_at = now()
     WHERE status = 'pending'
       AND expires_at < now();

    UPDATE impersonation_sessions
       SET ended_at = now(),
           ended_by = 'expired'
     WHERE ended_at IS NULL
       AND ends_at < now();
END;
$$;

REVOKE ALL ON FUNCTION impersonation_sweep_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION impersonation_sweep_expired() TO pettahpro_app;
