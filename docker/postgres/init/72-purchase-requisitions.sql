-- Purchase Requisitions (roadmap #30)
--
-- Internal "request to buy" document routed through the approval engine
-- (#43 / #43a-e) and converted to a Purchase Order once approved. Off by
-- default per tenant via settings.purchaseRequisitionsEnabled; enabling
-- turns on the API/UI surface and (optionally) pairs with a policy that
-- parks submissions in `pending_approval` until cleared from /approvals.
--
-- Shape:
--   purchase_requisitions        — header. Statuses: draft, pending_approval,
--                                  approved, rejected, converted, cancelled.
--   purchase_requisition_lines   — line items. line_status: pending, approved,
--                                  rejected (partial approval supported — the
--                                  header flips to `approved` if at least one
--                                  line remains approved, else `rejected`).
--
-- Link to PO: purchase_orders gains `source_pr_id` (FK, SET NULL on PR delete
-- which can only happen when PR is a soft-deleted draft — the FK is primarily
-- a back-reference used by the convert-to-PO flow and reporting).
-- purchase_order_lines gains `source_pr_line_id` (no FK — application-level
-- link, SET NULL-on-delete would cascade from the PR side anyway).
--
-- Idempotent: every DDL uses IF NOT EXISTS / DROP…CREATE.

CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pr_number            varchar(48),
  branch_id            uuid REFERENCES branches(id) ON DELETE SET NULL,
  -- Optional preferred supplier hint. Not required — PRs are commonly
  -- raised before sourcing. Surfaces as a default on convert-to-PO.
  preferred_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  status               varchar(24) NOT NULL DEFAULT 'draft',
  needed_by_date       date,
  currency             varchar(3) NOT NULL DEFAULT 'LKR',
  estimated_total_cents bigint NOT NULL DEFAULT 0,
  purpose              text,               -- why we need this
  notes                text,

  -- Lifecycle audit
  submitted_at         timestamptz,
  submitted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at          timestamptz,
  approved_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  rejected_at          timestamptz,
  rejected_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  rejected_reason      text,
  cancelled_at         timestamptz,
  cancelled_reason     text,
  -- Converted-to-PO stamps. We only allow a single conversion — convert
  -- endpoint flips status to 'converted' and records the PO id here.
  converted_at         timestamptz,
  converted_po_id      uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,

  -- Approval engine linkage (#43e pattern, mirrors final_settlements).
  approval_request_id  uuid REFERENCES approval_requests(id) ON DELETE SET NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at           timestamptz,

  CONSTRAINT purchase_requisitions_status_check CHECK (status IN (
    'draft','pending_approval','approved','rejected','converted','cancelled'
  )),
  CONSTRAINT purchase_requisitions_est_total_non_negative CHECK (
    estimated_total_cents >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_requisitions_tenant_number_unique
  ON purchase_requisitions(tenant_id, pr_number)
  WHERE pr_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_requisitions_tenant_status_idx
  ON purchase_requisitions(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS purchase_requisitions_needed_by_idx
  ON purchase_requisitions(tenant_id, needed_by_date)
  WHERE deleted_at IS NULL AND needed_by_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_requisitions_approval_request_idx
  ON purchase_requisitions(approval_request_id)
  WHERE approval_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_requisitions_converted_po_idx
  ON purchase_requisitions(converted_po_id)
  WHERE converted_po_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_requisition_id  uuid NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  line_no                  smallint NOT NULL,
  item_id                  uuid REFERENCES items(id) ON DELETE SET NULL,
  description              varchar(500) NOT NULL,
  quantity                 numeric(18,4) NOT NULL DEFAULT 1,
  -- Estimated unit price — a hint to the approver. Actual price lives on
  -- the downstream PO line. Nullable so the submitter can leave it blank.
  estimated_unit_price_cents bigint,
  estimated_line_total_cents bigint NOT NULL DEFAULT 0,
  -- Per-line approval state. Partial approval = some lines rejected, at
  -- least one approved → header still flips to 'approved'.
  line_status              varchar(16) NOT NULL DEFAULT 'pending',
  line_rejected_reason     text,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT purchase_requisition_lines_qty_positive CHECK (quantity > 0),
  CONSTRAINT purchase_requisition_lines_amounts_non_negative CHECK (
    (estimated_unit_price_cents IS NULL OR estimated_unit_price_cents >= 0)
    AND estimated_line_total_cents >= 0
  ),
  CONSTRAINT purchase_requisition_lines_status_check CHECK (
    line_status IN ('pending','approved','rejected')
  )
);

CREATE INDEX IF NOT EXISTS purchase_requisition_lines_pr_idx
  ON purchase_requisition_lines(purchase_requisition_id, line_no);
CREATE INDEX IF NOT EXISTS purchase_requisition_lines_tenant_item_idx
  ON purchase_requisition_lines(tenant_id, item_id);

ALTER TABLE purchase_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requisitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_requisitions_tenant_isolation ON purchase_requisitions;
CREATE POLICY purchase_requisitions_tenant_isolation ON purchase_requisitions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE purchase_requisition_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requisition_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_requisition_lines_tenant_isolation ON purchase_requisition_lines;
CREATE POLICY purchase_requisition_lines_tenant_isolation ON purchase_requisition_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Back-link on purchase_orders so a converted PO can cheaply show "from
-- PR-2026-0001". FK kept, ON DELETE SET NULL: PR deletion is only possible
-- while draft (guarded at API layer), but SET NULL keeps PO rows valid if
-- a draft PR is ever force-removed.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS source_pr_id uuid NULL
    REFERENCES purchase_requisitions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS purchase_orders_source_pr_idx
  ON purchase_orders(source_pr_id)
  WHERE source_pr_id IS NOT NULL;

-- Line-level back-link. No FK — the line is cascaded from the PR header
-- anyway, and avoiding a FK here keeps schema cycles out of drizzle/tooling.
ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS source_pr_line_id uuid NULL;

-- Per-tenant document_sequences seed: prefix 'PR', scope 'year', pad 4 →
-- PR-2026-0001. Template interpolation handled by next_document_number().
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    IF to_regclass('public.document_sequences') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM document_sequences
        WHERE tenant_id = t.id AND sequence_name = 'purchase_requisition'
      )
    THEN
      INSERT INTO document_sequences (tenant_id, sequence_name, prefix, scope, pad_width, display_name)
      VALUES (t.id, 'purchase_requisition', 'PR', 'year', 4, 'Purchase requisition')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- Role-template permission: purchase_requisitions.manage
-- =============================================================================
--
-- Gate for every mutating PR endpoint (create, patch, submit, approve,
-- reject, cancel, convert). Matches the coarse-grained style used across
-- the codebase (payroll.manage, bills.post, etc.). Owners + Admins +
-- Accountants receive it; Sales + Read-only do not.
--
-- Rewrites `seed_admin_role_templates_for_tenant` so future tenants get
-- the new key baked into their Owner/Admin/Accountant defaults. Also
-- backfills existing system-role rows (is_system=true, deleted_at IS NULL)
-- by merging the new key into their permissions JSON — idempotent: the
-- merge is a no-op if the key already equals true.

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
    'purchase_requisitions.manage', true
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
    'purchase_requisitions.manage', true
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

-- Backfill: add purchase_requisitions.manage to any pre-existing system
-- role row for Owner/Admin/Accountant. Custom tenant-edited roles are
-- left alone — tenant admins grant the key through the UI.
UPDATE roles
   SET permissions = permissions || jsonb_build_object('purchase_requisitions.manage', true),
       updated_at  = now()
 WHERE is_system = true
   AND deleted_at IS NULL
   AND name IN ('Owner', 'Admin', 'Accountant')
   AND COALESCE((permissions ->> 'purchase_requisitions.manage')::boolean, false) = false;
