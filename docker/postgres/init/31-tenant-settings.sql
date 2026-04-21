-- Per-tenant settings. Single row per tenant, JSONB blob so we can add new
-- knobs without a migration every time. New settings land in the defaults on
-- tenant create and are merged at read-time (falling back to the default) so
-- existing rows never need backfill when a new knob is introduced.
--
-- Initial keys:
--   salaryDaysPerMonth (integer) — divisor for pro-rated payroll calculations
--                                  (default 30 = Sri Lankan convention).

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_settings_isolation ON tenant_settings;
CREATE POLICY tenant_settings_isolation ON tenant_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Seed an empty settings row for every existing tenant.
INSERT INTO tenant_settings (tenant_id, settings)
SELECT id, '{}'::jsonb
  FROM tenants
 WHERE NOT EXISTS (SELECT 1 FROM tenant_settings ts WHERE ts.tenant_id = tenants.id);
