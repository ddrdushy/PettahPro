# Data Model — Part 5: Transactions

> Where the business actually transacts. Sell-side documents (quotations, sales orders, delivery notes, invoices, credit notes, receipts, POS), buy-side documents (purchase requisitions, purchase orders, goods received notes, bills, debit notes, payments), the 3-way matching engine, cheque management with full 9-state lifecycle, petty cash floats + vouchers + transaction ledger, approval workflow linkages, document numbering, and inter-document linkage. Extends Parts 1-4. Target: Sri Lanka only. Scope: full system.

---

## 1. Scope

Defines the operational transaction layer. Every entity here:
- Tenant-scoped via RLS
- Has full audit columns (Part 1)
- Posts to GL via `journal_entries` (Part 4) when posted
- Triggers stock movements via `stock_ledger` (Part 3) when applicable
- May be wrapped in approval workflows (defined in this part)
- Uses tenant-configured number series for human-readable IDs

**Entity groups**:
- Sell documents: quotations, sales_orders, delivery_notes, invoices, recurring_invoice_templates, proforma_invoices, credit_notes, receipts + allocations
- POS: pos_terminals, pos_shifts, pos_parked_sales, pos_z_reports
- Buy documents: purchase_requisitions, purchase_orders, goods_received_notes, bills, debit_notes + settlements, payments + allocations, recurring_purchase_templates
- 3-way matching: three_way_match_results
- Cheques: cheques, cheque_bounce_events, cheque_books
- Petty cash: petty_cash_floats, petty_cash_vouchers, petty_cash_transactions
- Cross-cutting: approval_instances, approval_steps, number_series, document_links

---

## 2. Sell-Side Documents

### 2.1 Quotations

```sql
quotations (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    quotation_number            VARCHAR(50) NOT NULL,
    version                     SMALLINT NOT NULL DEFAULT 1,
    parent_quotation_id         UUID REFERENCES quotations(id),  -- for revisions

    customer_id                 UUID NOT NULL,
    customer_contact_id         UUID,
    salesperson_id              UUID,
    branch_id                   UUID NOT NULL,

    -- Dates
    quotation_date              DATE NOT NULL,
    valid_until_date            DATE NOT NULL,
    sent_at                     TIMESTAMP WITH TIME ZONE,
    viewed_at                   TIMESTAMP WITH TIME ZONE,  -- customer portal tracking
    accepted_at                 TIMESTAMP WITH TIME ZONE,
    rejected_at                 TIMESTAMP WITH TIME ZONE,
    converted_at                TIMESTAMP WITH TIME ZONE,  -- when converted to SO/invoice

    -- Currency
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate               NUMERIC(15,6) NOT NULL DEFAULT 1,

    -- Pricing context
    price_list_id               UUID,

    -- Amounts (computed from lines)
    subtotal_lkr                NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_total_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,

    subtotal_original           NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_total_original     NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_original          NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_original        NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Terms
    payment_terms               VARCHAR(50),
    delivery_terms              TEXT,
    warranty_terms              TEXT,
    notes                       TEXT,
    internal_notes              TEXT,  -- not shown to customer

    -- Conversion tracking
    converted_to_so_id          UUID,  -- references sales_orders(id)
    converted_to_invoice_id     UUID,  -- direct-to-invoice (skipping SO)
    rejection_reason            TEXT,

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','sent','viewed','accepted','rejected','expired','converted','revised'

    -- Approval
    approval_required           BOOLEAN NOT NULL DEFAULT FALSE,
    approval_instance_id        UUID,

    -- Document chain
    document_chain_json         JSONB,

    -- Attachments
    attachment_count            SMALLINT DEFAULT 0,

    tags                        JSONB,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    deleted_by                  UUID,
    version_row                 INTEGER NOT NULL DEFAULT 1,  -- optimistic concurrency

    CONSTRAINT uk_quotations_tenant_number_version UNIQUE (tenant_id, quotation_number, version)
);

CREATE INDEX idx_quotations_tenant_customer ON quotations (tenant_id, customer_id, quotation_date DESC);
CREATE INDEX idx_quotations_tenant_status ON quotations (tenant_id, status, quotation_date DESC);
CREATE INDEX idx_quotations_tenant_salesperson ON quotations (tenant_id, salesperson_id, quotation_date DESC);
CREATE INDEX idx_quotations_expiring ON quotations (tenant_id, valid_until_date) WHERE status IN ('sent','viewed');

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotations FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.2 Quotation Lines

```sql
quotation_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    quotation_id                UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,

    line_number                 SMALLINT NOT NULL,

    -- Item
    item_id                     UUID,  -- nullable for free-text lines
    item_code                   VARCHAR(50),  -- denormalized
    item_name                   VARCHAR(500),  -- denormalized (at quote time)
    description                 TEXT,

    -- Quantity + pricing
    quantity                    NUMERIC(15,4) NOT NULL,
    uom                         VARCHAR(20) NOT NULL,
    unit_price                  NUMERIC(15,4) NOT NULL,
    line_subtotal               NUMERIC(15,2) NOT NULL,

    -- Discount
    discount_type               VARCHAR(20),  -- 'percentage','fixed'
    discount_value              NUMERIC(15,4),
    discount_amount             NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_approved_by        UUID,

    -- Tax
    tax_code_id                 UUID,
    tax_rate                    NUMERIC(7,4),
    tax_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_inclusive               BOOLEAN NOT NULL DEFAULT FALSE,

    -- Line total
    line_total                  NUMERIC(15,2) NOT NULL,

    -- Contextual
    warehouse_id                UUID,
    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quotation_lines_quotation ON quotation_lines (tenant_id, quotation_id, line_number);
CREATE INDEX idx_quotation_lines_item ON quotation_lines (tenant_id, item_id) WHERE item_id IS NOT NULL;

ALTER TABLE quotation_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotation_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.3 Sales Orders

```sql
sales_orders (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    so_number                   VARCHAR(50) NOT NULL,

    customer_id                 UUID NOT NULL,
    customer_contact_id         UUID,
    salesperson_id              UUID,
    branch_id                   UUID NOT NULL,

    -- Source
    source_quotation_id         UUID REFERENCES quotations(id),

    -- Dates
    so_date                     DATE NOT NULL,
    expected_delivery_date      DATE,
    promised_delivery_date      DATE,
    committed_at                TIMESTAMP WITH TIME ZONE,

    -- Delivery
    shipping_address_json       JSONB,
    delivery_instructions       TEXT,
    delivery_terms              TEXT,

    -- Currency
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate               NUMERIC(15,6) NOT NULL DEFAULT 1,

    price_list_id               UUID,

    -- Amounts
    subtotal_lkr                NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_total_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,

    subtotal_original           NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_original          NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_original        NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Fulfilment tracking
    fulfilment_pct              NUMERIC(5,2) NOT NULL DEFAULT 0,
    quantity_total              NUMERIC(15,4) NOT NULL DEFAULT 0,
    quantity_fulfilled          NUMERIC(15,4) NOT NULL DEFAULT 0,
    quantity_invoiced           NUMERIC(15,4) NOT NULL DEFAULT 0,
    quantity_backorder          NUMERIC(15,4) NOT NULL DEFAULT 0,

    -- Reservation
    stock_reserved              BOOLEAN NOT NULL DEFAULT FALSE,
    reservation_expires_at      TIMESTAMP WITH TIME ZONE,

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','pending_approval','approved','partially_fulfilled','fulfilled','cancelled','on_hold'

    on_hold_reason              VARCHAR(100),
    -- 'credit_hold','customer_request','stock_unavailable','price_review','manual','other'
    on_hold_details             TEXT,

    -- Approval
    approval_required           BOOLEAN NOT NULL DEFAULT FALSE,
    approval_instance_id        UUID,

    -- Customer-facing
    customer_po_number          VARCHAR(100),  -- customer's reference
    payment_terms               VARCHAR(50),

    -- Cancellation
    cancelled_at                TIMESTAMP WITH TIME ZONE,
    cancelled_by                UUID,
    cancel_reason               TEXT,

    document_chain_json         JSONB,
    notes                       TEXT,
    internal_notes              TEXT,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, deleted_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_sales_orders_tenant_number UNIQUE (tenant_id, so_number)
);

CREATE INDEX idx_sales_orders_tenant_customer ON sales_orders (tenant_id, customer_id, so_date DESC);
CREATE INDEX idx_sales_orders_tenant_status ON sales_orders (tenant_id, status, so_date DESC);
CREATE INDEX idx_sales_orders_tenant_delivery ON sales_orders (tenant_id, expected_delivery_date) WHERE status IN ('approved','partially_fulfilled');
CREATE INDEX idx_sales_orders_source_quotation ON sales_orders (tenant_id, source_quotation_id) WHERE source_quotation_id IS NOT NULL;

ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_orders FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.4 Sales Order Lines

```sql
sales_order_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    so_id                       UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,

    line_number                 SMALLINT NOT NULL,
    source_quotation_line_id    UUID,

    item_id                     UUID,
    item_code                   VARCHAR(50),
    item_name                   VARCHAR(500),
    description                 TEXT,

    -- Quantities
    quantity_ordered            NUMERIC(15,4) NOT NULL,
    quantity_fulfilled          NUMERIC(15,4) NOT NULL DEFAULT 0,
    quantity_invoiced           NUMERIC(15,4) NOT NULL DEFAULT 0,
    quantity_backorder          NUMERIC(15,4) NOT NULL DEFAULT 0,
    quantity_cancelled          NUMERIC(15,4) NOT NULL DEFAULT 0,
    uom                         VARCHAR(20) NOT NULL,

    -- Pricing
    unit_price                  NUMERIC(15,4) NOT NULL,
    line_subtotal               NUMERIC(15,2) NOT NULL,

    discount_type               VARCHAR(20),
    discount_value              NUMERIC(15,4),
    discount_amount             NUMERIC(15,2) NOT NULL DEFAULT 0,

    tax_code_id                 UUID,
    tax_rate                    NUMERIC(7,4),
    tax_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_inclusive               BOOLEAN NOT NULL DEFAULT FALSE,

    line_total                  NUMERIC(15,2) NOT NULL,

    warehouse_id                UUID,
    expected_delivery_date      DATE,

    -- Reservation (if enabled for this line)
    reserved_quantity           NUMERIC(15,4) DEFAULT 0,
    reserved_warehouse_id       UUID,
    reserved_at                 TIMESTAMP WITH TIME ZONE,

    notes                       TEXT,

    created_at, updated_at
);

CREATE INDEX idx_sales_order_lines_so ON sales_order_lines (tenant_id, so_id, line_number);
CREATE INDEX idx_sales_order_lines_item ON sales_order_lines (tenant_id, item_id) WHERE item_id IS NOT NULL;
CREATE INDEX idx_sales_order_lines_backorder ON sales_order_lines (tenant_id, item_id, warehouse_id)
    WHERE quantity_backorder > 0;

ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_order_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.5 Delivery Notes

Always created (even when combined with invoice) for consistent stock-movement audit.

```sql
delivery_notes (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    dn_number                   VARCHAR(50) NOT NULL,

    customer_id                 UUID NOT NULL,
    customer_contact_id         UUID,
    branch_id                   UUID NOT NULL,
    warehouse_id                UUID NOT NULL,  -- from where stock moves

    -- Source linkage
    source_so_id                UUID REFERENCES sales_orders(id),
    related_invoice_id          UUID,  -- set when invoice exists
    is_combined_with_invoice    BOOLEAN NOT NULL DEFAULT FALSE,
    -- true = DN is a shadow of invoice (POS, direct invoice without separate DN flow)

    -- Dates
    dn_date                     DATE NOT NULL,
    delivery_date_actual        DATE,
    delivery_time_actual        TIME,

    -- Delivery
    shipping_address_json       JSONB,
    delivery_person_name        VARCHAR(200),
    delivery_vehicle_number     VARCHAR(50),
    delivery_signed_by          VARCHAR(200),
    delivery_signature_url      VARCHAR(500),  -- S3 URL if captured

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','issued','in_transit','delivered','returned','cancelled'

    -- Stock impact
    stock_posted                BOOLEAN NOT NULL DEFAULT FALSE,
    stock_posted_at             TIMESTAMP WITH TIME ZONE,

    notes                       TEXT,
    document_chain_json         JSONB,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, deleted_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_delivery_notes_tenant_number UNIQUE (tenant_id, dn_number)
);

CREATE INDEX idx_delivery_notes_tenant_customer ON delivery_notes (tenant_id, customer_id, dn_date DESC);
CREATE INDEX idx_delivery_notes_tenant_status ON delivery_notes (tenant_id, status);
CREATE INDEX idx_delivery_notes_so ON delivery_notes (tenant_id, source_so_id) WHERE source_so_id IS NOT NULL;
CREATE INDEX idx_delivery_notes_invoice ON delivery_notes (tenant_id, related_invoice_id) WHERE related_invoice_id IS NOT NULL;

ALTER TABLE delivery_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delivery_notes FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.6 Delivery Note Lines

```sql
delivery_note_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    dn_id                       UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,

    line_number                 SMALLINT NOT NULL,
    source_so_line_id           UUID,

    item_id                     UUID NOT NULL,
    item_code                   VARCHAR(50),
    item_name                   VARCHAR(500),

    quantity_delivered          NUMERIC(15,4) NOT NULL,
    uom                         VARCHAR(20) NOT NULL,

    -- Batch / serial / expiry
    batch_id                    UUID,
    serial_ids                  UUID[],  -- for multi-serial items on same line
    expiry_date                 DATE,

    warehouse_id                UUID NOT NULL,

    notes                       TEXT,

    created_at, updated_at
);

