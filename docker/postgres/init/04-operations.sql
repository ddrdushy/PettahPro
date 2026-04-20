-- PettahPro operations: branches, warehouses, customers, items
-- Standard audit columns on every tenant-scoped table.

-- ------------------------------------------------------------------------------
-- branches
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          varchar(16) NOT NULL,
  name          varchar(255) NOT NULL,
  is_head_office boolean NOT NULL DEFAULT false,
  address_line1 varchar(255),
  address_line2 varchar(255),
  city          varchar(128),
  postal_code   varchar(16),
  phone         varchar(32),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_code_unique
  ON branches(tenant_id, code)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS branches_tenant_idx ON branches(tenant_id);

-- ------------------------------------------------------------------------------
-- warehouses
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id     uuid REFERENCES branches(id) ON DELETE SET NULL,
  code          varchar(16) NOT NULL,
  name          varchar(255) NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS warehouses_tenant_code_unique
  ON warehouses(tenant_id, code)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS warehouses_tenant_idx ON warehouses(tenant_id);

-- ------------------------------------------------------------------------------
-- customers
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code              varchar(32),
  name              varchar(255) NOT NULL,
  legal_name        varchar(255),
  email             varchar(255),
  phone             varchar(32),
  whatsapp          varchar(32),
  address_line1     varchar(255),
  address_line2     varchar(255),
  city              varchar(128),
  postal_code       varchar(16),
  country           varchar(2) NOT NULL DEFAULT 'LK',
  -- SL-specific fields
  tin               varchar(32),
  vat_no            varchar(32),
  br_no             varchar(32),
  -- Commercial
  payment_terms_days integer NOT NULL DEFAULT 0,
  credit_limit_cents bigint NOT NULL DEFAULT 0,
  currency          varchar(3) NOT NULL DEFAULT 'LKR',
  price_list_id     uuid,
  tags              jsonb NOT NULL DEFAULT '[]',
  notes             text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT customers_payment_terms_non_negative CHECK (payment_terms_days >= 0),
  CONSTRAINT customers_credit_limit_non_negative CHECK (credit_limit_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_code_unique
  ON customers(tenant_id, code)
  WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_tenant_idx ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS customers_name_search
  ON customers USING gin(name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- items (products + services)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku                varchar(64),
  barcode            varchar(64),
  name               varchar(255) NOT NULL,
  description        text,
  item_type          varchar(16) NOT NULL DEFAULT 'product',  -- product | service | bundle
  unit               varchar(16) NOT NULL DEFAULT 'unit',     -- unit | kg | box | hour | etc.
  -- Pricing
  sell_price_cents   bigint NOT NULL DEFAULT 0,
  buy_price_cents    bigint NOT NULL DEFAULT 0,
  currency           varchar(3) NOT NULL DEFAULT 'LKR',
  tax_code_id        uuid,
  -- Inventory
  track_inventory    boolean NOT NULL DEFAULT true,
  valuation_method   varchar(16) NOT NULL DEFAULT 'weighted_avg', -- fifo | weighted_avg | standard
  reorder_point      integer,
  -- Accounting hooks — wired after COA is created
  income_account_id  uuid,
  expense_account_id uuid,
  asset_account_id   uuid,
  -- Meta
  tags               jsonb NOT NULL DEFAULT '[]',
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CONSTRAINT items_type_check CHECK (item_type IN ('product','service','bundle')),
  CONSTRAINT items_valuation_check CHECK (valuation_method IN ('fifo','weighted_avg','standard')),
  CONSTRAINT items_sell_non_negative CHECK (sell_price_cents >= 0),
  CONSTRAINT items_buy_non_negative CHECK (buy_price_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS items_tenant_sku_unique
  ON items(tenant_id, sku)
  WHERE deleted_at IS NULL AND sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_tenant_idx ON items(tenant_id);
CREATE INDEX IF NOT EXISTS items_name_search
  ON items USING gin(name gin_trgm_ops)
  WHERE deleted_at IS NULL;
