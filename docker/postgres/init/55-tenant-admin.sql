-- Tenant admin — notification prefs (#25) + approval policies (#26) +
-- custom roles (#27). Three tables under one migration because they
-- all land as a single admin-UX feature set.
--
-- Design notes:
--
-- (#25) notification_preferences
--   Keyed by (tenant_id, user_id, kind) with a boolean enabled flag.
--   Emit-side treats "no row" as "enabled by default" so existing
--   users continue to receive everything until they opt out. A
--   tenant-wide digest setting (e.g. daily rollup) can be added later
--   as a separate settings key — this table is strictly per-user per-kind.
--
-- (#26) approval_policies
--   Schema-agnostic designer: each policy targets a `document_type`
--   ("journal_entry", "expense_claim", "bill", etc.), activates when
--   `trigger_rule` matches the document (simple JSON: minAmountCents,
--   submitters[], etc.), and then runs through `steps` in order. Each
--   step is { approvers: { kind: "role"|"user", id: string }[], anyOf: bool }.
--   v1 is designer + storage only — actual routing into domain
--   transitions is follow-up work. Existing per-domain approval
--   columns (journal_entries.status = pending_approval, etc.) keep
--   working unchanged.
--
-- (#27) roles + user_roles
--   A role is (tenant_id, name, permissions jsonb). Permissions is
--   a jsonb object mapping a permission key ("invoices.create",
--   "bills.void", ...) to true/false. user_roles is a many-to-many
--   junction so a user can hold more than one role. Owner (users.is_owner)
--   remains the super-admin bypass — nothing here can demote an owner.
--
-- Seed templates: Owner, Admin, Accountant, Sales, Read-only. These
-- land per-tenant via seed_admin_role_templates_for_tenant(tenant_uuid),
-- called at tenant bootstrap (caller responsibility) or manually from
-- the admin UI.

-- =============================================================================
-- (#25) notification_preferences
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       varchar(64) NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_tenant_user_kind_unique
  ON notification_preferences (tenant_id, user_id, kind);

CREATE INDEX IF NOT EXISTS notification_preferences_user_idx
  ON notification_preferences (tenant_id, user_id);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_rw ON notification_preferences;
CREATE POLICY notification_preferences_rw ON notification_preferences
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- (#26) approval_policies
-- =============================================================================

CREATE TABLE IF NOT EXISTS approval_policies (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           varchar(128) NOT NULL,
  description    text NULL,
  document_type  varchar(64) NOT NULL,
  trigger_rule   jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps          jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  deleted_at     timestamptz NULL
);

CREATE INDEX IF NOT EXISTS approval_policies_tenant_idx
  ON approval_policies (tenant_id, document_type, is_active)
  WHERE deleted_at IS NULL;

ALTER TABLE approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_policies_rw ON approval_policies;
CREATE POLICY approval_policies_rw ON approval_policies
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- (#27) roles + user_roles
-- =============================================================================

CREATE TABLE IF NOT EXISTS roles (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        varchar(64) NOT NULL,
  description text NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_name_unique
  ON roles (tenant_id, name)
  WHERE deleted_at IS NULL;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roles_rw ON roles;
CREATE POLICY roles_rw ON roles
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS user_roles (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_tenant_user_role_unique
  ON user_roles (tenant_id, user_id, role_id);

CREATE INDEX IF NOT EXISTS user_roles_user_idx
  ON user_roles (tenant_id, user_id);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_roles_rw ON user_roles;
CREATE POLICY user_roles_rw ON user_roles
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- Role-template seeding. Call once per tenant.
-- =============================================================================

CREATE OR REPLACE FUNCTION seed_admin_role_templates_for_tenant(tenant_uuid uuid)
RETURNS void AS $$
DECLARE
  full_perms jsonb := jsonb_build_object(
    'accounting.manage', true,
    'invoices.create',   true,
    'invoices.post',     true,
    'invoices.void',     true,
    'bills.create',      true,
    'bills.post',        true,
    'bills.void',        true,
    'payments.manage',   true,
    'payroll.manage',    true,
    'hr.manage',         true,
    'inventory.manage',  true,
    'reports.view',      true,
    'settings.manage',   true,
    'users.manage',      true
  );
  accountant_perms jsonb := jsonb_build_object(
    'accounting.manage', true,
    'invoices.create',   true,
    'invoices.post',     true,
    'bills.create',      true,
    'bills.post',        true,
    'payments.manage',   true,
    'reports.view',      true
  );
  sales_perms jsonb := jsonb_build_object(
    'invoices.create',   true,
    'invoices.post',     true,
    'reports.view',      true
  );
  readonly_perms jsonb := jsonb_build_object(
    'reports.view',      true
  );
BEGIN
  INSERT INTO roles (tenant_id, name, description, permissions, is_system)
  VALUES
    (tenant_uuid, 'Owner', 'Full access — nothing can strip this.', full_perms, true),
    (tenant_uuid, 'Admin', 'Day-to-day admin with full app access.', full_perms, true),
    (tenant_uuid, 'Accountant', 'Post invoices, bills, payments, view reports.', accountant_perms, true),
    (tenant_uuid, 'Sales', 'Create and post invoices; view reports.', sales_perms, true),
    (tenant_uuid, 'Read-only', 'View reports only — no create/post.', readonly_perms, true)
  ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Backfill: seed templates for every existing tenant. Safe on re-run
-- because of the ON CONFLICT above.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM seed_admin_role_templates_for_tenant(t.id);
  END LOOP;
END $$;
