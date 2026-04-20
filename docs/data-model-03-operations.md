# Data Model — Part 3: Operations

> Operational entities — where the business actually lives. Branches, warehouses, customer and supplier masters, the item catalog, the stock ledger (transactional heartbeat), and the pricing engine. All tenant-scoped via RLS. Extends Parts 1-2. Target: Sri Lanka only. Scope: full system.

---

## 1. Scope

Defines:
- `branches`, `warehouses`, `branch_warehouse_access`
- `customers` + `customer_contacts` + `customer_branch_access`
- `suppliers` + `supplier_contacts` + `supplier_bank_details` + `supplier_branch_access`
- `item_categories`, `items`, `item_names_i18n`, `item_barcodes`, `item_uoms_alternate`, `item_variant_attributes`, `bundle_components`
- `stock_ledger`, `stock_batches`, `stock_serials`, `valuation_lots`
- `price_lists`, `price_list_items`, `volume_breaks`, `promo_prices`, `customer_price_overrides`, `supplier_item_links`

All tables include standard audit columns from Part 1.

---

## 2. Branches & Warehouses

### 2.1 Branches

Physical or virtual business locations.

```sql
branches (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    name                       VARCHAR(200) NOT NULL,
    code                       VARCHAR(20) NOT NULL,  -- "PETTAH","KANDY" — used in number series
    address_json               JSONB,
    phone                      VARCHAR(20),
    email                      VARCHAR(200),

    -- Tax configuration
    tax_branch_reg_no          VARCHAR(50),  -- if separately registered with IRD
    sscl_applicable_override   BOOLEAN,       -- override tenant default

    -- Org structure
    is_head_office             BOOLEAN NOT NULL DEFAULT FALSE,
    parent_branch_id           UUID REFERENCES branches(id),  -- for hierarchical structures

    -- Capabilities
    allowed_tender_methods     JSONB DEFAULT '["cash"]',  -- subset of ["cash","card","cheque","qr","bank_transfer","account_credit","loyalty","mixed","on_account"]
    allowed_payment_gateways   JSONB DEFAULT '[]',         -- ["payhere","frimi","genie","ipay","lankaqr"]
    default_warehouse_id       UUID,

    -- Operating hours
    operating_hours_json       JSONB,  -- { "mon": {"open":"08:00","close":"18:00"}, ... }

    -- Status
    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','inactive','archived'

    tags                       JSONB,
    notes                      TEXT,

    created_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                 TIMESTAMP WITH TIME ZONE,
    created_by                 UUID,
    updated_by                 UUID,
    version                    INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_branches_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_branches_tenant_status ON branches (tenant_id, status);
CREATE INDEX idx_branches_tenant_parent ON branches (tenant_id, parent_branch_id);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branches
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.2 Warehouses

Physical stock-holding locations. May be tied to a branch or shared across branches.

```sql
warehouses (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    name                       VARCHAR(200) NOT NULL,
    code                       VARCHAR(20) NOT NULL,
    type                       VARCHAR(30) NOT NULL DEFAULT 'main',
    -- 'main','godown','retail_backroom','cold_storage','bonded','transit','damaged','other'

    address_json               JSONB,

    -- Valuation
    default_valuation_method   VARCHAR(20) NOT NULL DEFAULT 'wavg',
    -- 'wavg','fifo','specific','standard'

    -- Capabilities
    allowed_operations         JSONB DEFAULT '["receive","dispatch"]',
    -- subset of ["receive","dispatch","transfer","adjustment","production"]

    -- Capacity / physical
    capacity_units             NUMERIC(15,2),
    capacity_uom               VARCHAR(20),

    -- Status
    status                     VARCHAR(20) NOT NULL DEFAULT 'active',

    tags                       JSONB,
    notes                      TEXT,

    created_at, updated_at, deleted_at, created_by, updated_by, version  -- standard audit

    CONSTRAINT uk_warehouses_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_warehouses_tenant_status ON warehouses (tenant_id, status);
CREATE INDEX idx_warehouses_tenant_type ON warehouses (tenant_id, type);

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warehouses
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.3 Branch ↔ Warehouse Access

Matrix mapping with per-cell permissions (the flexible mapping locked in Layer 2).

```sql
branch_warehouse_access (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    branch_id                  UUID NOT NULL REFERENCES branches(id),
    warehouse_id               UUID NOT NULL REFERENCES warehouses(id),

    permissions                JSONB NOT NULL DEFAULT '{"read":true,"write":false,"transfer":false}',
    -- {"read": bool, "write": bool, "transfer": bool}

    is_default                 BOOLEAN NOT NULL DEFAULT FALSE,
    -- one warehouse can be marked default per branch (UI convenience)

    created_at, updated_at, deleted_at, created_by, updated_by, version

    CONSTRAINT uk_branch_warehouse UNIQUE (tenant_id, branch_id, warehouse_id)
);

CREATE INDEX idx_branch_warehouse_branch ON branch_warehouse_access (tenant_id, branch_id);
CREATE INDEX idx_branch_warehouse_warehouse ON branch_warehouse_access (tenant_id, warehouse_id);

ALTER TABLE branch_warehouse_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branch_warehouse_access
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 3. Customers (Party Master — Sales Side)

Separate tables approach (Option A from Round 3). Customer and Supplier share structural similarities but have enough unique fields to warrant separation.

### 3.1 Customers

```sql
customers (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    -- Identity
    code                       VARCHAR(30) NOT NULL,  -- "CUS-00001" — auto-generated or custom
    name                       VARCHAR(200) NOT NULL,
    type                       VARCHAR(30) NOT NULL DEFAULT 'business',
    -- 'individual','business','government','ngo','cash_walkin'

    -- SL-specific identity
    nic                        VARCHAR(20),      -- individuals
    vat_number                 VARCHAR(50),      -- VAT registered businesses
    tin                        VARCHAR(50),      -- Tax Identification Number
    business_reg_number        VARCHAR(50),      -- company registration number

    -- Tax behavior
    tax_exempt                 BOOLEAN DEFAULT FALSE,
    tax_exemption_reason       VARCHAR(200),
    tax_exemption_expiry       DATE,

    -- Contact
    phone                      VARCHAR(20),
    email                      VARCHAR(200),
    website                    VARCHAR(200),
    address_json               JSONB,
    billing_address_json       JSONB,   -- if different from main
    shipping_address_json      JSONB,

    -- Preferences
    language_preference        VARCHAR(5) DEFAULT 'en-LK',
    preferred_delivery_channel VARCHAR(20) DEFAULT 'email',
    -- 'email','print','whatsapp_future','sms_future'

    -- Commercial terms
    default_payment_terms      VARCHAR(30) DEFAULT 'net_30',
    -- 'cod','advance','net_7','net_15','net_30','net_60','net_90','custom'
    custom_payment_terms_days  INTEGER,

    currency                   CHAR(3) DEFAULT 'LKR',  -- for FX sales

    -- Pricing
    price_list_id              UUID,  -- references price_lists(id)

    -- Credit management
    credit_limit_lkr           NUMERIC(15,2) NOT NULL DEFAULT 0,
    credit_period_days         INTEGER NOT NULL DEFAULT 0,
    credit_hold                BOOLEAN NOT NULL DEFAULT FALSE,
    credit_hold_reason         VARCHAR(200),
    credit_hold_set_by         UUID,
    credit_hold_set_at         TIMESTAMP WITH TIME ZONE,
    bounce_count_90_days       INTEGER NOT NULL DEFAULT 0,
    last_bounce_at             TIMESTAMP WITH TIME ZONE,

    -- Relationship
    salesperson_id             UUID,  -- references users(id)
    customer_since             DATE DEFAULT CURRENT_DATE,
    classification             VARCHAR(30),  -- 'vip','regular','new','dormant','at_risk'
    industry                   VARCHAR(100),

    -- Loyalty (lightweight)
    loyalty_enrolled           BOOLEAN DEFAULT FALSE,
    loyalty_points_balance     INTEGER DEFAULT 0,

    -- Status
    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','inactive','written_off','blacklisted'

    tags                       JSONB,
    notes                      TEXT,
    custom_fields_json         JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, deleted_by, version

    CONSTRAINT uk_customers_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_customers_tenant_status ON customers (tenant_id, status);
CREATE INDEX idx_customers_tenant_name ON customers (tenant_id, name);
CREATE INDEX idx_customers_tenant_phone ON customers (tenant_id, phone);
CREATE INDEX idx_customers_tenant_nic ON customers (tenant_id, nic) WHERE nic IS NOT NULL;
CREATE INDEX idx_customers_salesperson ON customers (tenant_id, salesperson_id);
CREATE INDEX idx_customers_credit_hold ON customers (tenant_id, credit_hold) WHERE credit_hold = TRUE;
CREATE INDEX idx_customers_search ON customers USING GIN (name gin_trgm_ops);  -- fuzzy search

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.2 Customer Contacts

```sql
customer_contacts (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    customer_id                UUID NOT NULL REFERENCES customers(id),

    name                       VARCHAR(200) NOT NULL,
    role                       VARCHAR(100),  -- 'owner','accounts','purchasing','delivery','other'
    phone                      VARCHAR(20),
    email                      VARCHAR(200),
    whatsapp_number            VARCHAR(20),
    is_primary                 BOOLEAN NOT NULL DEFAULT FALSE,
    notes                      TEXT,

    created_at, updated_at, deleted_at, created_by, updated_by, version
);

CREATE INDEX idx_customer_contacts_customer ON customer_contacts (tenant_id, customer_id);

ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_contacts
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.3 Customer Branch Access

For multi-branch tenants — which branches a customer deals with. Used for branch-level reporting and cross-branch AR consolidation.

```sql
customer_branch_access (
    tenant_id                  UUID NOT NULL,
    customer_id                UUID NOT NULL,
    branch_id                  UUID NOT NULL,
    since_date                 DATE DEFAULT CURRENT_DATE,
    PRIMARY KEY (tenant_id, customer_id, branch_id)
);

CREATE INDEX idx_cust_branch_access ON customer_branch_access (tenant_id, branch_id);

ALTER TABLE customer_branch_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_branch_access
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.4 Customer Credit Limit History

Per `business-tenant-layer2-spec.md §8.5 (Owner override)` and §8.6 (Reports include "Credit limit change history"). Dedicated log so the common "who changed the limit and why" query doesn't require a join against generic `audit_log` with JSONB field parsing. Complements (doesn't replace) `audit_log` — the generic log still captures the change for compliance.

```sql
customer_credit_limit_history (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    customer_id                 UUID NOT NULL REFERENCES customers(id),

    -- What changed (any subset can be populated in a single row)
    change_type                 VARCHAR(30) NOT NULL,
    -- 'limit_set','limit_raised','limit_lowered','period_changed',
    -- 'hold_set','hold_released','auto_flag_2_bounces','override_approved','reset_on_writeoff'

    -- Before / after snapshot (null = unchanged)
    previous_limit_lkr          NUMERIC(15,2),
    new_limit_lkr               NUMERIC(15,2),
    previous_period_days        INTEGER,
    new_period_days             INTEGER,
    previous_credit_hold        BOOLEAN,
    new_credit_hold             BOOLEAN,

    -- Context
    reason                      TEXT NOT NULL,   -- mandatory — UI enforces
    reason_code                 VARCHAR(40),
    -- 'manual_review','bounce_history','late_payment_pattern','annual_review',
    -- 'customer_request','owner_override','auto_system','writeoff_reset'

    -- Linkage (when change was triggered by another event)
    triggered_by_event          VARCHAR(30),
    -- 'manual','cheque_bounce','payment_default','writeoff','owner_override','invoice_override'
    triggered_by_bounce_event_id UUID,          -- references cheque_bounce_events(id) from Part 5
    triggered_by_writeoff_id    UUID,

    -- Approval (for auto-flagged reviews)
    requires_acknowledgment     BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by             UUID REFERENCES users(id),
    acknowledged_at             TIMESTAMP WITH TIME ZONE,

    -- Who
    changed_by                  UUID NOT NULL REFERENCES users(id),
    changed_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cclh_customer ON customer_credit_limit_history
    (tenant_id, customer_id, changed_at DESC);
CREATE INDEX idx_cclh_changed_by ON customer_credit_limit_history
    (tenant_id, changed_by, changed_at DESC);
CREATE INDEX idx_cclh_pending_ack ON customer_credit_limit_history
    (tenant_id, customer_id)
    WHERE requires_acknowledgment = TRUE AND acknowledged_at IS NULL;
CREATE INDEX idx_cclh_bounce_triggered ON customer_credit_limit_history
    (tenant_id, triggered_by_bounce_event_id)
    WHERE triggered_by_bounce_event_id IS NOT NULL;

ALTER TABLE customer_credit_limit_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_credit_limit_history
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Write contract**: every `UPDATE customers SET credit_limit_lkr | credit_period_days | credit_hold | credit_hold_reason ...` goes through an application-layer service that (a) writes the new values to `customers`, (b) writes a history row in the same DB transaction. Direct SQL updates bypass history — enforced via review, not trigger, since trigger-based capture loses the `reason` field which must come from the user.

**Auto-flag on bounce**: when `cheque_bounce_events` records the 2nd bounce within 90 days for a customer, the orchestrator writes a row with `change_type='auto_flag_2_bounces'`, `requires_acknowledgment=TRUE`, and `triggered_by_bounce_event_id=:event_id`. Owner must acknowledge before the flag clears from dashboards.

---

## 4. Suppliers (Party Master — Purchase Side)

### 4.1 Suppliers

```sql
suppliers (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    -- Identity
    code                       VARCHAR(30) NOT NULL,
    name                       VARCHAR(200) NOT NULL,
    trade_name                 VARCHAR(200),
    type                       VARCHAR(30) NOT NULL DEFAULT 'local',
    -- 'local','foreign','government','individual'

    -- SL-specific tax
    nic                        VARCHAR(20),
    vat_number                 VARCHAR(50),
    tin                        VARCHAR(50),
    business_reg_number        VARCHAR(50),

    -- WHT
    wht_applicable             BOOLEAN NOT NULL DEFAULT FALSE,
    wht_default_category       VARCHAR(100),  -- references tax_rules (Part 4)
    wht_exemption_cert_no      VARCHAR(100),
    wht_exemption_expiry       DATE,

    -- Contact
    phone                      VARCHAR(20),
    email                      VARCHAR(200),
    website                    VARCHAR(200),
    address_json               JSONB,

    -- Commercial terms
    default_payment_terms      VARCHAR(30) DEFAULT 'net_30',
    custom_payment_terms_days  INTEGER,
    default_currency           CHAR(3) NOT NULL DEFAULT 'LKR',
    default_gl_account_id      UUID,  -- references chart_of_accounts(id) for auto-coded bills

    -- Supplier-extends-credit-to-us
    credit_limit_with_us       NUMERIC(15,2) DEFAULT 0,
    credit_period_days         INTEGER DEFAULT 0,

    -- Discount terms
    early_payment_discount_pct NUMERIC(5,2) DEFAULT 0,
    early_payment_discount_days INTEGER DEFAULT 0,

    -- Self-billing arrangement (rare)
    self_billing               BOOLEAN NOT NULL DEFAULT FALSE,

    -- Performance scoring (Phase 2 analytics)
    on_time_delivery_score     NUMERIC(5,2),
    quality_score              NUMERIC(5,2),
    price_competitiveness_score NUMERIC(5,2),
    overall_score              NUMERIC(5,2),

    -- 3-way matching override per supplier
    matching_mode_override     VARCHAR(30),
    -- NULL = use tenant default; else 'strict_3way','2way_po_bill','2way_grn_bill','no_match'

    -- Status
    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','inactive','blacklisted','under_review'

    tags                       JSONB,
    notes                      TEXT,
    custom_fields_json         JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, deleted_by, version

    CONSTRAINT uk_suppliers_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_suppliers_tenant_status ON suppliers (tenant_id, status);
CREATE INDEX idx_suppliers_tenant_name ON suppliers (tenant_id, name);
CREATE INDEX idx_suppliers_tenant_type ON suppliers (tenant_id, type);
CREATE INDEX idx_suppliers_search ON suppliers USING GIN (name gin_trgm_ops);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suppliers
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.2 Supplier Contacts

```sql
supplier_contacts (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    supplier_id                UUID NOT NULL REFERENCES suppliers(id),

    name                       VARCHAR(200) NOT NULL,
    role                       VARCHAR(100),  -- 'sales','accounts','delivery','support'
    phone                      VARCHAR(20),
    email                      VARCHAR(200),
    whatsapp_number            VARCHAR(20),
    is_primary                 BOOLEAN NOT NULL DEFAULT FALSE,
    notes                      TEXT,

    created_at, updated_at, deleted_at, ...
);

CREATE INDEX idx_supplier_contacts_supplier ON supplier_contacts (tenant_id, supplier_id);
ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_contacts
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.3 Supplier Bank Details

```sql
supplier_bank_details (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    supplier_id                UUID NOT NULL REFERENCES suppliers(id),

    bank_name                  VARCHAR(100) NOT NULL,
    branch_name                VARCHAR(100),
    branch_code                VARCHAR(20),
    account_number             VARCHAR(50) NOT NULL,
    account_name               VARCHAR(200) NOT NULL,
    swift_code                 VARCHAR(20),     -- foreign suppliers
    iban                       VARCHAR(50),     -- foreign suppliers
    currency                   CHAR(3) DEFAULT 'LKR',

    is_primary                 BOOLEAN NOT NULL DEFAULT FALSE,
    verified                   BOOLEAN DEFAULT FALSE,
    verified_at                TIMESTAMP WITH TIME ZONE,
    verified_by                UUID,

    created_at, updated_at, deleted_at, ...
);

CREATE INDEX idx_supplier_bank_supplier ON supplier_bank_details (tenant_id, supplier_id);
ALTER TABLE supplier_bank_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_bank_details
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.4 Supplier Branch Access

```sql
supplier_branch_access (
    tenant_id                  UUID NOT NULL,
    supplier_id                UUID NOT NULL,
    branch_id                  UUID NOT NULL,
    since_date                 DATE DEFAULT CURRENT_DATE,
    PRIMARY KEY (tenant_id, supplier_id, branch_id)
);

CREATE INDEX idx_supp_branch_access ON supplier_branch_access (tenant_id, branch_id);
ALTER TABLE supplier_branch_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_branch_access
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 5. Items (Inventory Master)

### 5.1 Item Categories

Unlimited-depth hierarchical structure.

```sql
item_categories (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    name                       VARCHAR(200) NOT NULL,
    parent_category_id         UUID REFERENCES item_categories(id),
    depth_level                SMALLINT NOT NULL DEFAULT 0,
    path                       VARCHAR(1000),  -- materialized path "Food/Beverages/Soft Drinks"

    code_prefix                VARCHAR(10),  -- auto-SKU prefix for items in this category

    -- Valuation default (items inherit unless overridden)
    default_valuation_method   VARCHAR(20) NOT NULL DEFAULT 'wavg',
    default_tax_code_id        UUID,

    -- Classification
    abc_xyz_eligible           BOOLEAN DEFAULT TRUE,

    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
    notes                      TEXT,

    created_at, updated_at, deleted_at, created_by, updated_by, version
);

CREATE INDEX idx_item_categories_tenant ON item_categories (tenant_id, parent_category_id);
CREATE INDEX idx_item_categories_path ON item_categories (tenant_id, path);

ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_categories
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.2 Items

```sql
items (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    -- Identity
    code                       VARCHAR(50) NOT NULL,
    type                       VARCHAR(20) NOT NULL DEFAULT 'stock',
    -- 'stock','service','bundle','non_inventory','custom'
    custom_type_id             UUID,  -- for tenant-defined custom types

    name                       VARCHAR(500) NOT NULL,
    description                TEXT,
    category_id                UUID REFERENCES item_categories(id),
    brand                      VARCHAR(100),
    manufacturer               VARCHAR(200),

    -- Classifications
    hs_code                    VARCHAR(20),  -- customs code for imports
    industry_category          VARCHAR(100),

    -- UoM
    primary_uom                VARCHAR(20) NOT NULL,

    -- Pricing defaults
    default_tax_code_id        UUID,
    default_purchase_price     NUMERIC(15,4),
    default_selling_price      NUMERIC(15,4),
    reference_cost             NUMERIC(15,4),  -- tenant's expected cost for variance flags
    mrp                        NUMERIC(15,4),  -- maximum retail price (if printed on pack)

    -- Margin floor (if set, warns when selling below)
    min_margin_pct             NUMERIC(5,2),

    -- Tracking configuration (independently toggleable per item)
    is_batch_tracked           BOOLEAN NOT NULL DEFAULT FALSE,
    is_serial_tracked          BOOLEAN NOT NULL DEFAULT FALSE,
    is_expiry_tracked          BOOLEAN NOT NULL DEFAULT FALSE,
    shelf_life_days            INTEGER,  -- for expiry computation if expiry_tracked

    -- Variant structure
    is_variant_parent          BOOLEAN NOT NULL DEFAULT FALSE,
    parent_item_id             UUID REFERENCES items(id),  -- for variant children

    -- Reorder
    reorder_point              NUMERIC(15,4),
    reorder_quantity           NUMERIC(15,4),

    -- Classifications (computed monthly)
    abc_class                  CHAR(1),   -- A/B/C
    xyz_class                  CHAR(1),   -- X/Y/Z
    classification_updated_at  TIMESTAMP WITH TIME ZONE,

    -- Supplier preference (denormalized for query speed)
    preferred_supplier_id      UUID,

    -- Physical attributes
    weight                     NUMERIC(10,4),
    weight_uom                 VARCHAR(10),
    length                     NUMERIC(10,4),
    width                      NUMERIC(10,4),
    height                     NUMERIC(10,4),
    volume_uom                 VARCHAR(10),

    -- Status
    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','inactive','discontinued'

    tags                       JSONB,
    custom_fields_json         JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, version

    CONSTRAINT uk_items_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_items_tenant_status ON items (tenant_id, status);
CREATE INDEX idx_items_tenant_category ON items (tenant_id, category_id);
CREATE INDEX idx_items_tenant_type ON items (tenant_id, type);
CREATE INDEX idx_items_tenant_parent ON items (tenant_id, parent_item_id) WHERE parent_item_id IS NOT NULL;
CREATE INDEX idx_items_tenant_supplier ON items (tenant_id, preferred_supplier_id) WHERE preferred_supplier_id IS NOT NULL;
CREATE INDEX idx_items_search ON items USING GIN (name gin_trgm_ops);

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON items
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.3 Item Names — Multi-Language

```sql
item_names_i18n (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    item_id                    UUID NOT NULL REFERENCES items(id),
    language                   VARCHAR(5) NOT NULL,  -- 'en-LK','ta-LK','si-LK'
    name                       VARCHAR(500) NOT NULL,
    description                TEXT,

    created_at, updated_at

    CONSTRAINT uk_item_names_item_lang UNIQUE (item_id, language)
);

CREATE INDEX idx_item_names_tenant_item ON item_names_i18n (tenant_id, item_id);
CREATE INDEX idx_item_names_search ON item_names_i18n USING GIN (name gin_trgm_ops);

ALTER TABLE item_names_i18n ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_names_i18n
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.4 Item Barcodes

Multi-barcode per item (original GTIN + internal + promo).

```sql
item_barcodes (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    item_id                    UUID NOT NULL REFERENCES items(id),

    barcode                    VARCHAR(50) NOT NULL,
    type                       VARCHAR(30) NOT NULL DEFAULT 'supplier_gtin',
    -- 'supplier_gtin','internal','promo','secondary_pack','variant'

    label                      VARCHAR(100),  -- e.g. "Box of 10", "Promo tag"
    uom                        VARCHAR(20),   -- barcode for specific UoM

    is_primary                 BOOLEAN DEFAULT FALSE,

    created_at, updated_at

    CONSTRAINT uk_item_barcodes_tenant_barcode UNIQUE (tenant_id, barcode)
);

CREATE INDEX idx_item_barcodes_tenant_item ON item_barcodes (tenant_id, item_id);

ALTER TABLE item_barcodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_barcodes
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.5 Alternate UoMs

```sql
item_uoms_alternate (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    item_id                    UUID NOT NULL REFERENCES items(id),

    uom                        VARCHAR(20) NOT NULL,
    conversion_factor          NUMERIC(15,6) NOT NULL,  -- 1 box = 100 tablets → 100
    conversion_direction       VARCHAR(10) NOT NULL DEFAULT 'from_primary',
    -- 'from_primary' → (primary_uom × factor = this_uom)
    -- 'to_primary'   → (this_uom × factor = primary_uom)

    is_purchase_uom            BOOLEAN DEFAULT FALSE,
    is_sales_uom               BOOLEAN DEFAULT FALSE,
    is_stock_uom               BOOLEAN DEFAULT FALSE,

    created_at, updated_at

    CONSTRAINT uk_item_uoms_item_uom UNIQUE (item_id, uom)
);

ALTER TABLE item_uoms_alternate ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_uoms_alternate
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.6 Item Variants (Parent-Child Structure)

```sql
item_variant_attributes (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    parent_item_id             UUID NOT NULL REFERENCES items(id),

    attribute_name             VARCHAR(50) NOT NULL,  -- "Size", "Color", "Material"
    attribute_values           JSONB NOT NULL,        -- ["S","M","L"] or [{"code":"S","label":"Small"}]
    display_order              SMALLINT DEFAULT 0,

    created_at, updated_at

    CONSTRAINT uk_item_variant_attr UNIQUE (parent_item_id, attribute_name)
);

CREATE INDEX idx_item_variant_attr_parent ON item_variant_attributes (tenant_id, parent_item_id);

item_variant_values (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    variant_item_id            UUID NOT NULL REFERENCES items(id),  -- the child SKU
    attribute_name             VARCHAR(50) NOT NULL,
    attribute_value            VARCHAR(100) NOT NULL,

    CONSTRAINT uk_item_variant_val UNIQUE (variant_item_id, attribute_name)
);

CREATE INDEX idx_item_variant_val_item ON item_variant_values (tenant_id, variant_item_id);

ALTER TABLE item_variant_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_variant_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_variant_attributes
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON item_variant_values
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.7 Bundle Components

For items where `type = 'bundle'`.

```sql
bundle_components (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    bundle_item_id             UUID NOT NULL REFERENCES items(id),  -- the bundle SKU
    component_item_id          UUID NOT NULL REFERENCES items(id),  -- a component
    quantity                   NUMERIC(15,4) NOT NULL,
    uom                        VARCHAR(20) NOT NULL,
    is_optional                BOOLEAN DEFAULT FALSE,  -- for configurable bundles

    sort_order                 SMALLINT DEFAULT 0,
    notes                      TEXT,

    created_at, updated_at

    CONSTRAINT uk_bundle_components UNIQUE (bundle_item_id, component_item_id)
);

CREATE INDEX idx_bundle_comp_bundle ON bundle_components (tenant_id, bundle_item_id);
CREATE INDEX idx_bundle_comp_component ON bundle_components (tenant_id, component_item_id);

ALTER TABLE bundle_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bundle_components
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 6. Stock Ledger (Transactional Heartbeat)

### 6.1 Stock Ledger

The most-written-to table in the system. Every stock movement posts here. **Immutable**: no UPDATE, no DELETE. Corrections post new rows.

```sql
stock_ledger (
    id                         UUID NOT NULL,  -- UUID v7 (time-ordered)
    tenant_id                  UUID NOT NULL,

    item_id                    UUID NOT NULL REFERENCES items(id),
    warehouse_id               UUID NOT NULL REFERENCES warehouses(id),

    -- Movement
    movement_type              VARCHAR(40) NOT NULL,
    -- 'purchase_grn','sales_invoice','sales_return','purchase_return',
    -- 'adjustment_positive','adjustment_negative',
    -- 'transfer_out','transfer_in','opening_balance',
    -- 'bundle_make','bundle_consume',
    -- 'internal_consumption','stock_count_variance',
    -- 'write_off','damage_write_off','expiry_write_off'

    quantity                   NUMERIC(15,4) NOT NULL,  -- positive for in, negative for out
    uom                        VARCHAR(20) NOT NULL,
    quantity_primary_uom       NUMERIC(15,4) NOT NULL,  -- converted to primary_uom for consistency

    unit_cost                  NUMERIC(15,4) NOT NULL,   -- at this movement
    total_cost                 NUMERIC(15,2) NOT NULL,

    -- Running snapshot (denormalized for performance)
    running_quantity           NUMERIC(15,4) NOT NULL,  -- primary_uom
    running_value              NUMERIC(15,2) NOT NULL,
    running_avg_cost           NUMERIC(15,4) NOT NULL,  -- for WAVG method

    -- Tracking (nullable based on item config)
    batch_id                   UUID REFERENCES stock_batches(id),
    serial_id                  UUID REFERENCES stock_serials(id),
    expiry_date                DATE,
    valuation_lot_id           UUID,  -- references valuation_lots(id)

    -- Source references
    source_document_type       VARCHAR(50),
    -- 'invoice','bill','grn','credit_note','debit_note','transfer','adjustment',
    -- 'stock_count','opening_balance','bundle_assembly','production','write_off'
    source_document_id         UUID,
    source_line_id             UUID,

    -- Context
    narration                  TEXT,
    reason_code                VARCHAR(50),  -- for adjustments; 'damaged','expired','counting_error','theft','other'
    reason_description         TEXT,

    -- People
    performed_by               UUID NOT NULL,  -- references users(id)
    approved_by                UUID,           -- for adjustments requiring approval

    -- Branch context (for reporting)
    branch_id                  UUID,

    -- Timestamps
    occurred_at                TIMESTAMP WITH TIME ZONE NOT NULL,  -- business time
    created_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),  -- DB insertion time

    -- Reversal / correction link
    reverses_ledger_id         UUID,  -- if this entry reverses an earlier one

    PRIMARY KEY (id, occurred_at)  -- composite PK required for partitioning
);

-- Partitioning: by tenant_id HASH + occurred_at RANGE monthly
-- See Part 8 for details

CREATE INDEX idx_stock_ledger_item_wh_time ON stock_ledger (tenant_id, item_id, warehouse_id, occurred_at DESC);
CREATE INDEX idx_stock_ledger_source ON stock_ledger (tenant_id, source_document_type, source_document_id);
CREATE INDEX idx_stock_ledger_batch ON stock_ledger (tenant_id, batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX idx_stock_ledger_serial ON stock_ledger (tenant_id, serial_id) WHERE serial_id IS NOT NULL;
CREATE INDEX idx_stock_ledger_expiry ON stock_ledger (tenant_id, expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX idx_stock_ledger_branch ON stock_ledger (tenant_id, branch_id, occurred_at DESC) WHERE branch_id IS NOT NULL;

ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_ledger
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Enforce immutability via trigger
CREATE OR REPLACE FUNCTION prevent_stock_ledger_update_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'stock_ledger is immutable; post reversal entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_ledger_immutable
    BEFORE UPDATE OR DELETE ON stock_ledger
    FOR EACH ROW EXECUTE FUNCTION prevent_stock_ledger_update_delete();
```

### 6.2 Stock Batches

```sql
stock_batches (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    item_id                    UUID NOT NULL REFERENCES items(id),
    warehouse_id               UUID NOT NULL REFERENCES warehouses(id),

    batch_number               VARCHAR(100) NOT NULL,
    manufacture_date           DATE,
    expiry_date                DATE,
    received_from_supplier_id  UUID REFERENCES suppliers(id),
    received_grn_id            UUID,  -- references goods_received_notes(id)
    received_date              DATE,

    original_quantity          NUMERIC(15,4) NOT NULL,
    current_quantity           NUMERIC(15,4) NOT NULL,  -- updated via stock_ledger transactions
    unit_cost                  NUMERIC(15,4) NOT NULL,

    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','consumed','expired','recalled','quarantined'

    notes                      TEXT,

    created_at, updated_at, deleted_at, ...

    CONSTRAINT uk_stock_batches UNIQUE (tenant_id, item_id, warehouse_id, batch_number)
);

CREATE INDEX idx_stock_batches_item_expiry ON stock_batches (tenant_id, item_id, expiry_date) WHERE status = 'active';
CREATE INDEX idx_stock_batches_warehouse ON stock_batches (tenant_id, warehouse_id);
CREATE INDEX idx_stock_batches_expiry ON stock_batches (tenant_id, expiry_date) WHERE status = 'active';

ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_batches
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 6.3 Stock Serials

```sql
stock_serials (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    item_id                    UUID NOT NULL REFERENCES items(id),

    serial_number              VARCHAR(100) NOT NULL,
    current_warehouse_id       UUID REFERENCES warehouses(id),

    status                     VARCHAR(20) NOT NULL DEFAULT 'in_stock',
    -- 'in_stock','sold','returned','damaged','written_off','reserved','in_transit'

    -- Acquisition
    received_from_supplier_id  UUID REFERENCES suppliers(id),
    received_grn_id            UUID,
    received_date              DATE,
    received_unit_cost         NUMERIC(15,4),

    -- Disposition
    sold_to_customer_id        UUID REFERENCES customers(id),
    sold_invoice_id            UUID,
    sold_date                  DATE,
    sold_price                 NUMERIC(15,2),

    -- Warranty
    warranty_start_date        DATE,
    warranty_end_date          DATE,
    warranty_terms             TEXT,

    notes                      TEXT,

    created_at, updated_at, deleted_at, ...

    CONSTRAINT uk_stock_serials UNIQUE (tenant_id, item_id, serial_number)
);

CREATE INDEX idx_stock_serials_warehouse_status ON stock_serials (tenant_id, current_warehouse_id, status);
CREATE INDEX idx_stock_serials_customer ON stock_serials (tenant_id, sold_to_customer_id) WHERE sold_to_customer_id IS NOT NULL;

ALTER TABLE stock_serials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_serials
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 6.4 Valuation Lots (FIFO / Specific Identification)

```sql
valuation_lots (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    item_id                    UUID NOT NULL REFERENCES items(id),
    warehouse_id               UUID NOT NULL REFERENCES warehouses(id),

    acquisition_date           DATE NOT NULL,
    acquisition_source_type    VARCHAR(30),  -- 'grn','opening_balance','transfer','adjustment'
    acquisition_source_id      UUID,

    original_quantity          NUMERIC(15,4) NOT NULL,
    remaining_quantity         NUMERIC(15,4) NOT NULL,
    unit_cost                  NUMERIC(15,4) NOT NULL,

    -- FIFO ordering uses acquisition_date + id as tiebreaker
    fully_consumed_at          TIMESTAMP WITH TIME ZONE,

    created_at, updated_at
);

-- FIFO query pattern: ORDER BY acquisition_date, id
CREATE INDEX idx_valuation_lots_fifo ON valuation_lots (tenant_id, item_id, warehouse_id, acquisition_date, id)
    WHERE remaining_quantity > 0;

ALTER TABLE valuation_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON valuation_lots
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 6.5 Current Stock Balance (Materialized View)

Refreshed periodically for fast stock lookups. Pattern:

```sql
CREATE MATERIALIZED VIEW stock_balance_current AS
SELECT
    tenant_id,
    item_id,
    warehouse_id,
    -- Aggregate from latest ledger entry
    (SELECT running_quantity FROM stock_ledger
     WHERE tenant_id = sl.tenant_id AND item_id = sl.item_id AND warehouse_id = sl.warehouse_id
     ORDER BY occurred_at DESC, id DESC LIMIT 1) AS quantity_on_hand,
    (SELECT running_value FROM stock_ledger
     WHERE tenant_id = sl.tenant_id AND item_id = sl.item_id AND warehouse_id = sl.warehouse_id
     ORDER BY occurred_at DESC, id DESC LIMIT 1) AS value_on_hand,
    (SELECT running_avg_cost FROM stock_ledger
     WHERE tenant_id = sl.tenant_id AND item_id = sl.item_id AND warehouse_id = sl.warehouse_id
     ORDER BY occurred_at DESC, id DESC LIMIT 1) AS avg_cost,
    NOW() AS computed_at
FROM (SELECT DISTINCT tenant_id, item_id, warehouse_id FROM stock_ledger) sl;

CREATE UNIQUE INDEX ON stock_balance_current (tenant_id, item_id, warehouse_id);
CREATE INDEX ON stock_balance_current (tenant_id, quantity_on_hand) WHERE quantity_on_hand < 0;  -- negative stock alerts
```

Refresh strategy: incremental via trigger on stock_ledger insert (updates specific row); full refresh nightly (consistency check).

---

## 7. Pricing Entities

### 7.1 Price Lists

```sql
price_lists (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    name                       VARCHAR(100) NOT NULL,  -- 'Retail','Wholesale','Dealer','VIP'
    description                TEXT,
    currency                   CHAR(3) NOT NULL DEFAULT 'LKR',

    is_default                 BOOLEAN NOT NULL DEFAULT FALSE,
    applies_to                 VARCHAR(20) NOT NULL DEFAULT 'sales',
    -- 'sales','purchases','both'

    valid_from                 DATE,
    valid_until                DATE,

    status                     VARCHAR(20) NOT NULL DEFAULT 'active',

    created_at, updated_at, deleted_at, ...

    CONSTRAINT uk_price_lists_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX idx_price_lists_tenant_default ON price_lists (tenant_id, is_default) WHERE is_default = TRUE;

ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON price_lists
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 7.2 Price List Items

Effective-dated pricing.

```sql
price_list_items (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    price_list_id              UUID NOT NULL REFERENCES price_lists(id),
    item_id                    UUID NOT NULL REFERENCES items(id),

    uom                        VARCHAR(20) NOT NULL,
    unit_price                 NUMERIC(15,4) NOT NULL,
    tax_inclusive              BOOLEAN NOT NULL DEFAULT FALSE,

    effective_from             DATE NOT NULL,
    effective_until            DATE,

    created_at, updated_at, created_by

    CONSTRAINT uk_price_list_items UNIQUE (tenant_id, price_list_id, item_id, uom, effective_from)
);

CREATE INDEX idx_price_list_items_lookup ON price_list_items (tenant_id, price_list_id, item_id, effective_from DESC);

ALTER TABLE price_list_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON price_list_items
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 7.3 Volume Breaks

Qty-based tier pricing.

```sql
volume_breaks (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    price_list_id              UUID NOT NULL REFERENCES price_lists(id),
    item_id                    UUID NOT NULL REFERENCES items(id),

    min_quantity               NUMERIC(15,4) NOT NULL,
    max_quantity               NUMERIC(15,4),  -- NULL = unlimited
    unit_price                 NUMERIC(15,4) NOT NULL,
    discount_pct               NUMERIC(5,2),

    effective_from             DATE NOT NULL,
    effective_until            DATE,

    created_at, updated_at
);

CREATE INDEX idx_volume_breaks_lookup ON volume_breaks (tenant_id, price_list_id, item_id, min_quantity);

ALTER TABLE volume_breaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON volume_breaks
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 7.4 Promo Prices

Time-bound promotional pricing.

```sql
promo_prices (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    name                       VARCHAR(200) NOT NULL,  -- 'Avurudu 2026 Promo'
    description                TEXT,

    -- Scope (one or more of these)
    item_id                    UUID REFERENCES items(id),     -- specific item
    category_id                UUID REFERENCES item_categories(id),  -- whole category

    -- Discount mechanic
    discount_type              VARCHAR(20) NOT NULL,
    -- 'percentage','fixed_amount','new_price','buy_x_get_y'
    discount_value             NUMERIC(15,4),
    new_price                  NUMERIC(15,4),
    buy_quantity               NUMERIC(15,4),
    get_quantity               NUMERIC(15,4),

    -- Time bounds
    valid_from                 TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_until                TIMESTAMP WITH TIME ZONE NOT NULL,

    -- Customer eligibility
    applicable_customers       JSONB DEFAULT '"all"',  -- "all" OR ["customer_id1", ...]
    applicable_price_lists     JSONB DEFAULT '"all"',
    applicable_branches        JSONB DEFAULT '"all"',

    -- Usage limits
    max_uses_total             INTEGER,
    max_uses_per_customer      INTEGER,
    uses_count                 INTEGER DEFAULT 0,

    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'draft','scheduled','active','ended','cancelled'

    created_at, updated_at, created_by, ...

    CONSTRAINT chk_promo_scope CHECK (item_id IS NOT NULL OR category_id IS NOT NULL)
);

CREATE INDEX idx_promo_prices_active ON promo_prices (tenant_id, status, valid_from, valid_until);
CREATE INDEX idx_promo_prices_item ON promo_prices (tenant_id, item_id) WHERE item_id IS NOT NULL;
CREATE INDEX idx_promo_prices_category ON promo_prices (tenant_id, category_id) WHERE category_id IS NOT NULL;

ALTER TABLE promo_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON promo_prices
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 7.5 Customer-Specific Price Overrides

Highest priority in resolution chain.

```sql
customer_price_overrides (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    customer_id                UUID NOT NULL REFERENCES customers(id),
    item_id                    UUID NOT NULL REFERENCES items(id),

    uom                        VARCHAR(20),
    unit_price                 NUMERIC(15,4) NOT NULL,

    effective_from             DATE NOT NULL,
    effective_until            DATE,

    reason                     VARCHAR(200),
    approved_by                UUID,  -- references users(id)

    created_at, updated_at, deleted_at, ...

    CONSTRAINT uk_cust_price_override UNIQUE (tenant_id, customer_id, item_id, uom, effective_from)
);

CREATE INDEX idx_cust_price_lookup ON customer_price_overrides (tenant_id, customer_id, item_id, effective_from DESC);

ALTER TABLE customer_price_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_price_overrides
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 7.6 Supplier-Item Links

Supplier-side pricing + sourcing preferences.

```sql
supplier_item_links (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    supplier_id                UUID NOT NULL REFERENCES suppliers(id),
    item_id                    UUID NOT NULL REFERENCES items(id),

    supplier_part_number       VARCHAR(100),  -- supplier's own SKU code
    supplier_description       TEXT,

    last_purchase_price        NUMERIC(15,4),
    last_purchase_date         DATE,
    last_purchase_uom          VARCHAR(20),
    currency                   CHAR(3) DEFAULT 'LKR',

    lead_time_days             INTEGER,
    moq                        NUMERIC(15,4),  -- minimum order quantity
    moq_uom                    VARCHAR(20),

    is_preferred               BOOLEAN NOT NULL DEFAULT FALSE,

    -- Volume breaks from supplier (simpler inline structure)
    volume_breaks_json         JSONB,  -- [{"min_qty":10, "price":900}, {"min_qty":100, "price":850}]

    notes                      TEXT,

    created_at, updated_at, deleted_at, ...

    CONSTRAINT uk_supplier_item UNIQUE (tenant_id, supplier_id, item_id)
);

CREATE INDEX idx_supp_item_supplier ON supplier_item_links (tenant_id, supplier_id);
CREATE INDEX idx_supp_item_item ON supplier_item_links (tenant_id, item_id);
CREATE INDEX idx_supp_item_preferred ON supplier_item_links (tenant_id, item_id, is_preferred) WHERE is_preferred = TRUE;

ALTER TABLE supplier_item_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_item_links
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 8. Customer Advances & Loyalty Balances (Quick-Access Tables)

### 8.1 Customer Advances

Tracks customer prepayments (advance payments sitting against future invoices).

```sql
customer_advances (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    customer_id                UUID NOT NULL REFERENCES customers(id),

    original_amount_lkr        NUMERIC(15,2) NOT NULL,
    remaining_amount_lkr       NUMERIC(15,2) NOT NULL,
    currency                   CHAR(3) DEFAULT 'LKR',

    received_date              DATE NOT NULL,
    received_via               VARCHAR(30),  -- 'cash','cheque','bank_transfer','qr','card'
    receipt_id                 UUID,  -- references receipts (Part 5)
    journal_entry_id           UUID,  -- references journal_entries (Part 4)

    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','fully_applied','refunded','written_off'

    notes                      TEXT,

    created_at, updated_at, ...
);

CREATE INDEX idx_customer_advances_active ON customer_advances (tenant_id, customer_id, status) WHERE status = 'active';

ALTER TABLE customer_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_advances
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 8.2 Supplier Advances

Symmetric — our prepayments to suppliers.

```sql
supplier_advances (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    supplier_id                UUID NOT NULL REFERENCES suppliers(id),

    original_amount_lkr        NUMERIC(15,2) NOT NULL,
    remaining_amount_lkr       NUMERIC(15,2) NOT NULL,
    currency                   CHAR(3) DEFAULT 'LKR',
    fx_rate                    NUMERIC(15,6),

    paid_date                  DATE NOT NULL,
    paid_via                   VARCHAR(30),
    payment_id                 UUID,  -- references payments (Part 5)
    journal_entry_id           UUID,

    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','fully_applied','refunded','written_off'

    notes                      TEXT,

    created_at, updated_at, ...
);

CREATE INDEX idx_supplier_advances_active ON supplier_advances (tenant_id, supplier_id, status) WHERE status = 'active';

ALTER TABLE supplier_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_advances
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 9. Next Parts

- **Part 4 — Accounting**: COA, journals, tax codes, periods, FX
- **Part 5 — Transactions**: invoices, bills, receipts, payments, GRNs, cheques, POS
- **Part 6 — Payroll & HR**: employees, salary structures, payroll runs, leave, loans, bonuses
- **Part 7 — System**: audit log, document storage, notifications, workflows, number series, integrations, plans
- **Part 8 — Performance & ERDs**: indexes, partitioning, materialized views, Mermaid diagrams, RLS examples

---

*Document version: 1.0 · Part 3/8 · Operations · Scope: Sri Lanka only · Full system (not MVP)*

*Decisions locked in Round 3: flexible branch ↔ warehouse matrix with per-cell permissions; separate customers and suppliers tables (Option A) with comprehensive SL-specific fields (VAT, TIN, NIC, WHT); customer_credit_limit_history as dedicated change log (limit / period / hold changes with reason codes, bounce-triggered linkage, owner-acknowledgment workflow for auto-flags) complementing generic audit_log; unlimited-depth item category hierarchy; items with parent-child variants, multi-language names, multi-barcode, alternate UoMs; stock ledger as immutable transactional heartbeat with UUID v7 and trigger-enforced immutability; stock batches, serials, valuation lots for full tracking modes; full pricing engine (price lists, price list items, volume breaks, promo prices, customer overrides, supplier-item links); customer and supplier advance tables for prepayment tracking.*
