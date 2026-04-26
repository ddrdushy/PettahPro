-- 95-cost-centers.sql — first dimension on journal lines (gaps B1).
--
-- Multi-branch / multi-project SMEs need "P&L by branch" or "P&L by
-- project" — the headline ask once a tenant has more than one
-- physical location. branchId already lives on document headers
-- (invoices.branch_id, etc.) but doesn't propagate to journal_lines,
-- so the GL-level reports can't slice by it.
--
-- This migration introduces ONE dimension — `cost_center` — as a
-- proof-of-concept that ships real value (P&L by cost center) without
-- locking us into a particular shape for future dimensions
-- (department, project, customer-segment, ...). When we eventually
-- need a second dimension, the natural follow-up is either:
--   1. Add another nullable FK column (cheap; 2-3 dimensions max), or
--   2. Migrate to `dimensions jsonb` on journal_lines (more flexible,
--      pricier filter queries; defer until we actually have 4+
--      dimensions).
--
-- v1 scope:
--   * cost_centers table — code, name, optional parent for hierarchy,
--     active flag.
--   * journal_lines.cost_center_id — nullable FK; existing GL rows
--     stay null.
--   * Propagation v1: invoice post stamps invoice.cost_center_id
--     onto every journal line it creates. Other doc types (bills,
--     payments, payroll, JEs) keep their journal_lines.cost_center_id
--     null until follow-up PRs wire them up. The reporting filter
--     just reads what's there — null rows show under "Unassigned."
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS cost_centers (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
    tenant_id uuid NOT NULL
        REFERENCES tenants(id) ON DELETE CASCADE,
    -- Stable handle. Used in URLs + report filters. Human-readable
    -- on purpose (not a uuid in the URL); admins reorganise but
    -- rarely rename.
    code varchar(32) NOT NULL,
    name varchar(160) NOT NULL,
    -- Optional hierarchy — "Pettah branch" → "Pettah, Floor 1" /
    -- "Pettah, Floor 2". Reports roll up via recursive CTE when set;
    -- v1 doesn't ship the rollup but the column lets us add it
    -- without a follow-up migration.
    parent_cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
    is_active boolean NOT NULL DEFAULT true,
    notes varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    -- Per-tenant code uniqueness (case-insensitive); soft-deleted
    -- rows excluded so a re-create of a deleted code works.
    CONSTRAINT cost_centers_no_self_parent CHECK (parent_cost_center_id IS NULL OR parent_cost_center_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_tenant_code_unique
    ON cost_centers (tenant_id, LOWER(code))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cost_centers_tenant_active_idx
    ON cost_centers (tenant_id, is_active)
    WHERE deleted_at IS NULL;

-- RLS — same pattern as every other tenant-scoped table.
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_centers_tenant_isolation ON cost_centers;
CREATE POLICY cost_centers_tenant_isolation
    ON cost_centers
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- updated_at trigger (reuse the function declared in 88-pricing-plans.sql).
DROP TRIGGER IF EXISTS trg_cost_centers_updated_at ON cost_centers;
CREATE TRIGGER trg_cost_centers_updated_at
    BEFORE UPDATE ON cost_centers
    FOR EACH ROW
    EXECUTE FUNCTION set_subscriptions_updated_at();

GRANT SELECT, INSERT, UPDATE ON cost_centers TO pettahpro_app;

-- Add cost_center_id to documents that drive journal posting in v1.
-- Invoices first (most common doc with branchId; biggest bang for
-- buck). Bills/payments/payroll wire up in follow-ups.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS cost_center_id uuid
        REFERENCES cost_centers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_cost_center_idx
    ON invoices (tenant_id, cost_center_id)
    WHERE cost_center_id IS NOT NULL;

-- And the dimension column on journal lines themselves. Nullable so
-- every existing row stays valid; new posts (from invoices in v1)
-- stamp this from the parent doc. Unposted/manual JEs and
-- non-invoice posts leave it null and roll up under "Unassigned"
-- in the reports.
ALTER TABLE journal_lines
    ADD COLUMN IF NOT EXISTS cost_center_id uuid
        REFERENCES cost_centers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS journal_lines_cost_center_idx
    ON journal_lines (tenant_id, cost_center_id)
    WHERE cost_center_id IS NOT NULL;
