-- Kit / bundle items (roadmap #35)
--
-- A bundle is a virtual item composed of a static list of component items
-- with per-component quantities. Selling a bundle reduces each
-- component's stock by (invoice line qty × component qty) and books
-- weighted-average COGS across the components — the bundle SKU itself
-- carries no stock. The spec calls this a "lightweight, no-BOM"
-- assembly; full manufacturing (routing, labour, variance) is Phase 2.
--
-- Key design choices mirrored in the schema + API layer:
--   * Bundle items themselves never carry stock. `items.track_inventory`
--     is forced to `false` on write for `item_type='bundle'` — no
--     `item_balances` row, no stock ledger entries for the bundle SKU,
--     no assembly receipt to value the bundle. Cost rolls up at sale
--     time from each component's current WAVG.
--   * No nested bundles. Components cannot themselves be bundles. The
--     rule is enforced at the application layer in
--     `PUT /items/:id/components` rather than by a DB trigger: the
--     bundle universe is single-writer, a trigger would be overkill,
--     and the app-level check returns a friendlier error. Flagged in
--     `_status.md` so future maintainers know where the rule lives.
--   * Empty component list allowed. A bundle with zero components is
--     legal and intentionally permissive — tenants sometimes use
--     bundles as placeholder SKUs for hand-assembly or to book revenue
--     with zero COGS. The UI warns but doesn't block.
--
-- `items.item_type` already has the CHECK constraint listing
-- `('product','service','bundle')` since PR #4 (`04-operations.sql`),
-- so no widening is needed. Re-asserted below via idempotent
-- DROP + ADD so re-runs succeed and future migrations stay simple.
--
-- Fully idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS, DROP POLICY IF EXISTS + CREATE POLICY.

CREATE TABLE IF NOT EXISTS item_bundle_components (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Parent bundle. ON DELETE CASCADE so hard-deleting a bundle removes
  -- its component rows too. Bundles are normally soft-deleted via
  -- `items.deleted_at`, which leaves these rows intact — that's
  -- intentional: a restored bundle keeps its component list.
  bundle_item_id      uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  -- Component. ON DELETE RESTRICT so a component item can't be
  -- hard-deleted while a bundle still references it. Soft-deleting the
  -- component (setting `items.deleted_at`) is fine — the app filters
  -- `deleted_at IS NULL` when exploding the component list at sale
  -- time, so a soft-deleted component silently drops out of future
  -- bundle sales without breaking existing data.
  component_item_id   uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  -- Units of the component consumed per unit of bundle sold.
  -- 4 decimals matches the precision used on invoice lines.
  quantity            numeric(18,4) NOT NULL CHECK (quantity > 0),
  -- Display order on the bundle detail / component table. Client
  -- writes array index as sort_order on replace-all, so UI ordering is
  -- stable across fetches.
  sort_order          smallint NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- A bundle can't list itself as a component. Caught at DB level as a
  -- belt for the app-layer validation — this is the one invariant
  -- cheap enough to enforce twice.
  CONSTRAINT item_bundle_components_no_self_ref
    CHECK (component_item_id <> bundle_item_id)
);

-- One row per (bundle, component) pair. Duplicates are consolidated
-- client-side before `PUT /items/:id/components` fires — if two rows
-- for the same component were allowed, the explosion at sale time
-- would double-consume stock.
CREATE UNIQUE INDEX IF NOT EXISTS item_bundle_components_unique_pair
  ON item_bundle_components(bundle_item_id, component_item_id);

-- Primary access pattern: "load all components for this bundle" when
-- exploding invoice lines at post time. Tenant-scoped so the index
-- cooperates with RLS.
CREATE INDEX IF NOT EXISTS item_bundle_components_bundle_idx
  ON item_bundle_components(tenant_id, bundle_item_id);

-- Reverse lookup: "what bundles reference this component?" — used by
-- the ON DELETE RESTRICT check on items.id and by future UX that
-- warns before deactivating a component that's still in a bundle.
CREATE INDEX IF NOT EXISTS item_bundle_components_component_idx
  ON item_bundle_components(tenant_id, component_item_id);

ALTER TABLE item_bundle_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_bundle_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_bundle_components_tenant_isolation
  ON item_bundle_components;
CREATE POLICY item_bundle_components_tenant_isolation ON item_bundle_components
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Re-assert the items.item_type CHECK idempotently. The constraint
-- already allows 'bundle' since PR #4, but restating it here means
-- (a) a future code reader doesn't need to grep back through earlier
-- migrations to confirm, and (b) if some earlier migration was
-- force-replayed with a narrower list, this migration repairs it.
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_type_check;
ALTER TABLE items
  ADD CONSTRAINT items_type_check
  CHECK (item_type IN ('product','service','bundle'));