CREATE INDEX idx_dn_lines_dn ON delivery_note_lines (tenant_id, dn_id, line_number);
CREATE INDEX idx_dn_lines_item ON delivery_note_lines (tenant_id, item_id);

ALTER TABLE delivery_note_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delivery_note_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.7 Invoices (Canonical Table — 5 Modes)

```sql
invoices (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    invoice_number              VARCHAR(50) NOT NULL,

    -- Mode discriminator (origin of this invoice)
    origin_mode                 VARCHAR(30) NOT NULL DEFAULT 'standard',
    -- 'standard','batch_generated','consolidated','from_recurring','from_proforma','pos'

    -- Source references (nullable per mode)
    source_so_id                UUID REFERENCES sales_orders(id),
    source_quotation_id         UUID REFERENCES quotations(id),
    source_proforma_id          UUID,  -- references proforma_invoices(id)
    source_recurring_template_id UUID,  -- references recurring_invoice_templates(id)
    source_dn_id                UUID REFERENCES delivery_notes(id),

    -- Parties
    customer_id                 UUID NOT NULL,
    customer_contact_id         UUID,
    salesperson_id              UUID,
    branch_id                   UUID NOT NULL,
    pos_terminal_id             UUID,  -- for POS-origin
    pos_shift_id                UUID,

    -- Dates
    invoice_date                DATE NOT NULL,
    due_date                    DATE NOT NULL,
    service_period_start        DATE,  -- for service invoices
    service_period_end          DATE,
    posted_at                   TIMESTAMP WITH TIME ZONE,

    -- Currency
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate               NUMERIC(15,6) NOT NULL DEFAULT 1,

    -- Period assignment (for GL)
    fiscal_year                 INTEGER,
    period_number               INTEGER,

    -- Amounts
    subtotal_lkr                NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_total_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    freight_lkr                 NUMERIC(15,2) NOT NULL DEFAULT 0,
    round_off_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,

    subtotal_original           NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_original          NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_original        NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Amount received tracking (denormalized for fast AR aging)
    amount_paid_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,
    amount_outstanding_lkr      NUMERIC(15,2) NOT NULL DEFAULT 0,
    payment_status              VARCHAR(20) NOT NULL DEFAULT 'unpaid',
    -- 'unpaid','partially_paid','paid','overpaid','written_off'
    fully_paid_at               TIMESTAMP WITH TIME ZONE,

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','pending_approval','approved','posted','sent','viewed','overdue','voided','written_off'

    -- Journal linkage
    journal_entry_id            UUID,  -- references journal_entries(id) once posted

    -- Approval
    approval_required           BOOLEAN NOT NULL DEFAULT FALSE,
    approval_instance_id        UUID,

    -- Terms
    payment_terms               VARCHAR(50),
    customer_po_number          VARCHAR(100),

    -- Sync source (for POS offline)
    sync_source                 VARCHAR(30),  -- 'online','offline_pos','api','import'
    client_generated_id         UUID,  -- for idempotency on offline sync
    synced_at                   TIMESTAMP WITH TIME ZONE,

    -- Delivery channel / customer receipt
    delivered_via               VARCHAR(20),  -- 'email','whatsapp_future','print','sms_future','portal'
    delivered_at                TIMESTAMP WITH TIME ZONE,
    viewed_at                   TIMESTAMP WITH TIME ZONE,  -- customer portal opened
    pdf_nic_password_hint       VARCHAR(10),  -- last 4 of NIC for PDF password

    -- Voiding / write-off
    voided_at                   TIMESTAMP WITH TIME ZONE,
    voided_by                   UUID,
    void_reason                 TEXT,
    reversed_by_credit_note_id  UUID,

    written_off_at              TIMESTAMP WITH TIME ZONE,
    written_off_by              UUID,
    write_off_reason            TEXT,
    write_off_amount_lkr        NUMERIC(15,2),

    -- Consolidated invoice metadata
    consolidated_source_count   SMALLINT,  -- how many SOs/DNs it consolidates
    consolidation_period_start  DATE,
    consolidation_period_end    DATE,

    notes                       TEXT,
    internal_notes              TEXT,
    document_chain_json         JSONB,
    tags                        JSONB,

    -- Concurrency
    locked                      BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at                   TIMESTAMP WITH TIME ZONE,

    created_at, updated_at, deleted_at, created_by, updated_by, deleted_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_invoices_tenant_number UNIQUE (tenant_id, invoice_number),
    CONSTRAINT uk_invoices_client_generated UNIQUE (tenant_id, client_generated_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_invoices_tenant_customer ON invoices (tenant_id, customer_id, invoice_date DESC);
CREATE INDEX idx_invoices_tenant_status ON invoices (tenant_id, status, invoice_date DESC);
CREATE INDEX idx_invoices_tenant_payment_status ON invoices (tenant_id, payment_status, due_date);
CREATE INDEX idx_invoices_tenant_branch ON invoices (tenant_id, branch_id, invoice_date DESC);
CREATE INDEX idx_invoices_tenant_overdue ON invoices (tenant_id, due_date)
    WHERE status = 'posted' AND payment_status IN ('unpaid','partially_paid');
CREATE INDEX idx_invoices_pos_shift ON invoices (tenant_id, pos_shift_id) WHERE pos_shift_id IS NOT NULL;
CREATE INDEX idx_invoices_period ON invoices (tenant_id, fiscal_year, period_number) WHERE status = 'posted';
CREATE INDEX idx_invoices_source_so ON invoices (tenant_id, source_so_id) WHERE source_so_id IS NOT NULL;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.8 Invoice Lines

```sql
invoice_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    invoice_id                  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

    line_number                 SMALLINT NOT NULL,
    source_so_line_id           UUID,
    source_dn_line_id           UUID,

    item_id                     UUID,
    item_code                   VARCHAR(50),
    item_name                   VARCHAR(500),
    description                 TEXT,

    -- Quantity + pricing
    quantity                    NUMERIC(15,4) NOT NULL,
    uom                         VARCHAR(20) NOT NULL,
    unit_price                  NUMERIC(15,4) NOT NULL,
    unit_cost                   NUMERIC(15,4),  -- captured at invoice time for COGS posting
    line_subtotal               NUMERIC(15,2) NOT NULL,

    -- Discount
    discount_type               VARCHAR(20),  -- 'percentage','fixed'
    discount_value              NUMERIC(15,4),
    discount_amount             NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_approved_by        UUID,

    -- Tax (with SL compound tax support)
    tax_code_id                 UUID,
    tax_rate                    NUMERIC(7,4),
    tax_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_inclusive               BOOLEAN NOT NULL DEFAULT FALSE,

    sscl_applicable             BOOLEAN NOT NULL DEFAULT FALSE,
    sscl_rate                   NUMERIC(7,4),
    sscl_amount                 NUMERIC(15,2) NOT NULL DEFAULT 0,

    line_total                  NUMERIC(15,2) NOT NULL,

    -- Batch / serial / expiry (linked to actual stock movements)
    batch_id                    UUID,
    serial_ids                  UUID[],
    expiry_date                 DATE,

    warehouse_id                UUID,

    -- GL dimensions (propagated to journal_lines)
    cost_center_id              UUID,

    notes                       TEXT,

    created_at, updated_at
);

CREATE INDEX idx_invoice_lines_invoice ON invoice_lines (tenant_id, invoice_id, line_number);
CREATE INDEX idx_invoice_lines_item ON invoice_lines (tenant_id, item_id) WHERE item_id IS NOT NULL;
CREATE INDEX idx_invoice_lines_batch ON invoice_lines (tenant_id, batch_id) WHERE batch_id IS NOT NULL;

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.9 Recurring Invoice Templates

Does NOT post to GL. Generates invoices on schedule.

```sql
recurring_invoice_templates (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    template_name               VARCHAR(200) NOT NULL,
    customer_id                 UUID NOT NULL,
    branch_id                   UUID NOT NULL,

    -- Schedule
    frequency                   VARCHAR(20) NOT NULL,  -- 'monthly','quarterly','yearly','weekly','custom'
    interval_value              SMALLINT NOT NULL DEFAULT 1,  -- every N units
    start_date                  DATE NOT NULL,
    end_date                    DATE,
    next_generation_date        DATE NOT NULL,
    day_of_month                SMALLINT,  -- for monthly (e.g. 1st, 15th, last)
    day_of_week                 SMALLINT,

    -- Amounts / lines (stored as template)
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    template_lines_json         JSONB NOT NULL,  -- snapshot of line items
    payment_terms               VARCHAR(50),

    -- Auto-send behavior
    auto_send                   BOOLEAN NOT NULL DEFAULT FALSE,
    auto_send_channel           VARCHAR(20),

    -- Tracking
    generated_count             INTEGER NOT NULL DEFAULT 0,
    last_generated_at           TIMESTAMP WITH TIME ZONE,
    last_generated_invoice_id   UUID REFERENCES invoices(id),

    -- Status
    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','paused','ended','cancelled'

    paused_at                   TIMESTAMP WITH TIME ZONE,
    paused_until                DATE,

    notes                       TEXT,

    created_at, updated_at, deleted_at, created_by, updated_by, version_row INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_recurring_templates_tenant_next ON recurring_invoice_templates (tenant_id, status, next_generation_date)
    WHERE status = 'active';
CREATE INDEX idx_recurring_templates_customer ON recurring_invoice_templates (tenant_id, customer_id);

ALTER TABLE recurring_invoice_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_invoice_templates FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.10 Proforma Invoices

Does NOT post to GL. Converts to invoice on acceptance.

```sql
proforma_invoices (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    proforma_number             VARCHAR(50) NOT NULL,
    customer_id                 UUID NOT NULL,
    branch_id                   UUID NOT NULL,
    salesperson_id              UUID,

    proforma_date               DATE NOT NULL,
    valid_until_date            DATE,

    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate               NUMERIC(15,6) NOT NULL DEFAULT 1,

    subtotal_lkr                NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,

    notes                       TEXT,
    payment_terms               VARCHAR(50),

    -- Conversion
    status                      VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft','sent','accepted','declined','expired','converted'
    converted_to_invoice_id     UUID REFERENCES invoices(id),
    converted_at                TIMESTAMP WITH TIME ZONE,

    -- Advance receipt (if prepayment received based on proforma)
    advance_receipt_id          UUID,  -- references receipts(id)

    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_proforma_tenant_number UNIQUE (tenant_id, proforma_number)
);

-- Lines mirror invoice_lines structure
CREATE TABLE proforma_invoice_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    proforma_id                 UUID NOT NULL REFERENCES proforma_invoices(id) ON DELETE CASCADE,
    line_number                 SMALLINT NOT NULL,
    item_id                     UUID,
    item_code                   VARCHAR(50),
    item_name                   VARCHAR(500),
    description                 TEXT,
    quantity                    NUMERIC(15,4) NOT NULL,
    uom                         VARCHAR(20) NOT NULL,
    unit_price                  NUMERIC(15,4) NOT NULL,
    discount_amount             NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_code_id                 UUID,
    tax_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,
    line_total                  NUMERIC(15,2) NOT NULL,
    notes                       TEXT,
    created_at, updated_at
);

CREATE INDEX idx_proforma_tenant_status ON proforma_invoices (tenant_id, status);
CREATE INDEX idx_proforma_customer ON proforma_invoices (tenant_id, customer_id);
CREATE INDEX idx_proforma_lines_proforma ON proforma_invoice_lines (tenant_id, proforma_id);

ALTER TABLE proforma_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE proforma_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON proforma_invoices FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON proforma_invoice_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.11 Credit Notes

