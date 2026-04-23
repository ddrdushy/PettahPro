-- Customer portal (roadmap #31, sell-module-spec §14).
--
-- Self-service surface for a tenant's customers: view invoices, download
-- PDFs, read their AR statement, list payments made. Email + OTP login
-- (no password — spec calls this out as the right UX for SL SME buyers).
--
-- Design notes:
--
--  * Authentication is email-bound, not user-bound. The identifier is
--    `customers.email`. A code is minted per matching customer row
--    (not per email) so that the same person can have buyer relationships
--    with multiple tenants on the platform and each code resolves to
--    exactly one (tenant, customer) pair. Collision is rare but not
--    impossible — e.g. a freelance accountant who is a "customer" of
--    several suppliers using PettahPro.
--
--  * Cross-tenant lookup is done via a SECURITY DEFINER helper
--    (portal_find_customers_by_email) — same pattern as auth_find_user_*
--    from PR #48. The portal login handler runs before tenant context
--    is known, so RLS can't gate it; the helper owned by a superuser
--    bypasses RLS and returns only the narrow shape the handler needs.
--
--  * portal_otps is tenant-scoped via RLS (same pattern as every other
--    per-tenant table). The INSERT on mint happens via a second helper
--    so it can tenant-set per row before writing — we don't want to
--    switch the app connection context in mid-handler.
--
--  * Rate-limiting is soft and lives in Redis on the API side (5 sends
--    per email per hour). This table only tracks mint + consumption for
--    audit and to block re-use of a code.

-- =============================================================================
-- portal_otps — one row per pending (tenant, customer, code) attempt
-- =============================================================================

CREATE TABLE IF NOT EXISTS portal_otps (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email        varchar(255) NOT NULL,
  -- Code is stored as a SHA-256 hash so a DB leak doesn't let an
  -- attacker walk into live portal sessions. 6-digit numeric code on
  -- the application side — plenty of entropy given the 10-minute
  -- expiry and per-email rate cap.
  code_hash    varchar(64) NOT NULL,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  requester_ip varchar(64) NULL,
  user_agent   text NULL
);

CREATE INDEX IF NOT EXISTS portal_otps_email_idx
  ON portal_otps (email, expires_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS portal_otps_customer_idx
  ON portal_otps (tenant_id, customer_id, created_at DESC);

ALTER TABLE portal_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_otps FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_otps_rw ON portal_otps;
CREATE POLICY portal_otps_rw ON portal_otps
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- SECURITY DEFINER helpers (portal login runs before tenant context is known)
-- =============================================================================

-- Find all matching customer rows across tenants for a given email.
-- Returns the minimal shape the portal login handler needs — business
-- name so we can put it in the subject line + tenant id so we can mint
-- the OTP scoped correctly.
CREATE OR REPLACE FUNCTION portal_find_customers_by_email(p_email varchar)
RETURNS TABLE (
  tenant_id       uuid,
  customer_id     uuid,
  customer_name   varchar,
  customer_email  varchar,
  business_name   varchar,
  tenant_slug     varchar
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    c.tenant_id,
    c.id            AS customer_id,
    c.name          AS customer_name,
    c.email         AS customer_email,
    t.business_name AS business_name,
    t.slug          AS tenant_slug
  FROM customers c
  JOIN tenants t ON t.id = c.tenant_id
  WHERE lower(c.email) = lower(p_email)
    AND c.deleted_at IS NULL
    AND c.is_active = true
    AND t.deleted_at IS NULL
    AND t.status = 'active'
  -- Deterministic order so dev + tests behave the same.
  ORDER BY t.business_name, c.name
$$;

-- Insert an OTP row without requiring the caller to have tenant context
-- set. Mirrors the auth helpers — the handler that calls this is the
-- pre-login layer and doesn't know which tenant it's writing for until
-- after it reads portal_find_customers_by_email.
CREATE OR REPLACE FUNCTION portal_mint_otp(
  p_tenant_id    uuid,
  p_customer_id  uuid,
  p_email        varchar,
  p_code_hash    varchar,
  p_expires_at   timestamptz,
  p_ip           varchar DEFAULT NULL,
  p_user_agent   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO portal_otps (
    tenant_id, customer_id, email, code_hash, expires_at, requester_ip, user_agent
  ) VALUES (
    p_tenant_id, p_customer_id, p_email, p_code_hash, p_expires_at, p_ip, p_user_agent
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- Find candidate OTP rows for (email, code_hash) across tenants. Returns
-- the rows the verify handler needs to pick the right one and stamp it
-- consumed. Handler further filters by `expires_at > now()` in app code.
CREATE OR REPLACE FUNCTION portal_find_otp(
  p_email     varchar,
  p_code_hash varchar
)
RETURNS TABLE (
  id           uuid,
  tenant_id    uuid,
  customer_id  uuid,
  email        varchar,
  expires_at   timestamptz,
  consumed_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, tenant_id, customer_id, email, expires_at, consumed_at
  FROM portal_otps
  WHERE lower(email) = lower(p_email)
    AND code_hash = p_code_hash
    AND consumed_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 5
$$;

-- Stamp an OTP consumed. Called from verify handler after we've matched.
CREATE OR REPLACE FUNCTION portal_consume_otp(p_otp_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE portal_otps
  SET consumed_at = now()
  WHERE id = p_otp_id AND consumed_at IS NULL;
END
$$;

-- Resolve a portal session's bound (tenant, customer) into a display
-- payload the /portal/me endpoint returns. Narrow so we can't leak
-- tenant internals.
CREATE OR REPLACE FUNCTION portal_resolve_session(
  p_tenant_id   uuid,
  p_customer_id uuid
)
RETURNS TABLE (
  tenant_id       uuid,
  tenant_slug     varchar,
  business_name   varchar,
  tenant_timezone varchar,
  customer_id     uuid,
  customer_name   varchar,
  customer_email  varchar,
  customer_phone  varchar,
  customer_active boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.id,
    t.slug,
    t.business_name,
    t.timezone,
    c.id,
    c.name,
    c.email,
    c.phone,
    c.is_active AND c.deleted_at IS NULL AS customer_active
  FROM tenants t
  JOIN customers c ON c.tenant_id = t.id
  WHERE t.id = p_tenant_id
    AND c.id = p_customer_id
  LIMIT 1
$$;
