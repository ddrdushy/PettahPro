-- Attendance Capture (roadmap #39)
--
-- Per-employee daily attendance records, sourced from any of four
-- capture methods (self check-in/out, QR scan, biometric file import,
-- manual muster) and optionally overridden by a supervisor. One
-- record per (employee, date) — the day is the dedup key.
--
-- Shape — four tables wire the full lifecycle:
--
--   attendance_devices         — registry of biometric / QR / import
--                                sources. Per-tenant, per-branch,
--                                named, with an export-format + column
--                                template blob so the CSV mapping
--                                learned last time is remembered.
--   biometric_employee_map     — (device_id, biometric_employee_id)
--                                → employee_id. Biometric vendors
--                                hand out their own IDs; this is the
--                                join table that resolves them.
--   attendance_records         — the event. One per (employee, date).
--                                Holds check-in / check-out / total
--                                minutes, method, status, branch,
--                                source device, optional geolocation
--                                (for self-capture), supervisor user
--                                (for muster), conflict flags.
--   attendance_imports         — header per biometric file parse.
--                                Row counts (total/imported/skipped/
--                                errored), errors JSON, completed_at.
--
-- Key design choices (mirrored in the API layer):
--
--   · **One record per (employee, day).** Partial unique index on
--     `(tenant_id, employee_id, attendance_date) WHERE deleted_at IS
--     NULL`. Second punch for the same day = update (earliest
--     check_in_at, latest check_out_at). Method mismatch between two
--     punches on the same day = `has_conflict=true` plus a reason —
--     supervisor resolves it, we don't try to guess.
--
--   · **Methods are data-level, not separate tables.** The method enum
--     is `qr` / `biometric` / `geofence` / `manual_muster` / `self`.
--     Adding a new capture path = add the enum value + a route, not
--     a new table. Keeps reports / exports flat.
--
--   · **No shift / schedule / rule engine in v1.** This module
--     captures events. Computing pay-affecting totals (late, OT,
--     half-day policy, holiday roster) is payroll's job and lives in
--     future work #X (TBD). `total_minutes` is the raw delta; the
--     `status` field (`present` / `absent` / `half_day` / `on_leave` /
--     `holiday`) lets a supervisor flag outcomes but is not driven by
--     a rule engine here.
--
--   · **Biometric imports are stateless.** Each file creates an
--     `attendance_imports` row with a per-row errors array; the import
--     itself is just a bulk-upsert against `attendance_records`.
--     Re-running the same file is idempotent because the (employee,
--     date) key dedups.
--
--   · **Attachments via `document_attachments`** — the entity-type
--     whitelist is widened below to allow `'attendance_record'` so
--     geofence photos and muster sheets attach to individual rows
--     through the existing #32 infrastructure.
--
-- Fully idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS, DROP POLICY + CREATE POLICY, DO $$ LOOP seeding. Re-run the
-- file without error.

-- =============================================================================
-- 1. attendance_devices — registry
-- =============================================================================

CREATE TABLE IF NOT EXISTS attendance_devices (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                     varchar(120) NOT NULL,
  device_type              varchar(32) NOT NULL
    CHECK (device_type IN ('zkteco','essl','suprema','other','qr','manual')),
  branch_id                uuid REFERENCES branches(id) ON DELETE RESTRICT,
  export_format            varchar(16)
    CHECK (export_format IS NULL OR export_format IN ('csv','xlsx','txt')),
  -- Remembered column mapping from the last import. `{ columns: {...} }`
  -- shape — the import wizard saves the user's column → field mapping
  -- here so the next file from the same device defaults to the same layout.
  column_template          jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes                    text,
  last_import_at           timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

-- Friendly name is unique per tenant (excluding soft-deleted rows).
CREATE UNIQUE INDEX IF NOT EXISTS attendance_devices_tenant_name_unique
  ON attendance_devices(tenant_id, name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attendance_devices_tenant_idx
  ON attendance_devices(tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE attendance_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_devices_tenant_isolation ON attendance_devices;
CREATE POLICY attendance_devices_tenant_isolation ON attendance_devices
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 2. biometric_employee_map — biometric_id → employee_id
-- =============================================================================

CREATE TABLE IF NOT EXISTS biometric_employee_map (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attendance_device_id     uuid NOT NULL REFERENCES attendance_devices(id) ON DELETE CASCADE,
  -- The ID the biometric device hands out for this employee — device-
  -- specific, not universal. A single employee can have multiple rows
  -- (one per device they clock in on).
  biometric_employee_id    varchar(64) NOT NULL,
  employee_id              uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS biometric_employee_map_unique
  ON biometric_employee_map(tenant_id, attendance_device_id, biometric_employee_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS biometric_employee_map_employee_idx
  ON biometric_employee_map(tenant_id, employee_id)
  WHERE deleted_at IS NULL;

ALTER TABLE biometric_employee_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_employee_map FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS biometric_employee_map_tenant_isolation ON biometric_employee_map;
CREATE POLICY biometric_employee_map_tenant_isolation ON biometric_employee_map
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 3. attendance_records — the event
-- =============================================================================

CREATE TABLE IF NOT EXISTS attendance_records (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id              uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  attendance_date          date NOT NULL,
  branch_id                uuid REFERENCES branches(id) ON DELETE RESTRICT,
  check_in_at              timestamptz,
  check_out_at             timestamptz,
  -- Raw delta between check_in_at and check_out_at. Pay-affecting
  -- calculations (late / OT / half-day policy) are payroll's job and
  -- NOT computed here — this is purely the floor measurement.
  total_minutes            integer,
  method                   varchar(24) NOT NULL
    CHECK (method IN ('qr','biometric','geofence','manual_muster','self')),
  status                   varchar(16) NOT NULL DEFAULT 'present'
    CHECK (status IN ('present','absent','half_day','on_leave','holiday')),
  source_device_id         uuid REFERENCES attendance_devices(id) ON DELETE SET NULL,
  supervisor_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  location_lat             numeric(10,7),
  location_lng             numeric(10,7),
  -- Two punches on the same day from different methods flip this on
  -- and stash the reason string. Supervisor resolves via PATCH. We
  -- don't try to auto-pick a winner — silent data loss is worse than
  -- a visible exception queue.
  has_conflict             boolean NOT NULL DEFAULT false,
  conflict_reason          text,
  notes                    text,
  created_by_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz,
  CONSTRAINT attendance_records_in_before_out
    CHECK (check_in_at IS NULL OR check_out_at IS NULL OR check_out_at >= check_in_at)
);

-- The dedup key — one live record per (employee, day).
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_one_per_employee_per_day
  ON attendance_records(tenant_id, employee_id, attendance_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attendance_records_tenant_date_idx
  ON attendance_records(tenant_id, attendance_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attendance_records_tenant_employee_date_idx
  ON attendance_records(tenant_id, employee_id, attendance_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attendance_records_conflict_idx
  ON attendance_records(tenant_id, attendance_date DESC)
  WHERE has_conflict = true AND deleted_at IS NULL;

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_records_tenant_isolation ON attendance_records;
CREATE POLICY attendance_records_tenant_isolation ON attendance_records
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 4. attendance_imports — biometric file header
-- =============================================================================

CREATE TABLE IF NOT EXISTS attendance_imports (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attendance_device_id     uuid NOT NULL REFERENCES attendance_devices(id) ON DELETE RESTRICT,
  file_name                text NOT NULL,
  file_size_bytes          bigint,
  rows_total               integer NOT NULL DEFAULT 0,
  rows_imported            integer NOT NULL DEFAULT 0,
  rows_skipped             integer NOT NULL DEFAULT 0,
  rows_errored             integer NOT NULL DEFAULT 0,
  -- Per-row errors from the parse. Shape: `[{row: int, reason: str,
  -- biometricEmployeeId?: str, punchAt?: str}]`. Kept inline rather
  -- than a child table because the list is small (bounded by file
  -- size) and we only ever read-all / write-once.
  errors                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                   varchar(16) NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','completed','failed')),
  imported_by_user_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at               timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz
);

CREATE INDEX IF NOT EXISTS attendance_imports_tenant_created_idx
  ON attendance_imports(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS attendance_imports_device_idx
  ON attendance_imports(tenant_id, attendance_device_id, created_at DESC);

ALTER TABLE attendance_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_imports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_imports_tenant_isolation ON attendance_imports;
CREATE POLICY attendance_imports_tenant_isolation ON attendance_imports
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 5. Widen document_attachments entity_type CHECK to add attendance_record
-- =============================================================================
--
-- Geofence photos and manual muster sheet scans attach to individual
-- attendance rows through the generic #32 infrastructure. Drop + re-add
-- the constraint idempotently with the widened list. Keep in sync with
--   packages/db/src/schema/document-attachments.ts   (DOCUMENT_ATTACHMENT_ENTITY_TYPES)
-- and
--   apps/api/src/modules/platform/attachments.ts     (ENTITY_TABLE map).

ALTER TABLE document_attachments
  DROP CONSTRAINT IF EXISTS document_attachments_entity_type_check;
ALTER TABLE document_attachments
  ADD CONSTRAINT document_attachments_entity_type_check CHECK (
    entity_type IN (
      'invoice',
      'sales_order',
      'quotation',
      'credit_note',
      'bill',
      'purchase_order',
      'purchase_requisition',
      'goods_received_note',
      'expense_claim',
      'payment',
      'receipt',
      'final_settlement',
      'journal_entry',
      'petty_cash_transaction',
      'attendance_record'
    )
  );

-- =============================================================================
-- 6. updated_at trigger helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION attendance_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attendance_devices_updated_at ON attendance_devices;
CREATE TRIGGER attendance_devices_updated_at
  BEFORE UPDATE ON attendance_devices
  FOR EACH ROW EXECUTE FUNCTION attendance_set_updated_at();

DROP TRIGGER IF EXISTS biometric_employee_map_updated_at ON biometric_employee_map;
CREATE TRIGGER biometric_employee_map_updated_at
  BEFORE UPDATE ON biometric_employee_map
  FOR EACH ROW EXECUTE FUNCTION attendance_set_updated_at();

DROP TRIGGER IF EXISTS attendance_records_updated_at ON attendance_records;
CREATE TRIGGER attendance_records_updated_at
  BEFORE UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION attendance_set_updated_at();

-- attendance_imports has no updated_at (insert-once by design).

-- =============================================================================
-- 7. Permission seeds — attendance.operate + attendance.view
-- =============================================================================
--
-- Two keys:
--   · attendance.operate — create / update / delete records, mark
--                          muster, check-in / check-out, run imports,
--                          edit devices + biometric map (held by
--                          Owner / Admin / Accountant).
--   · attendance.view    — read-only list + exceptions queue (Owner /
--                          Admin / Accountant). Finer read-vs-write
--                          split is possible later (e.g. "supervisor
--                          can operate but only for own branch") —
--                          not needed in v1.
--
-- Rewrites `seed_admin_role_templates_for_tenant` to bake both keys
-- into new-tenant Owner / Admin / Accountant defaults. Then backfills
-- existing system-role rows (is_system=true, deleted_at IS NULL) so
-- that tenants live today inherit the keys without a data migration
-- step. Custom tenant-edited roles are left alone — tenant admins
-- grant the keys through the roles UI.

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
    'pos.operate',       true,
    'pos.close',         true,
    'reports.view',      true,
    'settings.manage',   true,
    'users.manage',      true,
    'approval.decide',   true,
    'purchase_requisitions.manage', true,
    'petty_cash.operate', true,
    'petty_cash.approve', true,
    'attendance.operate', true,
    'attendance.view',    true
  );
  accountant_perms jsonb := jsonb_build_object(
    'accounting.manage', true,
    'invoices.create',   true,
    'invoices.post',     true,
    'bills.create',      true,
    'bills.post',        true,
    'payments.manage',   true,
    'reports.view',      true,
    'approval.decide',   true,
    'purchase_requisitions.manage', true,
    'petty_cash.operate', true,
    'petty_cash.approve', true,
    'attendance.operate', true,
    'attendance.view',    true
  );
  sales_perms jsonb := jsonb_build_object(
    'invoices.create',   true,
    'invoices.post',     true,
    'pos.operate',       true,
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

-- Backfill: merge the two new keys into existing Owner / Admin /
-- Accountant system rows. Idempotent — the UPDATE is a no-op if the
-- key already maps to true.
UPDATE roles
   SET permissions = permissions
         || jsonb_build_object('attendance.operate', true)
         || jsonb_build_object('attendance.view', true),
       updated_at = now()
 WHERE is_system = true
   AND deleted_at IS NULL
   AND name IN ('Owner', 'Admin', 'Accountant')
   AND (
     COALESCE((permissions ->> 'attendance.operate')::boolean, false) = false
     OR COALESCE((permissions ->> 'attendance.view')::boolean, false) = false
   );