```sql
credit_notes (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    credit_note_number          VARCHAR(50) NOT NULL,

    customer_id                 UUID NOT NULL,
    customer_contact_id         UUID,
    branch_id                   UUID NOT NULL,

    -- Source
    source_invoice_id           UUID REFERENCES invoices(id),
    reason_category             VARCHAR(50) NOT NULL,
    -- 'sales_return','price_correction','discount_adjustment','bad_debt_vat_relief',
    -- 'pricing_error','customer_complaint','goods_damaged','other'
    reason_details              TEXT,

    -- Dates
    credit_note_date            DATE NOT NULL,
    posted_at                   TIMESTAMP WITH TIME ZONE,

    -- Currency
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate               NUMERIC(15,6) NOT NULL DEFAULT 1,

    fiscal_year                 INTEGER,
    period_number               INTEGER,

    -- Amounts
    subtotal_lkr                NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,

    subtotal_original           NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_original        NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Application tracking
    amount_applied_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,
    amount_remaining_lkr        NUMERIC(15,2) NOT NULL DEFAULT 0,
    application_status          VARCHAR(20) NOT NULL DEFAULT 'unapplied',
    -- 'unapplied','partially_applied','fully_applied','refunded','written_off'

    -- Stock return (if sales return)
    is_stock_return             BOOLEAN NOT NULL DEFAULT FALSE,
    stock_posted                BOOLEAN NOT NULL DEFAULT FALSE,

    -- VAT relief workflow (bad debt)
    is_vat_relief                BOOLEAN NOT NULL DEFAULT FALSE,
    vat_relief_period_id        UUID,  -- which period was VAT remitted in

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','pending_approval','approved','posted','voided'

    approval_required           BOOLEAN NOT NULL DEFAULT FALSE,
    approval_instance_id        UUID,

    journal_entry_id            UUID,

    notes                       TEXT,
    internal_notes              TEXT,
    document_chain_json         JSONB,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, deleted_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_credit_notes_tenant_number UNIQUE (tenant_id, credit_note_number)
);

CREATE TABLE credit_note_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    credit_note_id              UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
    line_number                 SMALLINT NOT NULL,
    source_invoice_line_id      UUID,
    item_id                     UUID,
    item_code                   VARCHAR(50),
    item_name                   VARCHAR(500),
    description                 TEXT,
    quantity                    NUMERIC(15,4) NOT NULL,
    uom                         VARCHAR(20) NOT NULL,
    unit_price                  NUMERIC(15,4) NOT NULL,
    line_subtotal               NUMERIC(15,2) NOT NULL,
    tax_code_id                 UUID,
    tax_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,
    line_total                  NUMERIC(15,2) NOT NULL,
    warehouse_id                UUID,  -- for stock return destination
    batch_id                    UUID,
    serial_ids                  UUID[],
    notes                       TEXT,
    created_at, updated_at
);

CREATE INDEX idx_credit_notes_tenant_customer ON credit_notes (tenant_id, customer_id, credit_note_date DESC);
CREATE INDEX idx_credit_notes_tenant_status ON credit_notes (tenant_id, status);
CREATE INDEX idx_credit_notes_source_invoice ON credit_notes (tenant_id, source_invoice_id) WHERE source_invoice_id IS NOT NULL;
CREATE INDEX idx_credit_notes_unapplied ON credit_notes (tenant_id, customer_id, application_status)
    WHERE application_status IN ('unapplied','partially_applied');
CREATE INDEX idx_credit_note_lines_cn ON credit_note_lines (tenant_id, credit_note_id);

ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_note_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_notes FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON credit_note_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.12 Receipts

Header + allocation detail for many-to-many invoice-to-receipt linking.

```sql
receipts (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    receipt_number              VARCHAR(50) NOT NULL,

    customer_id                 UUID NOT NULL,
    branch_id                   UUID NOT NULL,
    received_by                 UUID,  -- user who received

    receipt_date                DATE NOT NULL,
    posted_at                   TIMESTAMP WITH TIME ZONE,

    -- Tender
    tender_method               VARCHAR(30) NOT NULL,
    -- 'cash','cheque','bank_transfer','card','qr','mixed','online_gateway','account_credit','loyalty','other'

    -- Bank / cheque details (one of these populated based on tender_method)
    bank_account_id             UUID,  -- which of our bank accounts received
    cheque_id                   UUID,  -- references cheques(id) for cheque receipts
    card_last_four              CHAR(4),
    card_type                   VARCHAR(20),
    gateway_reference           VARCHAR(100),
    gateway_name                VARCHAR(50),  -- 'payhere','frimi','genie','ipay','lankaqr'
    reference_number            VARCHAR(100),  -- bank ref / txn id

    -- Currency
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate               NUMERIC(15,6) NOT NULL DEFAULT 1,
    amount_original             NUMERIC(15,2) NOT NULL,
    amount_lkr                  NUMERIC(15,2) NOT NULL,

    -- Allocation tracking
    amount_allocated_lkr        NUMERIC(15,2) NOT NULL DEFAULT 0,
    amount_unallocated_lkr      NUMERIC(15,2) NOT NULL DEFAULT 0,
    is_fully_allocated          BOOLEAN NOT NULL DEFAULT FALSE,

    -- Advance indicator
    creates_customer_advance    BOOLEAN NOT NULL DEFAULT FALSE,
    customer_advance_id         UUID,  -- references customer_advances(id)

    fiscal_year                 INTEGER,
    period_number               INTEGER,

    status                      VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft','posted','voided','bounced','reversed'

    journal_entry_id            UUID,

    -- Mixed-tender breakdown (when tender_method = 'mixed')
    tender_breakdown_json       JSONB,

    notes                       TEXT,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, deleted_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_receipts_tenant_number UNIQUE (tenant_id, receipt_number)
);

receipt_allocations (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    receipt_id                  UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,

    -- What it pays
    allocated_to_type           VARCHAR(30) NOT NULL,
    -- 'invoice','customer_advance','loan','other'
    invoice_id                  UUID REFERENCES invoices(id),
    customer_advance_id         UUID,

    -- Amount
    amount_lkr                  NUMERIC(15,2) NOT NULL,
    amount_original             NUMERIC(15,2) NOT NULL,

    allocation_date             DATE NOT NULL DEFAULT CURRENT_DATE,
    allocated_by                UUID,

    -- For unallocation (rare — corrections)
    unallocated_at              TIMESTAMP WITH TIME ZONE,
    unallocated_by              UUID,
    unallocate_reason           TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_receipt_alloc_target CHECK (
        (allocated_to_type = 'invoice' AND invoice_id IS NOT NULL)
        OR (allocated_to_type = 'customer_advance' AND customer_advance_id IS NOT NULL)
        OR (allocated_to_type IN ('loan','other'))
    )
);

CREATE INDEX idx_receipts_tenant_customer ON receipts (tenant_id, customer_id, receipt_date DESC);
CREATE INDEX idx_receipts_tenant_status ON receipts (tenant_id, status);
CREATE INDEX idx_receipts_tenant_tender ON receipts (tenant_id, tender_method, receipt_date DESC);
CREATE INDEX idx_receipts_unallocated ON receipts (tenant_id, customer_id)
    WHERE is_fully_allocated = FALSE AND status = 'posted';
CREATE INDEX idx_receipts_bank ON receipts (tenant_id, bank_account_id, receipt_date DESC);
CREATE INDEX idx_receipt_allocations_receipt ON receipt_allocations (tenant_id, receipt_id);
CREATE INDEX idx_receipt_allocations_invoice ON receipt_allocations (tenant_id, invoice_id) WHERE invoice_id IS NOT NULL;

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON receipts FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON receipt_allocations FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 3. POS-Specific Schemas

### 3.1 POS Terminals

```sql
pos_terminals (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    terminal_code               VARCHAR(30) NOT NULL,
    terminal_name               VARCHAR(100) NOT NULL,
    branch_id                   UUID NOT NULL,
    default_warehouse_id        UUID NOT NULL,

    -- Hardware / device binding
    device_fingerprint          VARCHAR(255),
    last_device_ip              INET,
    registered_at               TIMESTAMP WITH TIME ZONE,

    -- Capabilities
    allowed_tender_methods      JSONB NOT NULL DEFAULT '["cash"]',
    -- subset of 9 methods: ["cash","card","cheque","qr","bank_transfer","account_credit","loyalty","mixed","on_account"]
    printer_config_json         JSONB,
    scale_integration_json      JSONB,
    card_reader_config_json     JSONB,
    cash_drawer_config_json     JSONB,

    -- Number series (overrides tenant default for this terminal)
    invoice_series_id           UUID,
    receipt_series_id           UUID,

    -- Offline behavior
    allow_offline_operation     BOOLEAN NOT NULL DEFAULT TRUE,
    offline_max_duration_hours  INTEGER DEFAULT 24,

    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','inactive','suspended','decommissioned'

    last_activity_at            TIMESTAMP WITH TIME ZONE,
    last_sync_at                TIMESTAMP WITH TIME ZONE,

    tags                        JSONB,
    notes                       TEXT,

    created_at, updated_at, deleted_at, created_by, updated_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_pos_terminals_tenant_code UNIQUE (tenant_id, terminal_code)
);

CREATE INDEX idx_pos_terminals_tenant_branch ON pos_terminals (tenant_id, branch_id, status);

ALTER TABLE pos_terminals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_terminals FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.2 POS Shifts

```sql
pos_shifts (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    shift_number                VARCHAR(50) NOT NULL,
    terminal_id                 UUID NOT NULL REFERENCES pos_terminals(id),
    branch_id                   UUID NOT NULL,
    cashier_user_id             UUID NOT NULL,

    -- Open
    opened_at                   TIMESTAMP WITH TIME ZONE NOT NULL,
    opening_float_lkr           NUMERIC(15,2) NOT NULL DEFAULT 0,
    opening_denomination_json   JSONB,  -- {"5000":5,"1000":20,"500":40,...}
    opening_notes               TEXT,

    -- Close
    closed_at                   TIMESTAMP WITH TIME ZONE,
    closed_by                   UUID,

    expected_cash_lkr           NUMERIC(15,2),  -- computed from shift transactions
    counted_cash_lkr            NUMERIC(15,2),
    closing_denomination_json   JSONB,
    variance_lkr                NUMERIC(15,2),  -- counted - expected
    variance_reason_code        VARCHAR(50),
    -- 'none','over_count_minor','under_count_minor','known_miscalc','bank_deposit_off',
    -- 'cash_out_missing','theft_suspected','other'
    variance_explanation        TEXT,

    -- Multi-tender totals (snapshot at close)
    totals_by_tender_json       JSONB,
    -- {"cash":{"count":42,"amount":125000},"card":{...},...}

    total_invoices              INTEGER NOT NULL DEFAULT 0,
    total_receipts              INTEGER NOT NULL DEFAULT 0,
    total_voided                INTEGER NOT NULL DEFAULT 0,
    total_returns_lkr           NUMERIC(15,2) DEFAULT 0,

    -- Multi-shift scenarios
    parent_shift_id             UUID REFERENCES pos_shifts(id),  -- for shift handover

    -- Status
    status                      VARCHAR(20) NOT NULL DEFAULT 'open',
    -- 'open','closing','closed','force_closed','disputed'

    force_closed_by             UUID,  -- admin close when cashier disappears
    force_close_reason          TEXT,

    notes                       TEXT,

    created_at, updated_at, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_pos_shifts_tenant_number UNIQUE (tenant_id, shift_number)
);

CREATE INDEX idx_pos_shifts_terminal ON pos_shifts (tenant_id, terminal_id, opened_at DESC);
CREATE INDEX idx_pos_shifts_cashier ON pos_shifts (tenant_id, cashier_user_id, opened_at DESC);
CREATE INDEX idx_pos_shifts_open ON pos_shifts (tenant_id, status) WHERE status = 'open';
CREATE INDEX idx_pos_shifts_branch_date ON pos_shifts (tenant_id, branch_id, opened_at DESC);

ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_shifts FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.3 POS Parked Sales

Incomplete/paused sales held for later resumption.

```sql
pos_parked_sales (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    terminal_id                 UUID NOT NULL REFERENCES pos_terminals(id),
    shift_id                    UUID REFERENCES pos_shifts(id),
    cashier_user_id             UUID NOT NULL,

    park_number                 VARCHAR(30) NOT NULL,
    parked_at                   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at                  TIMESTAMP WITH TIME ZONE,  -- auto-expire after N hours

    customer_id                 UUID,
    customer_name_adhoc         VARCHAR(200),

    lines_json                  JSONB NOT NULL,  -- cart snapshot
    subtotal_lkr                NUMERIC(15,2),
    tax_total_lkr               NUMERIC(15,2),
    grand_total_lkr             NUMERIC(15,2),

    park_reason                 VARCHAR(100),
    -- 'customer_forgot_wallet','price_check','stock_check','manager_approval','other'

    -- Resumption
    resumed_at                  TIMESTAMP WITH TIME ZONE,
    resumed_by                  UUID,
    resulting_invoice_id        UUID REFERENCES invoices(id),

    -- Cancellation
    cancelled_at                TIMESTAMP WITH TIME ZONE,
    cancelled_by                UUID,
    cancel_reason               TEXT,

    status                      VARCHAR(20) NOT NULL DEFAULT 'parked',
    -- 'parked','resumed','cancelled','expired'

    notes                       TEXT,

    created_at, updated_at,

    CONSTRAINT uk_pos_parked_tenant_number UNIQUE (tenant_id, park_number)
);

CREATE INDEX idx_pos_parked_active ON pos_parked_sales (tenant_id, terminal_id, status)
    WHERE status = 'parked';
CREATE INDEX idx_pos_parked_expiring ON pos_parked_sales (tenant_id, expires_at)
    WHERE status = 'parked';

ALTER TABLE pos_parked_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_parked_sales FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.4 POS Z-Reports

Immutable snapshots at shift close.

```sql
pos_z_reports (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    shift_id                    UUID NOT NULL REFERENCES pos_shifts(id),
    terminal_id                 UUID NOT NULL REFERENCES pos_terminals(id),

    z_number                    VARCHAR(50) NOT NULL,  -- immutable sequential
    generated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Snapshot of everything at close
    shift_summary_json          JSONB NOT NULL,
    -- {
    --   "opened_at": "...", "closed_at": "...",
    --   "cashier": "...", "terminal": "...",
    --   "totals_by_tender": {...},
    --   "by_item_category": {...},
    --   "by_hour": {...},
    --   "top_selling_items": [...],
    --   "void_summary": {...},
    --   "variance": ...
    -- }

    total_gross_sales_lkr       NUMERIC(15,2) NOT NULL,
    total_discounts_lkr         NUMERIC(15,2) NOT NULL,
    total_taxes_lkr             NUMERIC(15,2) NOT NULL,
    total_net_sales_lkr         NUMERIC(15,2) NOT NULL,
    total_transactions          INTEGER NOT NULL,
    total_items_sold            INTEGER NOT NULL,

    -- Archival
    pdf_url                     VARCHAR(500),  -- S3 URL of stored Z-report PDF
    printed_count               INTEGER NOT NULL DEFAULT 0,
    last_printed_at             TIMESTAMP WITH TIME ZONE,

    CONSTRAINT uk_pos_z_reports_tenant_number UNIQUE (tenant_id, z_number)
);

-- Immutable: no UPDATE, no DELETE via trigger

