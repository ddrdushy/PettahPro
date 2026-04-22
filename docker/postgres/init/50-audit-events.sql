-- Audit log (#22)
-- Append-only event stream for governance-sensitive actions: posting /
-- voiding documents, closing periods, approving journal entries, writing
-- off bad debts, employee exits, login/logout.
--
-- Design choices:
--   - Append-only. No UPDATE or DELETE policy. Admin/superuser can prune
--     on retention policy outside the app if ever needed.
--   - tenant_id scoped under RLS like everything else.
--   - `kind` is a free-form string (not an enum) so new modules can write
--     their own events without a schema migration.
--   - `ref_type`/`ref_id` point at the affected domain object (e.g.
--     'journal_entry' + UUID). The viewer can deep-link back.
--   - `summary` is a human-readable one-liner — this is what the viewer
--     renders in the main list. Keep it short and specific.
--   - `diff` JSONB is the machine-readable detail, rendered in a drawer.
--     Shape is event-specific, but conventionally { before, after } or
--     { context: {...} }.

CREATE TABLE IF NOT EXISTS audit_events (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  kind          varchar(64) NOT NULL,
  ref_type      varchar(64) NULL,
  ref_id        uuid NULL,
  summary       text NOT NULL,
  diff          jsonb NULL,
  ip_address    inet NULL,
  user_agent    varchar(512) NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_created_idx
  ON audit_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_kind_idx
  ON audit_events (tenant_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_ref_idx
  ON audit_events (tenant_id, ref_type, ref_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_actor_idx
  ON audit_events (tenant_id, actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

-- Read: tenant-isolated
DROP POLICY IF EXISTS audit_events_read ON audit_events;
CREATE POLICY audit_events_read ON audit_events
  FOR SELECT
  USING (tenant_id = current_tenant_id());

-- Insert: tenant-isolated. Any role connected with the tenant context can
-- append. No UPDATE or DELETE policy → immutable from the app's perspective.
DROP POLICY IF EXISTS audit_events_insert ON audit_events;
CREATE POLICY audit_events_insert ON audit_events
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

-- Explicitly revoke UPDATE/DELETE from the app role. Even without a policy
-- this is enforced by the default-deny, but revoking makes the intent
-- obvious and survives someone accidentally adding a permissive policy.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pettahpro_app') THEN
    REVOKE UPDATE, DELETE ON audit_events FROM pettahpro_app;
  END IF;
END $$;

-- Login/logout are written before we have a tenant context — they happen
-- across auth-helper boundaries. The identity plugin sets app.tenant_id
-- right after login so the RLS check passes. For "failed login" events
-- where we don't know the tenant yet, we skip the write (we don't have
-- RLS-safe storage for pre-auth events — that's acceptable; failed logins
-- live in server logs).
