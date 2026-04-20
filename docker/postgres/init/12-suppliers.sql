-- Suppliers — AP counterpart to customers. Same audit & SL fields + WHT defaults.

CREATE TABLE IF NOT EXISTS suppliers (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                    varchar(32),
  name                    varchar(255) NOT NULL,
  legal_name              varchar(255),
  email                   varchar(255),
  phone                   varchar(32),
  whatsapp                varchar(32),
  address_line1           varchar(255),
  address_line2           varchar(255),
  city                    varchar(128),
  postal_code             varchar(16),
  country                 varchar(2) NOT NULL DEFAULT 'LK',
  -- SL identifiers
  tin                     varchar(32),
  vat_no                  varchar(32),
  br_no                   varchar(32),
  -- Commercial
  payment_terms_days      integer NOT NULL DEFAULT 0,
  currency                varchar(3) NOT NULL DEFAULT 'LKR',
  -- Default WHT code for this supplier (e.g. services = WHT5, rent = WHT10)
  default_wht_tax_code_id uuid REFERENCES tax_codes(id) ON DELETE SET NULL,
  -- Bank details for SLIPS / direct transfer
  bank_name               varchar(128),
  bank_account_no         varchar(64),
  bank_branch             varchar(128),
  tags                    jsonb NOT NULL DEFAULT '[]',
  notes                   text,
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  CONSTRAINT suppliers_payment_terms_non_negative CHECK (payment_terms_days >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_code_unique
  ON suppliers(tenant_id, code)
  WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE INDEX IF NOT EXISTS suppliers_tenant_idx ON suppliers(tenant_id);
CREATE INDEX IF NOT EXISTS suppliers_name_search
  ON suppliers USING gin(name gin_trgm_ops)
  WHERE deleted_at IS NULL;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suppliers_tenant_isolation ON suppliers;
CREATE POLICY suppliers_tenant_isolation ON suppliers
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
