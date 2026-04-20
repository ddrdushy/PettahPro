-- PettahPro Postgres bootstrap
-- Runs once on first container start.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- UUID v7 helper (Postgres 16 lacks a built-in; this is a minimal impl)
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  unix_ts_ms bigint;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  uuid_bytes := set_byte(gen_random_bytes(16), 0, ((unix_ts_ms >> 40) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 1, ((unix_ts_ms >> 32) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 2, ((unix_ts_ms >> 24) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 3, ((unix_ts_ms >> 16) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 4, ((unix_ts_ms >> 8) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 5, (unix_ts_ms & 255)::int);
  -- Set version (7) in the high nibble of byte 6
  uuid_bytes := set_byte(uuid_bytes, 6, ((get_byte(uuid_bytes, 6) & 15) | 112)::int);
  -- Set variant (RFC 4122) in the high bits of byte 8
  uuid_bytes := set_byte(uuid_bytes, 8, ((get_byte(uuid_bytes, 8) & 63) | 128)::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$;

-- Tenant-context helper used by every RLS policy.
-- Set at the start of each request: SELECT set_config('app.tenant_id', '<uuid>', true);
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;
