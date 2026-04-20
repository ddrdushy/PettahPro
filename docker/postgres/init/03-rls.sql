-- PettahPro RLS policies
-- Runs once on first container start (after schema is built).

-- Tenants: NO RLS — Super Admin and provisioning code need cross-tenant reads.
-- Access is gated at the application layer.

-- Users: tenant-scoped RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