CREATE OR REPLACE FUNCTION prevent_z_report_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Z-reports are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pos_z_reports_immutable
    BEFORE UPDATE OR DELETE ON pos_z_reports
    FOR EACH ROW EXECUTE FUNCTION prevent_z_report_modification();

CREATE INDEX idx_pos_z_reports_shift ON pos_z_reports (tenant_id, shift_id);
CREATE INDEX idx_pos_z_reports_terminal ON pos_z_reports (tenant_id, terminal_id, generated_at DESC);

ALTER TABLE pos_z_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_z_reports FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 4. Buy-Side Documents

### 4.1 Purchase Requisitions

```sql
purchase_requisitions (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    pr_number                   VARCHAR(50) NOT NULL,
    requester_user_id           UUID NOT NULL,
    requester_department        VARCHAR(100),
    branch_id                   UUID NOT NULL,

    pr_date                     DATE NOT NULL,
    required_by_date            DATE,
    business_justification      TEXT,

    -- Preferred supplier (recommendation only)
    preferred_supplier_id       UUID,

    -- Amounts (estimated)
    estimated_total_lkr         NUMERIC(15,2) NOT NULL DEFAULT 0,
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','pending_approval','approved','rejected','converted','cancelled'

    approval_required           BOOLEAN NOT NULL DEFAULT FALSE,
    approval_instance_id        UUID,

    -- Conversion
    converted_to_po_ids         UUID[],  -- one PR can appear on multiple POs (partial conversion)
    conversion_status           VARCHAR(20) NOT NULL DEFAULT 'not_converted',
    -- 'not_converted','partially_converted','fully_converted'

    cancelled_at                TIMESTAMP WITH TIME ZONE,
    cancel_reason               TEXT,

    notes                       TEXT,
    internal_notes              TEXT,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_pr_tenant_number UNIQUE (tenant_id, pr_number)
);

purchase_requisition_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    pr_id                       UUID NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,

    line_number                 SMALLINT NOT NULL,
    item_id                     UUID,
    item_code                   VARCHAR(50),
    item_name                   VARCHAR(500),
    description                 TEXT,

    quantity_requested          NUMERIC(15,4) NOT NULL,
    quantity_converted          NUMERIC(15,4) NOT NULL DEFAULT 0,
    uom                         VARCHAR(20) NOT NULL,

    estimated_unit_price        NUMERIC(15,4),
    estimated_line_total        NUMERIC(15,2),

    destination_warehouse_id    UUID,
    required_by_date            DATE,

    notes                       TEXT,

    created_at, updated_at
);

CREATE INDEX idx_pr_tenant_status ON purchase_requisitions (tenant_id, status, pr_date DESC);
CREATE INDEX idx_pr_requester ON purchase_requisitions (tenant_id, requester_user_id, pr_date DESC);
CREATE INDEX idx_pr_pending ON purchase_requisitions (tenant_id, approval_instance_id)
    WHERE status = 'pending_approval';
CREATE INDEX idx_pr_lines_pr ON purchase_requisition_lines (tenant_id, pr_id);
CREATE INDEX idx_pr_lines_item ON purchase_requisition_lines (tenant_id, item_id) WHERE item_id IS NOT NULL;

ALTER TABLE purchase_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requisition_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_requisitions FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON purchase_requisition_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.2 Purchase Orders

```sql
purchase_orders (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    po_number                   VARCHAR(50) NOT NULL,

    supplier_id                 UUID NOT NULL,
    supplier_contact_id         UUID,
    branch_id                   UUID NOT NULL,
    buyer_user_id               UUID,

    -- Source PRs (can be multiple PRs consolidated into one PO)
    source_pr_ids               UUID[],

    -- Dates
    po_date                     DATE NOT NULL,
    expected_delivery_date      DATE,
    delivery_address_json       JSONB,

    -- Currency
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate               NUMERIC(15,6) NOT NULL DEFAULT 1,

    -- Amounts
    subtotal_lkr                NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_total_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    freight_lkr                 NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,

    subtotal_original           NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_original        NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Receipt tracking
    quantity_total              NUMERIC(15,4) NOT NULL DEFAULT 0,
    quantity_received           NUMERIC(15,4) NOT NULL DEFAULT 0,
    quantity_billed             NUMERIC(15,4) NOT NULL DEFAULT 0,
    receipt_pct                 NUMERIC(5,2) NOT NULL DEFAULT 0,

    -- Supplier acknowledgment
    sent_to_supplier_at         TIMESTAMP WITH TIME ZONE,
    acknowledged_at             TIMESTAMP WITH TIME ZONE,
    acknowledged_by_supplier    VARCHAR(200),
    supplier_reference          VARCHAR(100),  -- supplier's own PO reference

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','pending_approval','approved','sent','acknowledged',
    -- 'partially_received','fully_received','partially_billed','fully_billed','closed','cancelled'

    approval_required           BOOLEAN NOT NULL DEFAULT FALSE,
    approval_instance_id        UUID,

    -- Cancellation
    cancelled_at                TIMESTAMP WITH TIME ZONE,
    cancelled_by                UUID,
    cancel_reason               TEXT,

    -- Delivery terms
    payment_terms               VARCHAR(50),
    delivery_terms              TEXT,
    incoterms                   VARCHAR(20),  -- for foreign suppliers

    notes                       TEXT,
    internal_notes              TEXT,
    document_chain_json         JSONB,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, deleted_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_po_tenant_number UNIQUE (tenant_id, po_number)
);

purchase_order_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    po_id                       UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,

    line_number                 SMALLINT NOT NULL,
    source_pr_line_id           UUID,

    item_id                     UUID,
    item_code                   VARCHAR(50),
    item_name                   VARCHAR(500),
    supplier_part_number        VARCHAR(100),
    description                 TEXT,

    quantity_ordered            NUMERIC(15,4) NOT NULL,
    quantity_received           NUMERIC(15,4) NOT NULL DEFAULT 0,
    quantity_billed             NUMERIC(15,4) NOT NULL DEFAULT 0,
    quantity_cancelled          NUMERIC(15,4) NOT NULL DEFAULT 0,
    uom                         VARCHAR(20) NOT NULL,

    unit_price                  NUMERIC(15,4) NOT NULL,
    line_subtotal               NUMERIC(15,2) NOT NULL,

    discount_type               VARCHAR(20),
    discount_value              NUMERIC(15,4),
    discount_amount             NUMERIC(15,2) NOT NULL DEFAULT 0,

    tax_code_id                 UUID,
    tax_rate                    NUMERIC(7,4),
    tax_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,

    line_total                  NUMERIC(15,2) NOT NULL,

    destination_warehouse_id    UUID,
    expected_delivery_date      DATE,

    -- GL coding
    expense_account_id          UUID,  -- direct-to-expense lines
    cost_center_id              UUID,

    notes                       TEXT,

    created_at, updated_at
);

CREATE INDEX idx_po_tenant_supplier ON purchase_orders (tenant_id, supplier_id, po_date DESC);
CREATE INDEX idx_po_tenant_status ON purchase_orders (tenant_id, status, po_date DESC);
CREATE INDEX idx_po_open ON purchase_orders (tenant_id, expected_delivery_date)
    WHERE status IN ('approved','sent','acknowledged','partially_received');
CREATE INDEX idx_po_lines_po ON purchase_order_lines (tenant_id, po_id, line_number);
CREATE INDEX idx_po_lines_item ON purchase_order_lines (tenant_id, item_id) WHERE item_id IS NOT NULL;

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_orders FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON purchase_order_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.3 Goods Received Notes

```sql
goods_received_notes (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    grn_number                  VARCHAR(50) NOT NULL,

    supplier_id                 UUID NOT NULL,
    branch_id                   UUID NOT NULL,
    warehouse_id                UUID NOT NULL,
    received_by                 UUID NOT NULL,

    -- Source
    source_po_id                UUID REFERENCES purchase_orders(id),
    supplier_dn_reference       VARCHAR(100),
    supplier_invoice_reference  VARCHAR(100),

    -- Dates
    grn_date                    DATE NOT NULL,
    posted_at                   TIMESTAMP WITH TIME ZONE,

    -- Currency
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate               NUMERIC(15,6) NOT NULL DEFAULT 1,

    -- Amounts (for accrual posting)
    subtotal_lkr                NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    freight_lkr                 NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Landed cost
    landed_cost_lkr             NUMERIC(15,2) DEFAULT 0,
    landed_cost_finalized       BOOLEAN NOT NULL DEFAULT FALSE,
    landed_cost_locked_at       TIMESTAMP WITH TIME ZONE,  -- after which late bills post to variance

    -- Quality check
    quality_check_status        VARCHAR(20) DEFAULT 'not_required',
    -- 'not_required','pending','passed','failed','partial'
    quality_checked_by          UUID,
    quality_checked_at          TIMESTAMP WITH TIME ZONE,

    -- Discrepancy flags (the 4 flags)
    has_over_delivery           BOOLEAN NOT NULL DEFAULT FALSE,
    has_under_delivery          BOOLEAN NOT NULL DEFAULT FALSE,
    has_quality_issue           BOOLEAN NOT NULL DEFAULT FALSE,
    has_wrong_item              BOOLEAN NOT NULL DEFAULT FALSE,
    discrepancy_notes           TEXT,

    fiscal_year                 INTEGER,
    period_number               INTEGER,

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','received','quality_checking','posted','billed','voided'

    -- Posting
    stock_posted                BOOLEAN NOT NULL DEFAULT FALSE,
    accrual_journal_entry_id    UUID,

    -- Bill linkage
    is_billed                   BOOLEAN NOT NULL DEFAULT FALSE,
    matched_bill_id             UUID,

    notes                       TEXT,
    internal_notes              TEXT,
    document_chain_json         JSONB,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, deleted_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_grn_tenant_number UNIQUE (tenant_id, grn_number)
);

goods_received_note_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    grn_id                      UUID NOT NULL REFERENCES goods_received_notes(id) ON DELETE CASCADE,

    line_number                 SMALLINT NOT NULL,
    source_po_line_id           UUID,

    item_id                     UUID NOT NULL,
    item_code                   VARCHAR(50),
    item_name                   VARCHAR(500),
    description                 TEXT,

    -- Multi-quantity fields
    quantity_ordered            NUMERIC(15,4) NOT NULL DEFAULT 0,  -- from PO
    quantity_received           NUMERIC(15,4) NOT NULL,            -- physical arrival
    quantity_accepted           NUMERIC(15,4) NOT NULL DEFAULT 0,  -- passed QC
    quantity_rejected           NUMERIC(15,4) NOT NULL DEFAULT 0,  -- failed QC
    quantity_damaged            NUMERIC(15,4) NOT NULL DEFAULT 0,  -- damaged in transit
    quantity_pending_return     NUMERIC(15,4) NOT NULL DEFAULT 0,  -- awaiting supplier pickup
    uom                         VARCHAR(20) NOT NULL,

    unit_cost                   NUMERIC(15,4) NOT NULL,
    line_subtotal               NUMERIC(15,2) NOT NULL,

    tax_code_id                 UUID,
    tax_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,

    line_total                  NUMERIC(15,2) NOT NULL,

    -- Destination tracking
    warehouse_id                UUID NOT NULL,
    damaged_warehouse_id        UUID,  -- if items routed to damaged warehouse

    -- Batch / serial / expiry (assigned on receipt)
    batch_number                VARCHAR(100),
    batch_id                    UUID,  -- links to stock_batches(id) after posting
    serial_numbers              TEXT[],  -- if multiple
    serial_ids                  UUID[],
    manufacture_date            DATE,
    expiry_date                 DATE,

    -- Discrepancy per line
    has_discrepancy             BOOLEAN NOT NULL DEFAULT FALSE,
    discrepancy_type            VARCHAR(30),  -- 'over','under','quality','wrong_item'
    discrepancy_notes           TEXT,

    notes                       TEXT,

    created_at, updated_at
);

CREATE INDEX idx_grn_tenant_supplier ON goods_received_notes (tenant_id, supplier_id, grn_date DESC);
CREATE INDEX idx_grn_tenant_status ON goods_received_notes (tenant_id, status, grn_date DESC);
CREATE INDEX idx_grn_po ON goods_received_notes (tenant_id, source_po_id) WHERE source_po_id IS NOT NULL;
CREATE INDEX idx_grn_unbilled ON goods_received_notes (tenant_id, supplier_id)
    WHERE status = 'posted' AND is_billed = FALSE;
CREATE INDEX idx_grn_discrepancy ON goods_received_notes (tenant_id)
    WHERE has_over_delivery OR has_under_delivery OR has_quality_issue OR has_wrong_item;
CREATE INDEX idx_grn_lines_grn ON goods_received_note_lines (tenant_id, grn_id, line_number);
CREATE INDEX idx_grn_lines_item ON goods_received_note_lines (tenant_id, item_id);

ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_received_note_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON goods_received_notes FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON goods_received_note_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.4 Bills (Supplier Invoices)

```sql
bills (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    bill_number                 VARCHAR(50) NOT NULL,            -- our internal
    supplier_invoice_number     VARCHAR(100) NOT NULL,           -- supplier's invoice #
    supplier_invoice_date       DATE NOT NULL,

    supplier_id                 UUID NOT NULL,
    branch_id                   UUID NOT NULL,

    -- Source documents (nullable — bill may be direct-expense without PO/GRN)
    source_po_ids               UUID[],   -- multiple POs can be on one bill
    source_grn_ids              UUID[],   -- multiple GRNs can be on one bill
    is_direct_expense           BOOLEAN NOT NULL DEFAULT FALSE,  -- no PO or GRN

    -- Dates
    bill_date                   DATE NOT NULL,  -- when we record it
    due_date                    DATE NOT NULL,
    posted_at                   TIMESTAMP WITH TIME ZONE,

    -- Currency
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate               NUMERIC(15,6) NOT NULL DEFAULT 1,

    -- Amounts
    subtotal_lkr                NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_total_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    freight_lkr                 NUMERIC(15,2) NOT NULL DEFAULT 0,
    other_charges_lkr           NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,

    subtotal_original           NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_original        NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- WHT
    wht_applicable              BOOLEAN NOT NULL DEFAULT FALSE,
    wht_total_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    wht_category                VARCHAR(100),

    -- 3-way match state (denormalized current state)
    match_mode                  VARCHAR(30) NOT NULL DEFAULT 'strict_3way',
    -- 'strict_3way','2way_po_bill','2way_grn_bill','no_match'
    match_status                VARCHAR(30) NOT NULL DEFAULT 'not_matched',
    -- 'not_matched','partial_match','matched','matched_with_variance','mismatched','waived'
    match_discrepancies_json    JSONB,
    -- [{"type":"price_variance","line_id":"...","expected":100,"actual":105,"delta_pct":5}, ...]
    match_waived_by             UUID,
    match_waived_at             TIMESTAMP WITH TIME ZONE,
    match_waive_reason          TEXT,

    -- Payment tracking (denormalized)
    amount_paid_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,
    amount_outstanding_lkr      NUMERIC(15,2) NOT NULL DEFAULT 0,
    payment_status              VARCHAR(20) NOT NULL DEFAULT 'unpaid',
    -- 'unpaid','partially_paid','paid','overpaid','disputed','on_hold'
    fully_paid_at               TIMESTAMP WITH TIME ZONE,

    fiscal_year                 INTEGER,
    period_number               INTEGER,

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','pending_approval','approved','posted','disputed','voided','cancelled'

    approval_required           BOOLEAN NOT NULL DEFAULT FALSE,
    approval_instance_id        UUID,

    journal_entry_id            UUID,

    -- Dispute
    disputed_at                 TIMESTAMP WITH TIME ZONE,
    dispute_reason              TEXT,
    disputed_by                 UUID,

    -- Void
    voided_at                   TIMESTAMP WITH TIME ZONE,
    voided_by                   UUID,
    void_reason                 TEXT,
    reversed_by_debit_note_id   UUID,

    payment_terms               VARCHAR(50),
    notes                       TEXT,
    internal_notes              TEXT,
    document_chain_json         JSONB,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, deleted_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_bills_tenant_number UNIQUE (tenant_id, bill_number),
    CONSTRAINT uk_bills_tenant_supplier_invoice UNIQUE (tenant_id, supplier_id, supplier_invoice_number)
);

