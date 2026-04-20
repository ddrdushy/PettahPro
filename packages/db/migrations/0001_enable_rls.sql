-- ==============================================================================
-- PettahPro — RLS policies for tenant-scoped tables
-- Applied after Drizzle-generated migrations.
-- ==============================================================================

-- Users ------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Tenants table itself has NO RLS — provisioning & Super Admin need cross-tenant reads.
-- App-layer checks guard access instead.
