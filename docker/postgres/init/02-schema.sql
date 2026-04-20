-- PettahPro core schema
-- Runs once on first container start (after 01-extensions.sql).

-- ------------------------------------------------------------------------------
-- tenants
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug           varchar(63) NOT NULL UNIQUE,
  business_name  varchar(255) NOT NULL,
  country        varchar(2) NOT NULL DEFAULT 'LK',
  timezone       varchar(63) NOT NULL DEFAULT 'Asia/Colombo',
  status         varchar(32) NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  notes          text
);

CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants(status) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- users (tenant-scoped)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email           varchar(255) NOT NULL,
  full_name       varchar(255) NOT NULL,
  password_hash   varchar(255),
  is_active       boolean NOT NULL DEFAULT true,
  is_owner        boolean NOT NULL DEFAULT false,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email_unique
  ON users(tenant_id, email)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_email_lookup
  ON users(lower(email))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id);