bill_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    bill_id                     UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,

    line_number                 SMALLINT NOT NULL,
    source_po_line_id           UUID,
    source_grn_line_id          UUID,

    -- Item or expense
    line_type                   VARCHAR(20) NOT NULL DEFAULT 'item',
    -- 'item','expense','freight','other'
    item_id                     UUID,
    expense_account_id          UUID,  -- for direct-expense lines

    item_code                   VARCHAR(50),
    item_name                   VARCHAR(500),
    description                 TEXT,

    quantity                    NUMERIC(15,4),
    uom                         VARCHAR(20),
    unit_price                  NUMERIC(15,4),
    line_subtotal               NUMERIC(15,2) NOT NULL,

    discount_type               VARCHAR(20),
    discount_value              NUMERIC(15,4),
    discount_amount             NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Tax (Input VAT with eligible/ineligible flag)
    tax_code_id                 UUID,
    tax_rate                    NUMERIC(7,4),
    tax_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,
    is_vat_eligible             BOOLEAN NOT NULL DEFAULT TRUE,
    -- false = expensed instead of claimed
    sscl_applicable             BOOLEAN NOT NULL DEFAULT FALSE,
    sscl_amount                 NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- WHT per line
    wht_applicable              BOOLEAN NOT NULL DEFAULT FALSE,
    wht_tax_code_id             UUID,
    wht_rate                    NUMERIC(7,4),
    wht_category                VARCHAR(100),
    wht_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,

    line_total                  NUMERIC(15,2) NOT NULL,

    warehouse_id                UUID,
    batch_id                    UUID,
    serial_ids                  UUID[],

    cost_center_id              UUID,
    branch_id                   UUID,

    notes                       TEXT,

    created_at, updated_at
);

CREATE INDEX idx_bills_tenant_supplier ON bills (tenant_id, supplier_id, bill_date DESC);
CREATE INDEX idx_bills_tenant_status ON bills (tenant_id, status, bill_date DESC);
CREATE INDEX idx_bills_tenant_match_status ON bills (tenant_id, match_status)
    WHERE match_status NOT IN ('matched','waived');
CREATE INDEX idx_bills_tenant_payment_status ON bills (tenant_id, payment_status, due_date)
    WHERE status = 'posted';
CREATE INDEX idx_bills_due ON bills (tenant_id, due_date)
    WHERE status = 'posted' AND payment_status IN ('unpaid','partially_paid');
CREATE INDEX idx_bill_lines_bill ON bill_lines (tenant_id, bill_id, line_number);

ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bills FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON bill_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.5 Three-Way Match Results

Full history of match attempts (separate from current state on `bills`).

```sql
three_way_match_results (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    bill_id                     UUID NOT NULL REFERENCES bills(id),

    match_attempt_number        SMALLINT NOT NULL DEFAULT 1,
    match_mode                  VARCHAR(30) NOT NULL,
    -- 'strict_3way','2way_po_bill','2way_grn_bill','no_match'

    matched_po_ids              UUID[],
    matched_grn_ids             UUID[],

    -- Result
    match_result                VARCHAR(30) NOT NULL,
    -- 'matched','matched_with_variance','mismatched','no_source_docs','waived'

    discrepancies_json          JSONB,
    -- [
    --   {"type":"price_variance","bill_line_id":"...","po_line_id":"...","delta_pct":5},
    --   {"type":"quantity_variance","bill_line_id":"...","grn_line_id":"...","delta":-2},
    --   {"type":"tax_variance", ...},
    --   {"type":"item_mismatch", ...},
    --   {"type":"supplier_mismatch"},
    --   {"type":"missing_grn"},
    --   {"type":"missing_po"},
    --   {"type":"duplicate_bill"}
    -- ]

    variance_within_tolerance   BOOLEAN NOT NULL DEFAULT FALSE,
    tolerance_used_json         JSONB,  -- snapshot of thresholds used

    -- Resolution
    resolution                  VARCHAR(30),
    -- 'auto_matched','manually_matched','waived','rejected','remains_mismatched'
    resolved_by                 UUID,
    resolved_at                 TIMESTAMP WITH TIME ZONE,
    resolution_notes            TEXT,

    performed_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    performed_by                UUID,  -- NULL = system auto-match

    UNIQUE (tenant_id, bill_id, match_attempt_number)
);

CREATE INDEX idx_match_results_bill ON three_way_match_results (tenant_id, bill_id, match_attempt_number);
CREATE INDEX idx_match_results_unresolved ON three_way_match_results (tenant_id, resolution)
    WHERE resolution IS NULL;

ALTER TABLE three_way_match_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON three_way_match_results FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.6 Debit Notes

```sql
debit_notes (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    debit_note_number           VARCHAR(50) NOT NULL,

    supplier_id                 UUID NOT NULL,
    branch_id                   UUID NOT NULL,

    source_bill_id              UUID REFERENCES bills(id),
    reason_category             VARCHAR(50) NOT NULL,
    -- 'purchase_return','price_correction','short_delivery','damaged_goods',
    -- 'quality_issue','overcharge','duplicate_billing','other'
    reason_details              TEXT,

    -- Dates
    debit_note_date             DATE NOT NULL,
    posted_at                   TIMESTAMP WITH TIME ZONE,

    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate               NUMERIC(15,6) NOT NULL DEFAULT 1,

    -- Amounts
    subtotal_lkr                NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    grand_total_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Settlement tracking
    amount_settled_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,
    amount_remaining_lkr        NUMERIC(15,2) NOT NULL DEFAULT 0,
    settlement_status           VARCHAR(20) NOT NULL DEFAULT 'unsettled',
    -- 'unsettled','partially_settled','fully_settled'

    -- Stock return (if purchase return)
    is_stock_return             BOOLEAN NOT NULL DEFAULT FALSE,
    stock_posted                BOOLEAN NOT NULL DEFAULT FALSE,

    fiscal_year                 INTEGER,
    period_number               INTEGER,

    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','approved','issued','partially_settled','fully_settled','cancelled'

    approval_required           BOOLEAN NOT NULL DEFAULT FALSE,
    approval_instance_id        UUID,

    journal_entry_id            UUID,

    notes                       TEXT,
    document_chain_json         JSONB,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_debit_notes_tenant_number UNIQUE (tenant_id, debit_note_number)
);

debit_note_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    debit_note_id               UUID NOT NULL REFERENCES debit_notes(id) ON DELETE CASCADE,
    line_number                 SMALLINT NOT NULL,
    source_bill_line_id         UUID,
    item_id                     UUID,
    item_code                   VARCHAR(50),
    item_name                   VARCHAR(500),
    description                 TEXT,
    quantity                    NUMERIC(15,4),
    uom                         VARCHAR(20),
    unit_price                  NUMERIC(15,4),
    line_subtotal               NUMERIC(15,2) NOT NULL,
    tax_code_id                 UUID,
    tax_amount                  NUMERIC(15,2) NOT NULL DEFAULT 0,
    line_total                  NUMERIC(15,2) NOT NULL,
    warehouse_id                UUID,
    batch_id                    UUID,
    serial_ids                  UUID[],
    notes                       TEXT,
    created_at, updated_at
);

