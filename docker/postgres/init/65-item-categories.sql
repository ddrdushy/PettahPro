-- Item category hierarchy (roadmap #36, inventory-module-spec §2.4).
--
-- Unlimited-depth tree of item categories per tenant. Each category can
-- carry defaults (valuation method, tax code, COA accounts, SKU prefix,
-- reorder point) that an item inherits unless it overrides directly.
-- Inheritance is resolved at read time by walking the parent chain
-- until a non-null value is found.
--
-- Design notes:
--
--   * Parent is a nullable self-reference. ON DELETE RESTRICT so deleting
--     a non-leaf accidentally is impossible — the app surfaces a "move or
--     delete children first" error.
--
--   * Cycle prevention lives in a BEFORE INSERT/UPDATE trigger that walks
--     the parent chain and errors out if NEW.id shows up. App-level check
--     alone would be racy under concurrent updates.
--
--   * Sibling uniqueness: `(tenant_id, parent_id, lower(name))`. Use a
--     partial index covering both NULL and non-NULL parent with COALESCE
--     so two top-level categories can't share a name.
--
--   * items.category_id added as nullable FK so existing items keep
--     working. ON DELETE SET NULL matches "category removed but items
--     survive" semantics — items aren't data-loss when a category is
--     retired, they just lose their group.
--
-- All changes are idempotent (IF NOT EXISTS + OR REPLACE + guarded trigger
-- drop/create).

-- =============================================================================
-- 1. item_categories table
-- =============================================================================

CREATE TABLE IF NOT EXISTS item_categories (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id   uuid NULL REFERENCES item_categories(id) ON DELETE RESTRICT,

  name        varchar(128) NOT NULL,
  -- Tenant-configurable SKU prefix per category (e.g. "TEX-" for textile,
  -- "PHR-" for pharmacy). Used by item auto-code generation when the
  -- item lands in this category. Spec §2.3.
  code_prefix varchar(16) NULL,

  -- Per-category defaults. All NULL-able so "unset" = "inherit from
  -- parent". Resolved at read time by walking the ancestor chain.
  default_valuation_method    varchar(16) NULL,
  default_tax_code_id         uuid NULL,
  default_income_account_id   uuid NULL,
  default_expense_account_id  uuid NULL,
  default_asset_account_id    uuid NULL,
  default_reorder_point       integer NULL,

  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL
);

CREATE INDEX IF NOT EXISTS item_categories_tenant_idx
  ON item_categories (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS item_categories_parent_idx
  ON item_categories (tenant_id, parent_id)
  WHERE deleted_at IS NULL;

-- Sibling-name uniqueness. Partial index covers both NULL and non-NULL
-- parent via COALESCE to a zero-uuid sentinel (uuid_nil() lives in
-- uuid-ossp which we already have via uuid_generate_v7).
CREATE UNIQUE INDEX IF NOT EXISTS item_categories_sibling_name_uidx
  ON item_categories (
    tenant_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  )
  WHERE deleted_at IS NULL;

ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_categories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_categories_rw ON item_categories;
CREATE POLICY item_categories_rw ON item_categories
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- =============================================================================
-- 2. Cycle-prevention trigger
-- =============================================================================
--
-- Walks the parent chain from NEW.parent_id upward. If we revisit any
-- id we've already seen (including NEW.id itself), raise — this would
-- create a loop that recursive-CTE readers (breadcrumbs, descendant
-- listings) would loop forever on.
--
-- Also enforces that parent is in the same tenant as the child.
CREATE OR REPLACE FUNCTION item_categories_prevent_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_current uuid;
  v_seen    uuid[];
  v_parent_tenant uuid;
  v_hops    integer := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Parent must live in the same tenant — the self-ref FK doesn't enforce
  -- that by itself.
  SELECT tenant_id INTO v_parent_tenant
  FROM item_categories
  WHERE id = NEW.parent_id;

  IF v_parent_tenant IS NULL THEN
    RAISE EXCEPTION 'parent category % not found', NEW.parent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_parent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'parent category belongs to a different tenant'
      USING ERRCODE = 'check_violation';
  END IF;

  v_current := NEW.parent_id;
  v_seen := ARRAY[NEW.id];

  -- 64 levels is ludicrous for a category tree but guards against a
  -- malformed table state spinning the loop forever.
  WHILE v_current IS NOT NULL AND v_hops < 64 LOOP
    IF v_current = ANY(v_seen) THEN
      RAISE EXCEPTION 'category hierarchy would create a cycle'
        USING ERRCODE = 'check_violation';
    END IF;
    v_seen := v_seen || v_current;
    SELECT parent_id INTO v_current
    FROM item_categories
    WHERE id = v_current;
    v_hops := v_hops + 1;
  END LOOP;

  IF v_hops >= 64 THEN
    RAISE EXCEPTION 'category hierarchy exceeds max depth'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_item_categories_cycle ON item_categories;
CREATE TRIGGER trg_item_categories_cycle
  BEFORE INSERT OR UPDATE OF parent_id, tenant_id ON item_categories
  FOR EACH ROW
  EXECUTE FUNCTION item_categories_prevent_cycle();

-- =============================================================================
-- 3. updated_at trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION item_categories_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_item_categories_updated_at ON item_categories;
CREATE TRIGGER trg_item_categories_updated_at
  BEFORE UPDATE ON item_categories
  FOR EACH ROW
  EXECUTE FUNCTION item_categories_touch_updated_at();

-- =============================================================================
-- 4. Link items to categories
-- =============================================================================
--
-- Nullable FK so existing items keep working with no backfill. ON DELETE
-- SET NULL so retiring a category doesn't cascade-delete its items —
-- they just lose their grouping, which is what a tenant expects.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS category_id uuid NULL
    REFERENCES item_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS items_category_idx
  ON items (tenant_id, category_id)
  WHERE deleted_at IS NULL AND category_id IS NOT NULL;

-- =============================================================================
-- 5. Helper: resolve effective defaults by walking ancestor chain
-- =============================================================================
--
-- Given a category id, returns the category's own defaults merged with
-- inherited ones from ancestors (first non-null value wins, child
-- overrides parent). Used by the `/item-categories/:id/effective` route
-- and by item-create prefill on the admin side.
--
-- Implemented as a recursive CTE so deep trees don't cost one round-trip
-- per hop. Runs under RLS — caller must be inside withTenant().
CREATE OR REPLACE FUNCTION item_category_effective_defaults(p_category_id uuid)
RETURNS TABLE (
  category_id                uuid,
  tenant_id                  uuid,
  name                       varchar,
  depth                      integer,
  code_prefix                varchar,
  default_valuation_method   varchar,
  default_tax_code_id        uuid,
  default_income_account_id  uuid,
  default_expense_account_id uuid,
  default_asset_account_id   uuid,
  default_reorder_point      integer
)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE chain AS (
    SELECT
      c.id, c.tenant_id, c.name, c.parent_id, 0 AS depth,
      c.code_prefix,
      c.default_valuation_method,
      c.default_tax_code_id,
      c.default_income_account_id,
      c.default_expense_account_id,
      c.default_asset_account_id,
      c.default_reorder_point
    FROM item_categories c
    WHERE c.id = p_category_id
      AND c.tenant_id = current_tenant_id()
      AND c.deleted_at IS NULL

    UNION ALL

    SELECT
      p.id, p.tenant_id, p.name, p.parent_id, chain.depth + 1,
      p.code_prefix,
      p.default_valuation_method,
      p.default_tax_code_id,
      p.default_income_account_id,
      p.default_expense_account_id,
      p.default_asset_account_id,
      p.default_reorder_point
    FROM item_categories p
    INNER JOIN chain ON p.id = chain.parent_id
    WHERE p.deleted_at IS NULL
  )
  -- Aggregate to first non-null value along the chain (child wins because
  -- depth 0 = self, increasing upward). coalesce across the chain in
  -- depth order using array_agg + array_remove.
  SELECT
    p_category_id,
    (SELECT tenant_id FROM chain ORDER BY depth LIMIT 1),
    (SELECT name      FROM chain ORDER BY depth LIMIT 1),
    (SELECT max(depth) FROM chain),
    (array_remove(array_agg(chain.code_prefix ORDER BY chain.depth), NULL))[1],
    (array_remove(array_agg(chain.default_valuation_method ORDER BY chain.depth), NULL))[1],
    (array_remove(array_agg(chain.default_tax_code_id ORDER BY chain.depth), NULL))[1],
    (array_remove(array_agg(chain.default_income_account_id ORDER BY chain.depth), NULL))[1],
    (array_remove(array_agg(chain.default_expense_account_id ORDER BY chain.depth), NULL))[1],
    (array_remove(array_agg(chain.default_asset_account_id ORDER BY chain.depth), NULL))[1],
    (array_remove(array_agg(chain.default_reorder_point ORDER BY chain.depth), NULL))[1]
  FROM chain
$$;
