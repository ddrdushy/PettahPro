-- Customer portal hardening (follow-up to #31 / PR #71).
--
-- Three security gaps closed:
--
--   1. Per-customer portal access toggle. Today the only way to revoke
--      portal access is to archive the customer (is_active=false) — but
--      they may still be live for billing. `portal_enabled` lets a tenant
--      admin disable portal login for one customer without affecting the
--      rest of the customer record.
--
--   2. `portal_find_customers_by_email` now filters out `portal_enabled=false`
--      so a disabled customer can never mint an OTP in the first place.
--
--   3. `portal_resolve_session` folds `portal_enabled` into the existing
--      `customer_active` output flag, so any live portal session blows
--      itself away on the next /portal/auth/me read once an admin flips
--      the toggle off. Same fail-closed pattern we already use for archival.
--
-- All changes are idempotent (IF NOT EXISTS + OR REPLACE).

-- =============================================================================
-- 1. Add the per-customer toggle
-- =============================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS portal_enabled boolean NOT NULL DEFAULT true;

-- =============================================================================
-- 2. Tighten the pre-auth lookup helper
-- =============================================================================

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
    AND c.portal_enabled = true
    AND t.deleted_at IS NULL
    AND t.status = 'active'
  ORDER BY t.business_name, c.name
$$;

-- =============================================================================
-- 3. Fold portal_enabled into the session-resolve liveness check
-- =============================================================================

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
    (c.is_active AND c.deleted_at IS NULL AND c.portal_enabled) AS customer_active
  FROM tenants t
  JOIN customers c ON c.tenant_id = t.id
  WHERE t.id = p_tenant_id
    AND c.id = p_customer_id
  LIMIT 1
$$;