-- Partial split settlements supported
debit_note_settlements (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    debit_note_id               UUID NOT NULL REFERENCES debit_notes(id),

    settlement_method           VARCHAR(30) NOT NULL,
    -- 'adjust_against_future_bill','refund','write_off'
    amount_lkr                  NUMERIC(15,2) NOT NULL,

    -- Per method target
    applied_to_bill_id          UUID REFERENCES bills(id),  -- for 'adjust_against_future_bill'
    refund_receipt_id           UUID,  -- for 'refund' (money coming back from supplier)
    write_off_journal_entry_id  UUID,  -- for 'write_off'

    settled_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    settled_by                  UUID,
    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_debit_notes_tenant_supplier ON debit_notes (tenant_id, supplier_id, debit_note_date DESC);
CREATE INDEX idx_debit_notes_tenant_status ON debit_notes (tenant_id, status);
CREATE INDEX idx_debit_notes_unsettled ON debit_notes (tenant_id, supplier_id)
    WHERE settlement_status IN ('unsettled','partially_settled');
CREATE INDEX idx_debit_note_settlements_dn ON debit_note_settlements (tenant_id, debit_note_id);
CREATE INDEX idx_debit_note_settlements_bill ON debit_note_settlements (tenant_id, applied_to_bill_id)
    WHERE applied_to_bill_id IS NOT NULL;

ALTER TABLE debit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE debit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE debit_note_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON debit_notes FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON debit_note_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON debit_note_settlements FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.7 Payments (Outgoing)

```sql
payments (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    payment_number              VARCHAR(50) NOT NULL,

    supplier_id                 UUID,  -- nullable for batch payments to multiple suppliers
    branch_id                   UUID NOT NULL,
    paid_by                     UUID,

    payment_date                DATE NOT NULL,
    posted_at                   TIMESTAMP WITH TIME ZONE,

    -- Method
    payment_method              VARCHAR(30) NOT NULL,
    -- 'cash','cheque','bank_transfer','slips_batch','card','qr','online_gateway','other'

    -- Source (one of bank/cash/cheque)
    bank_account_id             UUID,
    cheque_id                   UUID,  -- references cheques(id) for cheque payments
    reference_number            VARCHAR(100),

    -- Currency
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate               NUMERIC(15,6) NOT NULL DEFAULT 1,

    -- Amounts
    amount_paid_lkr             NUMERIC(15,2) NOT NULL,          -- actual cash out
    amount_paid_original        NUMERIC(15,2) NOT NULL,
    wht_deducted_lkr            NUMERIC(15,2) NOT NULL DEFAULT 0,
    gross_amount_lkr            NUMERIC(15,2) NOT NULL,           -- total before WHT (= paid + WHT)

    -- Allocation tracking
    amount_allocated_lkr        NUMERIC(15,2) NOT NULL DEFAULT 0,
    amount_unallocated_lkr      NUMERIC(15,2) NOT NULL DEFAULT 0,
    is_fully_allocated          BOOLEAN NOT NULL DEFAULT FALSE,

    -- Advance indicator
    creates_supplier_advance    BOOLEAN NOT NULL DEFAULT FALSE,
    supplier_advance_id         UUID,

    -- Batch disbursement
    is_batch_payment            BOOLEAN NOT NULL DEFAULT FALSE,
    disbursement_file_id        UUID,  -- references disbursement_files table (Part 7)
    batch_reference             VARCHAR(100),

    fiscal_year                 INTEGER,
    period_number               INTEGER,

    status                      VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft','pending_approval','approved','posted','sent_to_bank','cleared','bounced','voided','reversed'

    approval_required           BOOLEAN NOT NULL DEFAULT FALSE,
    approval_instance_id        UUID,

    journal_entry_id            UUID,

    notes                       TEXT,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, deleted_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_payments_tenant_number UNIQUE (tenant_id, payment_number)
);

payment_allocations (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    payment_id                  UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,

    allocated_to_type           VARCHAR(30) NOT NULL,
    -- 'bill','supplier_advance','debit_note','loan','other'
    bill_id                     UUID REFERENCES bills(id),
    supplier_advance_id         UUID,
    debit_note_id               UUID REFERENCES debit_notes(id),

    -- Amount breakdown (WHT split)
    gross_amount_lkr            NUMERIC(15,2) NOT NULL,
    wht_amount_lkr              NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_amount_lkr              NUMERIC(15,2) NOT NULL,  -- cash portion (= gross - WHT)

    gross_amount_original       NUMERIC(15,2) NOT NULL,
    net_amount_original         NUMERIC(15,2) NOT NULL,

    -- For multi-supplier batch payments
    supplier_id                 UUID,
    allocation_date             DATE NOT NULL DEFAULT CURRENT_DATE,
    allocated_by                UUID,

    unallocated_at              TIMESTAMP WITH TIME ZONE,
    unallocated_by              UUID,
    unallocate_reason           TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_payment_alloc_target CHECK (
        (allocated_to_type = 'bill' AND bill_id IS NOT NULL)
        OR (allocated_to_type = 'supplier_advance' AND supplier_advance_id IS NOT NULL)
        OR (allocated_to_type = 'debit_note' AND debit_note_id IS NOT NULL)
        OR (allocated_to_type IN ('loan','other'))
    )
);

CREATE INDEX idx_payments_tenant_supplier ON payments (tenant_id, supplier_id, payment_date DESC)
    WHERE supplier_id IS NOT NULL;
CREATE INDEX idx_payments_tenant_status ON payments (tenant_id, status, payment_date DESC);
CREATE INDEX idx_payments_tenant_method ON payments (tenant_id, payment_method, payment_date DESC);
CREATE INDEX idx_payments_unallocated ON payments (tenant_id, supplier_id)
    WHERE is_fully_allocated = FALSE AND status = 'posted';
CREATE INDEX idx_payments_bank ON payments (tenant_id, bank_account_id, payment_date DESC);
CREATE INDEX idx_payment_allocations_payment ON payment_allocations (tenant_id, payment_id);
CREATE INDEX idx_payment_allocations_bill ON payment_allocations (tenant_id, bill_id) WHERE bill_id IS NOT NULL;

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON payment_allocations FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.8 Recurring Purchase Templates

Referenced by `buy-module-spec.md §11.5 (Recurring expense templates)` and `§17 (Recurring Purchases / Standing Orders)`. One template generates either POs (procurement-heavy flow) or Bills (direct expense flow) per a tenant-chosen schedule — tenant choice per template. Mirrors `recurring_invoice_templates` (sell-side §2.3 of this Part) and `recurring_journal_templates` (Part 4 §3.5).

```sql
recurring_purchase_templates (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Identity
    code                        VARCHAR(40) NOT NULL,          -- "MONTHLY_CLEANING_HQ"
    name                        VARCHAR(200) NOT NULL,
    description                 TEXT,

    -- What it generates
    generates                   VARCHAR(20) NOT NULL,
    -- 'purchase_order'    — creates draft or posted PO each cycle (procurement-heavy)
    -- 'bill'              — creates draft or posted Bill each cycle (direct expense, no PO)
    -- 'expense_claim'     — creates a petty-cash / expense-claim entry (small recurring outflows)

    -- Supplier
    supplier_id                 UUID NOT NULL REFERENCES suppliers(id),
    supplier_contact_id         UUID,                          -- REFERENCES supplier_contacts(id) — delivery contact

    -- Branch / scope
    branch_id                   UUID REFERENCES branches(id),
    cost_center_id              UUID,
    tag_id                      UUID REFERENCES tag_master(id),

    -- Currency (honours supplier default when null)
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',

    -- Lines (JSONB — small arrays; structure mirrors purchase_order_lines / bill_lines)
    lines_json                  JSONB NOT NULL,
    -- For generates='purchase_order' / 'bill':
    -- [{"item_id":"<uuid>","description":"...","quantity":1,"unit_price_lkr":100000,
    --   "uom":"month","tax_code_id":"...","expense_account_id":"..."}, ...]
    -- For generates='expense_claim':
    -- [{"expense_account_id":"...","description":"...","amount_lkr":15000,
    --   "tax_code_id":"...","wht_category":"..."}]

    -- Variable amount handling (§17.3 — utility / metered / contractor hours)
    amount_mode                 VARCHAR(20) NOT NULL DEFAULT 'fixed',
    -- 'fixed'       — lines_json amounts used as-is per cycle (auto-post eligible)
    -- 'variable'    — amounts entered per cycle before posting (never auto-post)
    -- 'cpi_indexed' — annual CPI adjustment
    -- 'formula'     — computed per cycle via formula_expression
    formula_expression          TEXT,
    cpi_annual_adjustment_pct   NUMERIC(5,2),

    -- Schedule
    frequency                   VARCHAR(20) NOT NULL,
    -- 'weekly','bi_weekly','monthly','bi_monthly','quarterly','half_yearly','yearly','custom_cron'
    custom_cron                 VARCHAR(40),
    day_of_month                SMALLINT,                      -- 1-28 or 31=last day
    day_of_week                 SMALLINT,                      -- 0=Sun..6=Sat for weekly/bi_weekly
    first_run_date              DATE NOT NULL,
    last_run_date               DATE,                          -- null = indefinite
    next_scheduled_at           DATE NOT NULL,
    occurrences_total           INTEGER,
    occurrences_generated       INTEGER NOT NULL DEFAULT 0,

    -- Reminder cadence (per §17.3 — reminder N days before run)
    reminder_days_before        SMALLINT NOT NULL DEFAULT 3,

    -- Posting mode
    auto_post                   BOOLEAN NOT NULL DEFAULT FALSE,
    -- TRUE only allowed when amount_mode='fixed'; enforced at write
    approval_required           BOOLEAN NOT NULL DEFAULT TRUE,

    -- Lifecycle
    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','paused','completed','cancelled'
    paused_at                   TIMESTAMP WITH TIME ZONE,
    paused_by                   UUID,
    paused_reason               TEXT,

    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_recurring_purchase_template_code UNIQUE (tenant_id, code),
    CONSTRAINT chk_rpt_generates CHECK (generates IN ('purchase_order','bill','expense_claim')),
    CONSTRAINT chk_rpt_amount_mode CHECK (amount_mode IN ('fixed','variable','cpi_indexed','formula')),
    CONSTRAINT chk_rpt_auto_post_fixed CHECK (auto_post = FALSE OR amount_mode = 'fixed'),
    CONSTRAINT chk_rpt_day_of_month CHECK (day_of_month IS NULL OR (day_of_month BETWEEN 1 AND 31)),
    CONSTRAINT chk_rpt_day_of_week CHECK (day_of_week IS NULL OR (day_of_week BETWEEN 0 AND 6)),
    CONSTRAINT chk_rpt_occurrences CHECK (
        occurrences_total IS NULL OR occurrences_generated <= occurrences_total
    )
);

CREATE INDEX idx_rpt_next_run ON recurring_purchase_templates
    (tenant_id, next_scheduled_at)
    WHERE status = 'active';
CREATE INDEX idx_rpt_supplier ON recurring_purchase_templates
    (tenant_id, supplier_id, status);
CREATE INDEX idx_rpt_reminder_due ON recurring_purchase_templates
    (tenant_id, next_scheduled_at)
    WHERE status = 'active' AND auto_post = FALSE;

ALTER TABLE recurring_purchase_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_purchase_templates FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Linkage on generation**: each generated document (`purchase_orders`, `bills`, or `expense_claims`) carries `source_type='recurring_purchase_template'` and `source_id=<template_id>` for traceability. The scheduler (Part 7 `scheduled_jobs`) advances `next_scheduled_at`, increments `occurrences_generated`, and optionally creates a reminder notification `reminder_days_before` the next run. For `amount_mode='variable'` the scheduler drops a draft into the review queue and sends a user notification; the accountant enters quantities/amounts before confirming.

**Guardrails**:
- `auto_post = TRUE` only valid when `amount_mode = 'fixed'` (enforced by CHECK).
- Edits to `lines_json` or `amount_mode` apply to future runs only; generated documents remain immutable per §10.
- Disabled suppliers (`suppliers.status != 'active'`) block generation; template surfaces an exception for the user to resolve.

---

## 5. Cheques (Unified Table)

```sql
cheques (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Identity
    cheque_number               VARCHAR(50) NOT NULL,
    cheque_book_id              UUID,   -- references cheque_books table (if tenant tracks books)
    direction                   VARCHAR(10) NOT NULL,
    -- 'issued' — outgoing (we pay)
    -- 'received' — incoming (they pay)

    -- Party
    party_type                  VARCHAR(20) NOT NULL,  -- 'supplier','customer','employee','other'
    supplier_id                 UUID,
    customer_id                 UUID,
    employee_id                 UUID,
    other_party_name            VARCHAR(200),

    -- Cheque details
    cheque_date                 DATE NOT NULL,
    amount_lkr                  NUMERIC(15,2) NOT NULL,
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',
    amount_original             NUMERIC(15,2) NOT NULL,

    -- Bank info
    bank_account_id             UUID,
    -- for issued: OUR bank account the cheque is drawn on
    -- for received: OUR bank account where we deposited

    drawee_bank_name            VARCHAR(100),
    -- for received: the customer's bank (who the cheque is drawn on)
    drawee_branch_name          VARCHAR(100),
    drawee_account_number       VARCHAR(50),

    payee_name                  VARCHAR(200),  -- for issued: who it's made out to

    -- Stamp duty
    stamp_duty_applicable       BOOLEAN NOT NULL DEFAULT FALSE,
    stamp_duty_amount_lkr       NUMERIC(15,2) DEFAULT 0,

    -- Status (9-state lifecycle)
    status                      VARCHAR(30) NOT NULL DEFAULT 'drafted',
    -- For issued: 'drafted','issued','presented_by_payee','cleared','bounced','cancelled','stale','reissued','replaced'
    -- For received: 'received','deposited','in_clearing','cleared','bounced','returned_to_customer','cancelled','stale','replaced_by_customer'

    -- State timestamps
    issued_at                   TIMESTAMP WITH TIME ZONE,
    handed_over_at              TIMESTAMP WITH TIME ZONE,      -- issued: given to payee
    deposited_at                TIMESTAMP WITH TIME ZONE,      -- received: deposited at bank
    presented_at                TIMESTAMP WITH TIME ZONE,      -- issued: payee presented to their bank
    in_clearing_at              TIMESTAMP WITH TIME ZONE,
    cleared_at                  TIMESTAMP WITH TIME ZONE,
    bounced_at                  TIMESTAMP WITH TIME ZONE,
    cancelled_at                TIMESTAMP WITH TIME ZONE,
    stale_at                    TIMESTAMP WITH TIME ZONE,
    reissued_at                 TIMESTAMP WITH TIME ZONE,
    replaced_at                 TIMESTAMP WITH TIME ZONE,
    replaced_by_cheque_id       UUID REFERENCES cheques(id),

    -- Cancellation / bounce
    cancellation_reason         TEXT,
    bounce_reason_code          VARCHAR(50),
    -- 'insufficient_funds','account_closed','post_dated','stale','signature_mismatch','stopped_payment','other'
    bounce_reason_details       TEXT,
    bounce_count                SMALLINT NOT NULL DEFAULT 0,  -- incremented on each bounce

    -- Source document linkage
    source_document_type        VARCHAR(30),  -- 'payment','receipt'
    source_payment_id           UUID REFERENCES payments(id),
    source_receipt_id           UUID REFERENCES receipts(id),

    -- Journal linkages
    journal_entry_id_issue      UUID,   -- JE at issue time
    journal_entry_id_clear      UUID,   -- JE at clear time
    journal_entry_id_bounce     UUID,   -- JE at bounce (reversal)

    -- Physical handling
    photo_url                   VARCHAR(500),  -- for received: photo of cheque front/back
    physical_location           VARCHAR(100),  -- where physical cheque is held

    -- Bounced Cheques Act tracking (for received cheques)
    legal_action_initiated      BOOLEAN NOT NULL DEFAULT FALSE,
    legal_action_date           DATE,
    legal_case_reference        VARCHAR(100),

    notes                       TEXT,
    internal_notes              TEXT,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_cheques_tenant_direction_number UNIQUE (tenant_id, direction, cheque_number, drawee_bank_name)
);

CREATE INDEX idx_cheques_tenant_direction_status ON cheques (tenant_id, direction, status, cheque_date DESC);
CREATE INDEX idx_cheques_tenant_customer ON cheques (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_cheques_tenant_supplier ON cheques (tenant_id, supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX idx_cheques_pending_clearance ON cheques (tenant_id, direction, cheque_date)
    WHERE status IN ('issued','presented_by_payee','deposited','in_clearing');
CREATE INDEX idx_cheques_bounced ON cheques (tenant_id, customer_id, bounced_at DESC)
    WHERE direction = 'received' AND status = 'bounced';
CREATE INDEX idx_cheques_stale_check ON cheques (tenant_id, cheque_date)
    WHERE status IN ('issued','presented_by_payee','deposited','in_clearing');

ALTER TABLE cheques ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cheques FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.1 Cheque Bounce Events

Separate table since a cheque can genuinely bounce multiple times across re-presentations.

```sql
cheque_bounce_events (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    cheque_id                   UUID NOT NULL REFERENCES cheques(id),

    bounce_number               SMALLINT NOT NULL,  -- 1st, 2nd, etc.
    bounced_at                  TIMESTAMP WITH TIME ZONE NOT NULL,
    bounce_reason_code          VARCHAR(50) NOT NULL,
    bounce_reason_details       TEXT,

    -- Bank charges from this bounce
    bank_charges_lkr            NUMERIC(15,2) DEFAULT 0,
    bank_charges_account_id     UUID,

    -- Customer notification (for received cheques)
    customer_notified_at        TIMESTAMP WITH TIME ZONE,
    notification_channel        VARCHAR(20),

    -- Reversal journal
    reversal_journal_entry_id   UUID,

    -- Re-presentation decision
    re_presented                BOOLEAN DEFAULT FALSE,
    re_presented_at             TIMESTAMP WITH TIME ZONE,

    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by                  UUID
);

CREATE INDEX idx_cheque_bounce_events_cheque ON cheque_bounce_events (tenant_id, cheque_id, bounce_number);

ALTER TABLE cheque_bounce_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cheque_bounce_events FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.2 Cheque Books (Optional — for tenants tracking books)

```sql
cheque_books (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    bank_account_id             UUID NOT NULL,

    book_reference              VARCHAR(50) NOT NULL,
    prefix                      VARCHAR(20),
    starting_number             BIGINT NOT NULL,
    ending_number               BIGINT NOT NULL,
    current_number              BIGINT NOT NULL,

    issued_date                 DATE,
    issued_by_bank_branch       VARCHAR(100),

    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','exhausted','cancelled','lost'

    notes                       TEXT,
    created_at, updated_at, ...
);

ALTER TABLE cheque_books ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cheque_books FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 6. Petty Cash

Referenced by `business-tenant-layer2-spec.md §7 Petty Cash Management`, `accounting-module-spec.md §13`, and `buy-module-spec.md §11.2`. Per-branch floats with ceilings, voucher-based disbursements (expense / advance / top-up / return / adjustment), full transaction ledger, and integration with `expense_claims.petty_cash_voucher_id` (Part 6 §12). All petty-cash activity posts to GL via `journal_entries` (Part 4).

### 6.1 Petty Cash Floats

One row per branch per named float. SL shops typically keep one per branch (ceiling LKR 20k–100k) and top up from the main bank account when the balance drops near the minimum.

```sql
petty_cash_floats (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Identity
    branch_id                   UUID NOT NULL REFERENCES branches(id),
    name                        VARCHAR(100) NOT NULL,      -- "Colombo-2 float", "Main branch"
    code                        VARCHAR(40) NOT NULL,       -- short key

    -- GL linkage
    account_id                  UUID NOT NULL REFERENCES chart_of_accounts(id),
    -- the Petty Cash asset account; typically one per float for clean branch-level reconciliation
    top_up_source_account_id    UUID REFERENCES chart_of_accounts(id),
    -- default bank/cash account funded from

    -- Float parameters
    ceiling_lkr                 NUMERIC(15,2) NOT NULL,     -- maximum balance allowed
    top_up_trigger_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,
    -- when balance drops to this or below, float flagged for top-up

    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',

    -- Current state (denormalized for fast dashboard; authoritative source is sum of transactions)
    current_balance_lkr         NUMERIC(15,2) NOT NULL DEFAULT 0,
    last_transaction_at         TIMESTAMP WITH TIME ZONE,

    -- Custodian
    custodian_user_id           UUID REFERENCES users(id),
    custodian_since             DATE,

    -- Status
    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','suspended','closed'
    opened_at                   DATE NOT NULL,
    closed_at                   DATE,
    closed_reason               TEXT,
    closing_balance_lkr         NUMERIC(15,2),              -- amount returned to source on closure

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_petty_cash_float_code UNIQUE (tenant_id, code),
    CONSTRAINT uk_petty_cash_float_branch_name UNIQUE (tenant_id, branch_id, name),
    CONSTRAINT chk_petty_cash_ceiling CHECK (ceiling_lkr > 0),
    CONSTRAINT chk_petty_cash_trigger CHECK (top_up_trigger_lkr >= 0 AND top_up_trigger_lkr < ceiling_lkr)
);

CREATE INDEX idx_petty_cash_float_branch ON petty_cash_floats (tenant_id, branch_id, status);
CREATE INDEX idx_petty_cash_float_custodian ON petty_cash_floats (tenant_id, custodian_user_id)
    WHERE status = 'active';
CREATE INDEX idx_petty_cash_float_top_up_due ON petty_cash_floats (tenant_id, branch_id)
    WHERE status = 'active' AND current_balance_lkr <= top_up_trigger_lkr;

ALTER TABLE petty_cash_floats ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petty_cash_floats FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 6.2 Petty Cash Vouchers

Every disbursement or settlement creates a voucher. Advances (employee borrows against future expense) stay open with `advance_balance_lkr > 0` until receipts come in and settle them.

```sql
petty_cash_vouchers (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    float_id                    UUID NOT NULL REFERENCES petty_cash_floats(id),

    -- Numbering (uses number_series per §7)
    voucher_number              VARCHAR(50) NOT NULL,
    voucher_date                DATE NOT NULL,

    -- Purpose
    purpose                     VARCHAR(30) NOT NULL,
    -- 'expense'      — direct expense disbursement with receipt in hand
    -- 'advance'      — cash given out; settlement pending
    -- 'top_up'       — incoming from bank/main cash (increases float)
    -- 'return'       — custodian returns cash to source (decreases float)
    -- 'adjustment'   — variance correction (shortage/overage)
    -- 'close_out'    — final balance return on float closure

    -- Payee (who received the cash; null for top_up / close_out)
    payee_type                  VARCHAR(20),
    -- 'employee','supplier','other','self'
    payee_employee_id           UUID REFERENCES employees(id),
    payee_supplier_id           UUID REFERENCES suppliers(id),
    payee_name                  VARCHAR(200),       -- free-text when not linked to master
    payee_nic                   VARCHAR(20),

    -- Amount
    amount_lkr                  NUMERIC(15,2) NOT NULL,
    is_inflow                   BOOLEAN NOT NULL,
    -- TRUE for top_up; FALSE for expense/advance/return/close_out; signed for adjustment

    -- GL dimension (for expense type — maps to expense account)
    expense_account_id          UUID REFERENCES chart_of_accounts(id),
    tax_code_id                 UUID REFERENCES tax_codes(id),
    branch_id                   UUID REFERENCES branches(id),
    cost_center_id              UUID,
    tag_id                      UUID REFERENCES tag_master(id),

    -- Source linkage
    source_type                 VARCHAR(30),
    -- 'manual','expense_claim','bill_allocation','reimbursement'
    expense_claim_id            UUID REFERENCES expense_claims(id),
    bill_id                     UUID REFERENCES bills(id),
    journal_entry_id            UUID REFERENCES journal_entries(id),

    -- Description + supporting docs
    description                 TEXT NOT NULL,
    receipt_count               SMALLINT NOT NULL DEFAULT 0,
    receipts_json               JSONB,                      -- array of document_ids (Part 7)

    -- State
    status                      VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft','pending_approval','approved','disbursed','settled','voided'
    initiated_by                UUID NOT NULL REFERENCES users(id),
    approved_by                 UUID REFERENCES users(id),
    approved_at                 TIMESTAMP WITH TIME ZONE,
    disbursed_at                TIMESTAMP WITH TIME ZONE,
    settled_at                  TIMESTAMP WITH TIME ZONE,

    -- Advance tracking (purpose='advance' only)
    is_advance                  BOOLEAN NOT NULL DEFAULT FALSE,
    advance_balance_lkr         NUMERIC(15,2),              -- outstanding; settled via receipts → expense voucher
    advance_settled_via         UUID REFERENCES petty_cash_vouchers(id),  -- pointer to settlement voucher

    -- Approval
    approval_instance_id        UUID REFERENCES approval_instances(id),

    -- Void
    void_reason                 TEXT,
    voided_by                   UUID REFERENCES users(id),
    voided_at                   TIMESTAMP WITH TIME ZONE,

    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_petty_cash_voucher_number UNIQUE (tenant_id, voucher_number),
    CONSTRAINT chk_petty_cash_voucher_amount CHECK (amount_lkr > 0),
    CONSTRAINT chk_petty_cash_advance_balance CHECK (
        NOT is_advance OR advance_balance_lkr IS NOT NULL
    )
);

CREATE INDEX idx_pcv_float_date ON petty_cash_vouchers (tenant_id, float_id, voucher_date DESC);
CREATE INDEX idx_pcv_status ON petty_cash_vouchers (tenant_id, status, voucher_date DESC);
CREATE INDEX idx_pcv_payee_employee ON petty_cash_vouchers (tenant_id, payee_employee_id)
    WHERE payee_employee_id IS NOT NULL;
CREATE INDEX idx_pcv_open_advances ON petty_cash_vouchers (tenant_id, payee_employee_id)
    WHERE is_advance = TRUE AND advance_balance_lkr > 0;
CREATE INDEX idx_pcv_expense_claim ON petty_cash_vouchers (tenant_id, expense_claim_id)
    WHERE expense_claim_id IS NOT NULL;

ALTER TABLE petty_cash_vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petty_cash_vouchers FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 6.3 Petty Cash Transactions (Ledger)

Immutable ledger — every state change that moves cash writes a row. Balance-of-float at any point derives from `SUM(amount_lkr * direction)` filtered by date.

```sql
petty_cash_transactions (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    float_id                    UUID NOT NULL REFERENCES petty_cash_floats(id),
    voucher_id                  UUID REFERENCES petty_cash_vouchers(id),

    transaction_date            DATE NOT NULL,
    transaction_time            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    transaction_type            VARCHAR(30) NOT NULL,
    -- 'top_up','disbursement','advance','advance_settlement','return','adjustment','close_out','reversal'

    -- Signed amount (+ = inflow to float; - = outflow from float)
    amount_lkr                  NUMERIC(15,2) NOT NULL,
    running_balance_lkr         NUMERIC(15,2) NOT NULL,     -- balance after this row

    -- GL linkage
    counter_account_id          UUID REFERENCES chart_of_accounts(id),
    journal_entry_id            UUID REFERENCES journal_entries(id),

    -- Reference metadata
    description                 TEXT,
    reference_type              VARCHAR(30),
    -- 'voucher','expense_claim','manual_adjustment','top_up','close_out','reversal'
    reference_id                UUID,

    -- Reversal linkage
    reverses_transaction_id     UUID REFERENCES petty_cash_transactions(id),
    reversed_by_transaction_id  UUID REFERENCES petty_cash_transactions(id),

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by                  UUID NOT NULL,

    CONSTRAINT chk_pct_amount_nonzero CHECK (amount_lkr <> 0)
);

-- Partition monthly by transaction_date
CREATE INDEX idx_pct_float_date ON petty_cash_transactions
    (tenant_id, float_id, transaction_date DESC, transaction_time DESC);
CREATE INDEX idx_pct_voucher ON petty_cash_transactions
    (tenant_id, voucher_id)
    WHERE voucher_id IS NOT NULL;
CREATE INDEX idx_pct_journal ON petty_cash_transactions
    (tenant_id, journal_entry_id)
    WHERE journal_entry_id IS NOT NULL;

ALTER TABLE petty_cash_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petty_cash_transactions FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Immutability: block UPDATE/DELETE except for a narrow set of denormalized columns
CREATE OR REPLACE FUNCTION petty_cash_transactions_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Cannot delete petty cash transaction. Post a reversal instead.';
    END IF;
    RAISE EXCEPTION 'Cannot modify petty cash transaction. Post a reversal instead.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_petty_cash_transactions_immutable
    BEFORE UPDATE OR DELETE ON petty_cash_transactions
    FOR EACH ROW EXECUTE FUNCTION petty_cash_transactions_immutable();
```

### 6.4 End-of-Day Reconciliation

Per `business-tenant-layer2-spec.md §7.5`, each branch performs an end-of-day count. Variance (physical count vs `petty_cash_floats.current_balance_lkr`) generates an `adjustment` voucher with reason code, which in turn writes a `petty_cash_transactions` row tagged `transaction_type='adjustment'` and posts a journal (DR/CR Cash Shortage/Overage account).

### 6.5 Posting Patterns

| Event | Petty cash tx | Journal entry |
|---|---|---|
| **Top-up from bank** | `+amount_lkr` to float | `DR Petty Cash` / `CR Bank` |
| **Expense disbursement** | `-amount_lkr` from float | `DR Expense` (+ `DR Input VAT` if applicable) / `CR Petty Cash` |
| **Advance to employee** | `-amount_lkr` from float | `DR Employee Advance Receivable` / `CR Petty Cash` |
| **Advance settlement (receipts match advance)** | No tx on float | `DR Expense` / `CR Employee Advance Receivable` |
| **Advance settlement (receipts < advance)** | `+difference` (employee refund) | `DR Expense + DR Petty Cash` / `CR Employee Advance Receivable` |
| **Advance settlement (receipts > advance)** | `-difference` (additional payout) | `DR Expense` / `CR Employee Advance Receivable + CR Petty Cash` |
| **Return to source** | `-amount_lkr` from float | `DR Bank` / `CR Petty Cash` |
| **Shortage adjustment** | `-variance` from float | `DR Cash Shortage` / `CR Petty Cash` |
| **Overage adjustment** | `+variance` to float | `DR Petty Cash` / `CR Cash Overage` |
| **Float closure** | `-closing_balance_lkr` from float | `DR Bank / Cash` / `CR Petty Cash` |

All postings route through the Common Posting Orchestration (§11) in a single DB transaction — partial posting not allowed.

---

## 7. Approval Workflow Linkages

### 7.1 Approval Instances

```sql
approval_instances (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    document_type               VARCHAR(50) NOT NULL,
    -- 'purchase_requisition','purchase_order','bill','payment','journal_entry',
    -- 'quotation','sales_order','invoice','credit_note','debit_note','role_change',
    -- 'pricing_change','discount_waiver','void_request'
    document_id                 UUID NOT NULL,
    document_number             VARCHAR(50),  -- denormalized for dashboards

    workflow_template_id        UUID,         -- references approval_workflow_templates (Part 7)
    workflow_name_snapshot      VARCHAR(200), -- denormalized

    -- Amount context (for threshold-based workflows)
    amount_lkr                  NUMERIC(15,2),

    status                      VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending','approved','rejected','cancelled','expired','escalated'

    current_step_number         SMALLINT NOT NULL DEFAULT 1,
    total_steps                 SMALLINT NOT NULL,

    initiated_by                UUID NOT NULL,
    initiated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at                TIMESTAMP WITH TIME ZONE,
    completion_outcome          VARCHAR(20),  -- 'approved','rejected','cancelled','auto_approved'

    cancelled_by                UUID,
    cancelled_at                TIMESTAMP WITH TIME ZONE,
    cancel_reason               TEXT,

    escalated_at                TIMESTAMP WITH TIME ZONE,
    escalation_reason           VARCHAR(100),

    expires_at                  TIMESTAMP WITH TIME ZONE,

    notes                       TEXT,

    created_at, updated_at
);

CREATE INDEX idx_approval_instances_tenant_status ON approval_instances (tenant_id, status);
CREATE INDEX idx_approval_instances_document ON approval_instances (tenant_id, document_type, document_id);
CREATE INDEX idx_approval_instances_pending ON approval_instances (tenant_id, status, initiated_at)
    WHERE status = 'pending';
CREATE INDEX idx_approval_instances_initiator ON approval_instances (tenant_id, initiated_by, initiated_at DESC);

ALTER TABLE approval_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_instances FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 7.2 Approval Steps

```sql
approval_steps (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    approval_instance_id        UUID NOT NULL REFERENCES approval_instances(id) ON DELETE CASCADE,

    step_number                 SMALLINT NOT NULL,

    -- Target approver (one of these populated)
    approver_user_id            UUID,         -- specific user
    approver_role_id            UUID,         -- any user in role
    approver_type               VARCHAR(30) NOT NULL DEFAULT 'user',
    -- 'user','role','delegate','auto'

    -- Configuration
    is_parallel                 BOOLEAN NOT NULL DEFAULT FALSE,
    -- multiple approvers at same step (all must approve or any one?)
    parallel_logic              VARCHAR(20),  -- 'all','any','majority'

    step_label                  VARCHAR(100),

    -- Execution
    status                      VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending','approved','rejected','skipped','delegated','expired','not_yet_required'

    acted_by                    UUID,
    acted_at                    TIMESTAMP WITH TIME ZONE,
    comments                    TEXT,

    -- Delegation
    delegated_to                UUID,
    delegated_at                TIMESTAMP WITH TIME ZONE,
    delegation_reason           TEXT,

    -- Skip logic (auto-skip rules, e.g. when approver = initiator)
    skipped_reason              VARCHAR(100),

    -- Escalation
    escalation_due_at           TIMESTAMP WITH TIME ZONE,
    escalated_to_step_id        UUID,

    created_at, updated_at,

    CONSTRAINT chk_approval_step_approver CHECK (
        approver_user_id IS NOT NULL
        OR approver_role_id IS NOT NULL
        OR approver_type = 'auto'
    )
);

CREATE INDEX idx_approval_steps_instance ON approval_steps (tenant_id, approval_instance_id, step_number);
CREATE INDEX idx_approval_steps_pending_user ON approval_steps (tenant_id, approver_user_id)
    WHERE status = 'pending' AND approver_user_id IS NOT NULL;
CREATE INDEX idx_approval_steps_pending_role ON approval_steps (tenant_id, approver_role_id)
    WHERE status = 'pending' AND approver_role_id IS NOT NULL;

ALTER TABLE approval_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_steps FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 8. Document Numbering

### 8.1 Number Series

```sql
number_series (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    document_type               VARCHAR(50) NOT NULL,
    -- 'invoice','quotation','sales_order','delivery_note','receipt','credit_note',
    -- 'purchase_requisition','purchase_order','grn','bill','debit_note','payment',
    -- 'journal_entry','proforma','recurring_template','cheque','pos_invoice',
    -- 'pos_shift','pos_z_report'

    branch_id                   UUID,     -- NULL for tenant-wide series
    fiscal_year                 INTEGER,  -- NULL for cross-year; populated for yearly-reset

    prefix                      VARCHAR(20),
    suffix                      VARCHAR(20),
    pattern                     VARCHAR(100) NOT NULL,
    -- Tokens: {prefix},{suffix},{branch_code},{YYYY},{YY},{MM},{seq:N}
    -- Example: "INV-{branch_code}-{YYYY}-{seq:5}" → "INV-PETTAH-2026-00047"

    current_number              BIGINT NOT NULL DEFAULT 0,
    padding_length              SMALLINT NOT NULL DEFAULT 5,

    -- Reset behavior
    reset_frequency             VARCHAR(20) NOT NULL DEFAULT 'never',
    -- 'never','yearly','monthly','quarterly'
    last_reset_at               TIMESTAMP WITH TIME ZONE,
    last_reset_year             INTEGER,
    last_reset_month            SMALLINT,

    -- Status
    is_default                  BOOLEAN NOT NULL DEFAULT FALSE,  -- default for this doc type + branch combo
    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','inactive','archived'

    -- Preview fields (for UI)
    last_generated_number       VARCHAR(50),

    created_at, updated_at, created_by, updated_by, version_row INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_number_series UNIQUE (tenant_id, document_type, branch_id, fiscal_year)
);

CREATE INDEX idx_number_series_lookup ON number_series (tenant_id, document_type, branch_id)
    WHERE status = 'active';

ALTER TABLE number_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON number_series FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 8.2 Number Generation Function

```sql
CREATE OR REPLACE FUNCTION generate_document_number(
    p_tenant_id UUID,
    p_document_type VARCHAR,
    p_branch_id UUID,
    p_fiscal_year INTEGER
) RETURNS VARCHAR AS $$
DECLARE
    v_series RECORD;
    v_new_number BIGINT;
    v_formatted VARCHAR;
BEGIN
    -- Row-lock the series to prevent concurrent number collision
    SELECT * INTO v_series
    FROM number_series
    WHERE tenant_id = p_tenant_id
      AND document_type = p_document_type
      AND (branch_id = p_branch_id OR branch_id IS NULL)
      AND (fiscal_year = p_fiscal_year OR fiscal_year IS NULL)
      AND status = 'active'
    ORDER BY branch_id NULLS LAST, fiscal_year NULLS LAST
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active number series for tenant %, type %', p_tenant_id, p_document_type;
    END IF;

    -- Increment
    UPDATE number_series
    SET current_number = current_number + 1,
        updated_at = NOW()
    WHERE id = v_series.id
    RETURNING current_number INTO v_new_number;

    -- Apply pattern (simplified; real impl does token substitution)
    v_formatted := REPLACE(v_series.pattern, '{seq:5}', LPAD(v_new_number::TEXT, v_series.padding_length, '0'));
    -- ... more token substitutions

    RETURN v_formatted;
END;
$$ LANGUAGE plpgsql;
```

Numbers are assigned at **draft creation**. Gap risk from deletions is accepted (consistent with SL tax authority practice).

---

## 9. Inter-Document Linkage

### 9.1 Document Links

```sql
document_links (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    from_document_type          VARCHAR(50) NOT NULL,
    from_document_id            UUID NOT NULL,
    to_document_type            VARCHAR(50) NOT NULL,
    to_document_id              UUID NOT NULL,

    link_type                   VARCHAR(30) NOT NULL,
    -- 'source' — to_doc is derived from from_doc (quote → SO)
    -- 'reference' — non-causal link (invoice references customer PO number)
    -- 'reverses' — to_doc reverses from_doc (credit note reverses invoice)
    -- 'replaces' — to_doc supersedes from_doc (reissued cheque)
    -- 'consolidates' — from_doc is one source of a consolidated to_doc
    -- 'splits' — from_doc splits into multiple to_docs
    -- 'matches' — three-way match linkage

    -- Partial / split tracking
    quantity_linked             NUMERIC(15,4),  -- portion of from_doc represented in to_doc
    amount_linked               NUMERIC(15,2),

    -- Metadata
    sort_order                  SMALLINT DEFAULT 0,
    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by                  UUID,

    CONSTRAINT uk_document_links UNIQUE (from_document_type, from_document_id, to_document_type, to_document_id, link_type)
);

CREATE INDEX idx_document_links_from ON document_links (tenant_id, from_document_type, from_document_id);
CREATE INDEX idx_document_links_to ON document_links (tenant_id, to_document_type, to_document_id);
CREATE INDEX idx_document_links_type ON document_links (tenant_id, link_type);

ALTER TABLE document_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_links FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 10. Immutability Enforcement (Posted Transactions)

All transaction headers + lines follow this pattern once posted:

```sql
CREATE OR REPLACE FUNCTION prevent_posted_document_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'posted' AND NEW.status = 'posted' THEN
        -- Allow only void/lock flag transitions
        IF NEW.locked IS DISTINCT FROM OLD.locked
           OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
           OR NEW.amount_paid_lkr IS DISTINCT FROM OLD.amount_paid_lkr
           OR NEW.amount_outstanding_lkr IS DISTINCT FROM OLD.amount_outstanding_lkr
           OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
            -- Payment tracking fields updates allowed
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Cannot modify posted %. Void and reissue instead.', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all posted-transaction tables: invoices, bills, receipts, payments,
-- credit_notes, debit_notes, goods_received_notes, journal_entries
```

Voiding a posted document creates a paired reversal document (e.g., credit note reverses invoice) and toggles status to `voided` with audit trail.

---

## 11. Common Posting Orchestration

When a transaction transitions to `status = 'posted'`, a transaction orchestrator coordinates:

1. **Validate** period is open (trigger check — Part 4)
2. **Generate journal entry** with appropriate lines (per patterns in Part 4 §7)
3. **Post stock movements** to stock_ledger (if applicable — invoice, GRN, DN, credit note, debit note)
4. **Update denormalized fields** (amount_paid_lkr on invoice when receipt allocated, etc.)
5. **Recalculate downstream aggregates** (customer AR balance, supplier AP balance)
6. **Trigger notifications** (Part 7)
7. **Update materialized views** (account_balances_current, stock_balance_current — incremental)
8. **Emit event** (for integrations, webhooks, future event-sourcing)

All steps within a single DB transaction — partial posting not allowed.

---

## 12. Next Parts

- **Part 6 — Payroll & HR**: employees, salary structures, payroll runs, leave, loans, bonuses, statutory returns
- **Part 7 — System**: audit log, document storage, notifications, workflow templates, integrations, plans, disbursement files
- **Part 8 — Performance & ERDs**: indexes, partitioning, materialized views, Mermaid diagrams, RLS examples

---

*Document version: 1.0 · Part 5/8 · Transactions · Scope: Sri Lanka only · Full system (not MVP)*

*Decisions locked in Round 5: quotations with versioning (states: draft→sent→viewed→accepted→rejected→expired→converted→revised); sales_orders with fulfilment tracking and on_hold+reason_code for credit blocks; invoices as canonical table with origin_mode discriminator for 5 modes (standard/batch/consolidated/from-recurring/from-proforma/pos), plus separate recurring_invoice_templates and proforma_invoices tables that don't post to GL; delivery_notes always created (even when combined) for consistent stock audit; credit_notes with source_invoice_id + stock return + VAT relief workflows; receipts as header+allocations (many-to-many with invoices), partial allocation to customer_advances supported; POS with terminals/shifts/parked_sales/z_reports, denomination-level open+close, sync_source flag on invoices for offline-sourced; purchase_requisitions with source_pr_ids UUID[] array enabling many-to-one PR→PO consolidation; purchase_orders with full supplier ack + partial receipt tracking; goods_received_notes with all 6 quantity fields (ordered/received/accepted/rejected/damaged/pending_return) and 4 discrepancy flags + landed cost lock; bills with denormalized 3-way match state + separate three_way_match_results history table (8 discrepancy types, 6 match states); debit_notes with header+lines+settlements (partial splits across refund/adjust/write-off allowed); payments with WHT split in allocations, batch payments with disbursement_file_id; recurring_purchase_templates generating PO / Bill / expense_claim on 8 frequencies (weekly through yearly plus custom_cron) with 4 amount modes (fixed / variable / cpi_indexed / formula), auto-post only allowed for fixed mode, configurable reminder lead time, pause/resume lifecycle, polymorphic source_type linkage on generated documents; cheques unified table (direction enum) with 9-state lifecycle per direction, separate cheque_bounce_events for multi-bounce tracking, embedded stamp duty fields; petty_cash_floats per-branch with ceiling + top-up trigger + custodian tracking, petty_cash_vouchers with 6 purposes (expense/advance/top_up/return/adjustment/close_out) + advance balance tracking + settlement linkage, immutable petty_cash_transactions ledger with reversal pairs + running balance + end-of-day reconciliation via adjustment vouchers + full GL posting map; approval_instances + approval_steps as generic wrapper with denormalized approval_instance_id on documents; number_series with tenant-configurable patterns, number at draft creation (gap risk accepted); document_links for many-to-many + non-causal cross-references.*
