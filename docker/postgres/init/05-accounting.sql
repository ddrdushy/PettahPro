-- PettahPro accounting core: chart of accounts, tax codes, fiscal periods

-- ------------------------------------------------------------------------------
-- chart_of_accounts
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            varchar(16) NOT NULL,
  name            varchar(255) NOT NULL,
  account_type    varchar(16) NOT NULL, -- asset | liability | equity | income | expense
  account_subtype varchar(32),          -- cash, bank, ar, ap, inventory, tax_payable, cogs, etc.
  parent_id       uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  normal_side     varchar(2) NOT NULL,  -- dr | cr
  is_system       boolean NOT NULL DEFAULT false,  -- locked by platform (cannot delete)
  is_active       boolean NOT NULL DEFAULT true,
  currency        varchar(3) NOT NULL DEFAULT 'LKR',
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT coa_type_check CHECK (account_type IN ('asset','liability','equity','income','expense')),
  CONSTRAINT coa_side_check CHECK (normal_side IN ('dr','cr'))
);

CREATE UNIQUE INDEX IF NOT EXISTS coa_tenant_code_unique
  ON chart_of_accounts(tenant_id, code)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS coa_tenant_type ON chart_of_accounts(tenant_id, account_type)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS coa_parent_idx ON chart_of_accounts(parent_id);

-- ------------------------------------------------------------------------------
-- tax_codes (SL: VAT, WHT, SSCL, exempt, zero-rated)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_codes (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code             varchar(16) NOT NULL,
  name             varchar(128) NOT NULL,
  tax_kind         varchar(16) NOT NULL, -- vat | wht | sscl | stamp | exempt | zero
  rate_bps         integer NOT NULL,      -- basis points (1800 = 18.00%)
  is_inclusive     boolean NOT NULL DEFAULT false,
  applies_to       varchar(16) NOT NULL DEFAULT 'both', -- sale | purchase | both
  payable_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  receivable_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_system        boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  effective_from   date,
  effective_to     date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT tax_kind_check CHECK (tax_kind IN ('vat','wht','sscl','stamp','exempt','zero')),
  CONSTRAINT tax_applies_check CHECK (applies_to IN ('sale','purchase','both')),
  CONSTRAINT tax_rate_range CHECK (rate_bps >= 0 AND rate_bps <= 10000)
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_codes_tenant_code_unique
  ON tax_codes(tenant_id, code)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tax_codes_tenant_idx ON tax_codes(tenant_id);

-- ------------------------------------------------------------------------------
-- fiscal_periods
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fiscal_periods (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fiscal_year   smallint NOT NULL,
  period_no     smallint NOT NULL,       -- 1..12 (monthly) or 1..4 (quarterly)
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'open', -- open | soft_closed | closed
  closed_at     timestamptz,
  closed_by_user_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_period_status_check CHECK (status IN ('open','soft_closed','closed')),
  CONSTRAINT fiscal_period_range CHECK (ends_on >= starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_periods_unique
  ON fiscal_periods(tenant_id, fiscal_year, period_no);
CREATE INDEX IF NOT EXISTS fiscal_periods_date_idx
  ON fiscal_periods(tenant_id, starts_on, ends_on);

-- wire FKs back to items (deferred to avoid ordering issues)
ALTER TABLE items
  ADD CONSTRAINT items_income_account_fk FOREIGN KEY (income_account_id)
    REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT items_expense_account_fk FOREIGN KEY (expense_account_id)
    REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT items_asset_account_fk FOREIGN KEY (asset_account_id)
    REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT items_tax_code_fk FOREIGN KEY (tax_code_id)
    REFERENCES tax_codes(id) ON DELETE SET NULL;
