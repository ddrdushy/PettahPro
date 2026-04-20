# Data Model — Part 4: Accounting

> The general ledger engine. Chart of Accounts, journal entries (the spine of all financial postings), tax codes with effective dating, fiscal periods with 2-tier locking, and multi-currency FX handling. Every other module (Sell, Buy, Payroll, Inventory) posts through the entities defined here. Extends Parts 1-3. Target: Sri Lanka only. Scope: full system.

---

## 1. Scope

Defines:
- `chart_of_accounts` + materialized balance views (`account_balances_current`, `account_balances_period`)
- `tag_master` (tenant-defined dimensional tags)
- `journal_entries` + `journal_lines` (the GL posting engine)
- `recurring_journal_templates` (scheduled recurring journal generation)
- `tax_codes` + `tax_rules` (VAT, SSCL, WHT, stamp duty with effective-dated rates)
- `fiscal_years` + `fiscal_periods` + `period_reopening_log` (2-tier lock model)
- `exchange_rates` + `fx_revaluations` (multi-currency support)
- `fixed_asset_categories` + `fixed_assets` + `depreciation_schedules` + `fixed_asset_events` (asset register with parallel book + tax depreciation)
- `budgets` + `budget_lines` (per-account per-month budgets with variance reporting)
- `bank_statements` + `bank_statement_lines` + `bank_reconciliations` + `bank_reconciliation_matches` (upload-based bank reconciliation workflow)
- `bad_debt_writeoffs` + `bad_debt_recoveries` (customer write-off with VAT bad-debt relief and recovery lifecycle)

All tables tenant-scoped via RLS. All financial entries immutable once posted.

---

## 2. Chart of Accounts

### 2.1 Schema

Hierarchical with unlimited depth. Supports control accounts (rollups) and posting accounts (direct journal targets).

```sql
chart_of_accounts (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    -- Identity
    code                       VARCHAR(30) NOT NULL,  -- "1000","1100","1101" — tenant-configurable pattern
    name                       VARCHAR(200) NOT NULL,

    -- Classification
    account_type               VARCHAR(20) NOT NULL,
    -- 'asset','liability','equity','income','expense'
    account_subtype            VARCHAR(50),
    -- 'current_asset','fixed_asset','current_liability','long_term_liability',
    -- 'operating_income','operating_expense','non_operating','cost_of_goods_sold', etc.

    -- Hierarchy
    parent_account_id          UUID REFERENCES chart_of_accounts(id),
    depth_level                SMALLINT NOT NULL DEFAULT 0,
    path                       VARCHAR(1000),  -- materialized path "Assets/Current/Bank/BOC Current"

    -- Behavior flags
    is_system_required         BOOLEAN NOT NULL DEFAULT FALSE,
    -- cannot delete; rename and code editable only
    is_control_account         BOOLEAN NOT NULL DEFAULT FALSE,
    -- rolls up children; cannot be directly posted to
    is_posting_account         BOOLEAN NOT NULL DEFAULT TRUE,
    -- can receive direct journal entries

    -- Cash / Bank designation
    is_bank_account            BOOLEAN NOT NULL DEFAULT FALSE,
    is_cash_account            BOOLEAN NOT NULL DEFAULT FALSE,
    bank_name                  VARCHAR(100),
    bank_branch                VARCHAR(100),
    bank_account_number        VARCHAR(50),
    bank_file_format           VARCHAR(30),  -- 'commercial','hnb','sampath','boc','peoples','ndb','nsb','slips'

    -- Tax-related flags
    default_tax_code_id        UUID,
    is_vat_input               BOOLEAN NOT NULL DEFAULT FALSE,
    is_vat_output              BOOLEAN NOT NULL DEFAULT FALSE,
    is_wht_payable             BOOLEAN NOT NULL DEFAULT FALSE,
    is_wht_receivable          BOOLEAN NOT NULL DEFAULT FALSE,

    -- AR/AP control account flags (for customer/supplier subledger)
    is_ar_control              BOOLEAN NOT NULL DEFAULT FALSE,
    is_ap_control              BOOLEAN NOT NULL DEFAULT FALSE,
    is_inventory_control       BOOLEAN NOT NULL DEFAULT FALSE,

    -- Statutory / reporting
    statutory_category         VARCHAR(50),
    -- maps to SL financial statement categories + VAT return boxes
    normal_balance             VARCHAR(10) NOT NULL,
    -- 'debit','credit' — for validation

    -- Multi-currency
    currency                   CHAR(3) NOT NULL DEFAULT 'LKR',
    is_multi_currency          BOOLEAN NOT NULL DEFAULT FALSE,
    -- true allows postings in multiple currencies (typical for customer/supplier control accounts)

    -- Fixed Assets linkage (for individual asset accounts)
    is_fixed_asset_account     BOOLEAN NOT NULL DEFAULT FALSE,
    fixed_asset_category       VARCHAR(50),
    -- 'building','machinery','vehicle','furniture','computer','intangible','other'

    -- Status
    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','inactive','archived','merged'

    archived_at                TIMESTAMP WITH TIME ZONE,
    merged_into_account_id     UUID REFERENCES chart_of_accounts(id),
    merged_at                  TIMESTAMP WITH TIME ZONE,

    -- Opening balance tracking
    opening_balance_lkr        NUMERIC(15,2) NOT NULL DEFAULT 0,
    opening_balance_date       DATE,
    opening_balance_posted     BOOLEAN NOT NULL DEFAULT FALSE,

    narration                  TEXT,
    tags                       JSONB,

    created_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                 TIMESTAMP WITH TIME ZONE,
    created_by                 UUID,
    updated_by                 UUID,
    version                    INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_coa_tenant_code UNIQUE (tenant_id, code),
    CONSTRAINT chk_coa_posting_or_control CHECK (
        (is_posting_account = TRUE AND is_control_account = FALSE)
        OR (is_posting_account = FALSE AND is_control_account = TRUE)
        OR (is_posting_account = FALSE AND is_control_account = FALSE AND is_system_required = TRUE)
    )
);

CREATE INDEX idx_coa_tenant_type_status ON chart_of_accounts (tenant_id, account_type, status);
CREATE INDEX idx_coa_tenant_parent ON chart_of_accounts (tenant_id, parent_account_id);
CREATE INDEX idx_coa_tenant_bank ON chart_of_accounts (tenant_id, is_bank_account) WHERE is_bank_account = TRUE;
CREATE INDEX idx_coa_tenant_path ON chart_of_accounts (tenant_id, path);
CREATE INDEX idx_coa_search ON chart_of_accounts USING GIN (name gin_trgm_ops);

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chart_of_accounts
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.2 System-Required Accounts (Seeded on Tenant Creation)

Auto-seeded from `industry_templates.default_coa_json`. Standard SL chart includes (non-exhaustive):

**Assets**
- Cash in Hand / Petty Cash
- Bank Accounts (placeholder — tenant configures actual banks)
- Accounts Receivable (control)
- Customer Advances Paid
- Inventory (control)
- Input VAT Receivable
- WHT Receivable
- Fixed Assets (control)
- Accumulated Depreciation (contra)

**Liabilities**
- Accounts Payable (control)
- Supplier Advances Received
- Output VAT Payable
- SSCL Payable
- WHT Payable
- PAYE Payable
- EPF Employee Payable / EPF Employer Payable
- ETF Payable
- Customer Advances Received
- Bank Loans

**Equity**
- Owner's Capital
- Retained Earnings
- Current Year Profit/Loss

**Income**
- Sales Revenue
- Service Revenue
- Other Income
- Realized FX Gain

**Expenses**
- Cost of Goods Sold
- Rent Expense
- Salary Expense
- EPF/ETF Employer Expense
- Depreciation Expense
- Realized FX Loss
- Purchase Variance
- Cash Over/Short

System-required accounts have `is_system_required = TRUE` and can't be deleted, merged, or archived while they have balances.

### 2.3 Account Balances (Materialized Views)

Two views — current state + period-snapshot history.

```sql
-- Current balance per account per currency (for Easy Mode "show balance" on COA)
CREATE MATERIALIZED VIEW account_balances_current AS
SELECT
    jl.tenant_id,
    jl.account_id,
    jl.currency,
    SUM(jl.debit_lkr) - SUM(jl.credit_lkr) AS balance_lkr,
    SUM(jl.debit_original) - SUM(jl.credit_original) AS balance_original_ccy,
    MAX(je.entry_date) AS last_entry_date,
    NOW() AS computed_at
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id
WHERE je.status = 'posted'
GROUP BY jl.tenant_id, jl.account_id, jl.currency;

CREATE UNIQUE INDEX ON account_balances_current (tenant_id, account_id, currency);
CREATE INDEX ON account_balances_current (tenant_id, balance_lkr);

-- Period-by-period historical balance (for reporting and drill-down)
account_balances_period (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    account_id                 UUID NOT NULL REFERENCES chart_of_accounts(id),
    fiscal_year                INTEGER NOT NULL,
    period_number              INTEGER NOT NULL,

    opening_balance_lkr        NUMERIC(15,2) NOT NULL DEFAULT 0,
    debits_lkr                 NUMERIC(15,2) NOT NULL DEFAULT 0,
    credits_lkr                NUMERIC(15,2) NOT NULL DEFAULT 0,
    closing_balance_lkr        NUMERIC(15,2) NOT NULL DEFAULT 0,

    transaction_count          INTEGER NOT NULL DEFAULT 0,

    computed_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_acc_bal_period UNIQUE (tenant_id, account_id, fiscal_year, period_number)
);

CREATE INDEX idx_acc_bal_period_lookup ON account_balances_period (tenant_id, account_id, fiscal_year, period_number);
```

**Refresh strategy**:
- `account_balances_current`: incremental via trigger on `journal_lines` insert; full refresh nightly
- `account_balances_period`: populated during period close; manual refresh available

---

### 2.4 Tag Master (Dimensional Accounting)

Referenced by `accounting-module-spec.md §5 Dimensional Accounting — Tag`. Each tenant maintains a library of tags ("Avurudu 2026", "Colombo delivery route", "Salesman Saleem", "Retail channel") applied to journal lines (and optionally headers) for slice-and-dice reporting beyond the fixed dimensions (branch, cost center, customer, supplier, employee, item, project).

```sql
tag_master (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    -- Identity
    code                       VARCHAR(40) NOT NULL,      -- short key used in filters, reports ("AVU2026")
    label                      VARCHAR(120) NOT NULL,     -- display name ("Avurudu 2026")
    description                TEXT,

    -- Optional grouping (tenant-defined; e.g. "Campaigns", "Routes", "Salespersons")
    tag_group                  VARCHAR(60),

    -- Effective dating (expired tags hidden from entry forms but remain on historical rows)
    active_from                DATE,
    active_to                  DATE,

    -- Usage controls
    is_active                  BOOLEAN NOT NULL DEFAULT TRUE,
    applicable_modules         TEXT[],  -- ['sell','buy','accounting','payroll'] — null = all
    applicable_account_types   TEXT[],  -- e.g. ['income','expense'] to restrict to P&L lines

    -- Lifecycle
    created_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                 TIMESTAMP WITH TIME ZONE,
    created_by                 UUID,
    updated_by                 UUID,
    version                    INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_tag_master_code UNIQUE (tenant_id, code),
    CONSTRAINT chk_tag_active_range CHECK (active_to IS NULL OR active_from IS NULL OR active_to >= active_from)
);

CREATE INDEX idx_tag_master_lookup ON tag_master (tenant_id, is_active, tag_group);
CREATE INDEX idx_tag_master_label_trgm ON tag_master USING GIN (label gin_trgm_ops);

ALTER TABLE tag_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tag_master
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Tag application on journal lines and headers**:

`journal_entries.tag_id UUID REFERENCES tag_master(id)` — single optional tag on the header (inherited by lines as default).
`journal_lines.tag_id UUID REFERENCES tag_master(id)` — single optional tag per line (overrides header).

The existing `tags JSONB` columns on `journal_entries` and `journal_lines` remain for freeform key-value metadata (not for dimensional reporting). Reports filter on `tag_id`; `tags JSONB` is reserved for integration payloads, import-trace IDs, and ad-hoc annotations.

**Editability**: `tag_id` on a posted journal entry/line is a **non-financial field** and editable post-posting by users with `accounting.edit_tags` permission. Edits logged in `audit_log` but do not trigger immutability violation.

---

## 3. Journal Entries (The GL Spine)

### 3.1 Journal Entry Header

Every financial transaction posts exactly one `journal_entries` row with 2+ `journal_lines`.

```sql
journal_entries (
    id                         UUID NOT NULL,  -- UUID v7
    tenant_id                  UUID NOT NULL,

    -- Identity
    entry_number               VARCHAR(50) NOT NULL,  -- "JE-2026-000047"

    -- Temporal
    entry_date                 DATE NOT NULL,  -- business date (may differ from created_at)
    posted_at                  TIMESTAMP WITH TIME ZONE,

    -- Classification
    entry_type                 VARCHAR(40) NOT NULL,
    -- 'manual','invoice_posting','bill_posting','payment','receipt','adjustment',
    -- 'opening_balance','period_close','period_open','fx_revaluation',
    -- 'depreciation','payroll','inventory_valuation','bank_reconciliation',
    -- 'recurring_journal','credit_note','debit_note','grn_accrual','wht_remittance'

    -- Source linkage (polymorphic)
    source_document_type       VARCHAR(50),
    source_document_id         UUID,
    source_document_number     VARCHAR(50),  -- denormalized for easy audit/reports

    -- Narration
    narration                  TEXT,
    reference                  VARCHAR(100),  -- tenant's custom reference

    -- Multi-currency (header rate applies to all lines unless line overrides)
    currency                   CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate              NUMERIC(15,6) NOT NULL DEFAULT 1,
    exchange_rate_date         DATE,

    -- Period assignment
    fiscal_year                INTEGER NOT NULL,
    period_number              INTEGER NOT NULL,  -- 1-12 (or 13 for year-end adjustments)
    period_locked_at_post      BOOLEAN NOT NULL DEFAULT FALSE,
    -- snapshot of period status at time of posting

    -- Workflow
    status                     VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft','pending_approval','approved','posted','voided','reversed'

    submitted_by               UUID,
    submitted_at               TIMESTAMP WITH TIME ZONE,
    approved_by                UUID,
    approved_at                TIMESTAMP WITH TIME ZONE,
    posted_by                  UUID,

    voided_by                  UUID,
    voided_at                  TIMESTAMP WITH TIME ZONE,
    void_reason                TEXT,

    reversed_by_entry_id       UUID,  -- points to reversal entry when voided
    reverses_entry_id          UUID,  -- points back if this entry IS a reversal

    -- Dimensions (inherited by lines as defaults)
    branch_id                  UUID,
    cost_center_id             UUID,
    tag_id                     UUID REFERENCES tag_master(id),  -- dimensional accounting tag (§2.4)

    -- Totals (computed; must match sum of lines)
    total_debit_lkr            NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_credit_lkr           NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_lines                SMALLINT NOT NULL DEFAULT 0,

    -- Freeform metadata (integration payloads, import-trace IDs, ad-hoc annotations — not for reporting)
    tags                       JSONB,

    -- Immutability flag (after post)
    locked                     BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at                  TIMESTAMP WITH TIME ZONE,

    created_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                 TIMESTAMP WITH TIME ZONE,
    created_by                 UUID,
    updated_by                 UUID,
    version                    INTEGER NOT NULL DEFAULT 1,

    PRIMARY KEY (id, entry_date),  -- composite for partitioning

    CONSTRAINT uk_journal_entry_number UNIQUE (tenant_id, entry_number),
    CONSTRAINT chk_balanced CHECK (
        status != 'posted' OR total_debit_lkr = total_credit_lkr
    )
);

-- Partitioned by tenant_id HASH + entry_date RANGE monthly (see Part 8)

CREATE INDEX idx_journal_entries_tenant_date_status ON journal_entries (tenant_id, entry_date DESC, status);
CREATE INDEX idx_journal_entries_tenant_period ON journal_entries (tenant_id, fiscal_year, period_number, status);
CREATE INDEX idx_journal_entries_source ON journal_entries (tenant_id, source_document_type, source_document_id);
CREATE INDEX idx_journal_entries_type ON journal_entries (tenant_id, entry_type, entry_date DESC);
CREATE INDEX idx_journal_entries_draft ON journal_entries (tenant_id, status, updated_at)
    WHERE status IN ('draft','pending_approval');

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_entries
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.2 Journal Lines

Each line is one debit or credit to one account. Multiple dimensions supported.

```sql
journal_lines (
    id                         UUID NOT NULL,  -- UUID v7
    tenant_id                  UUID NOT NULL,
    entry_id                   UUID NOT NULL,
    entry_date                 DATE NOT NULL,  -- denormalized for partition pruning

    line_number                SMALLINT NOT NULL,  -- ordering within entry

    -- Target account
    account_id                 UUID NOT NULL REFERENCES chart_of_accounts(id),

    -- Amounts (always store both original and LKR)
    debit_original             NUMERIC(15,2) NOT NULL DEFAULT 0,
    credit_original            NUMERIC(15,2) NOT NULL DEFAULT 0,
    currency                   CHAR(3) NOT NULL DEFAULT 'LKR',
    exchange_rate              NUMERIC(15,6) NOT NULL DEFAULT 1,
    debit_lkr                  NUMERIC(15,2) NOT NULL DEFAULT 0,
    credit_lkr                 NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Dimensions (enables slicing/filtering without tagging hell)
    branch_id                  UUID,
    cost_center_id             UUID,
    project_id                 UUID,       -- for job costing (future)
    tag_id                     UUID REFERENCES tag_master(id),  -- dimensional accounting tag (§2.4); overrides header

    -- Party references (null when not applicable)
    customer_id                UUID,
    supplier_id                UUID,
    employee_id                UUID,
    item_id                    UUID,

    -- Tax
    tax_code_id                UUID,        -- if this line represents a tax posting
    tax_amount_lkr             NUMERIC(15,2),
    is_tax_line                BOOLEAN NOT NULL DEFAULT FALSE,
    parent_line_id             UUID,        -- the "goods" line this tax line belongs to

    -- WHT specifics
    wht_payment_category       VARCHAR(100),  -- 'rent','professional_services' for WHT classification
    wht_rate                   NUMERIC(7,4),

    -- Narration
    narration                  TEXT,
    tags                       JSONB,

    created_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, entry_date),  -- composite for partitioning

    CONSTRAINT chk_debit_or_credit CHECK (
        (debit_lkr > 0 AND credit_lkr = 0)
        OR (credit_lkr > 0 AND debit_lkr = 0)
        OR (debit_lkr = 0 AND credit_lkr = 0)  -- for memo-only lines, rare
    )
);

-- Partitioned same as journal_entries

CREATE INDEX idx_journal_lines_entry ON journal_lines (tenant_id, entry_id);
CREATE INDEX idx_journal_lines_account_date ON journal_lines (tenant_id, account_id, entry_date DESC);
CREATE INDEX idx_journal_lines_customer ON journal_lines (tenant_id, customer_id, entry_date DESC)
    WHERE customer_id IS NOT NULL;
CREATE INDEX idx_journal_lines_supplier ON journal_lines (tenant_id, supplier_id, entry_date DESC)
    WHERE supplier_id IS NOT NULL;
CREATE INDEX idx_journal_lines_branch ON journal_lines (tenant_id, branch_id, entry_date DESC)
    WHERE branch_id IS NOT NULL;
CREATE INDEX idx_journal_lines_tax ON journal_lines (tenant_id, tax_code_id, entry_date DESC)
    WHERE tax_code_id IS NOT NULL;
CREATE INDEX idx_journal_lines_tag ON journal_lines (tenant_id, tag_id, entry_date DESC)
    WHERE tag_id IS NOT NULL;

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_lines
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.3 Immutability Enforcement

```sql
CREATE OR REPLACE FUNCTION prevent_posted_journal_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'posted' THEN
        -- Allow only void workflow (which sets voided_* fields)
        IF NEW.status = 'voided' AND OLD.voided_at IS NULL THEN
            RETURN NEW;  -- void transition allowed
        END IF;
        RAISE EXCEPTION 'Posted journal entries cannot be modified; void and create new entry instead';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_immutable
    BEFORE UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION prevent_posted_journal_modification();

-- Parallel trigger on journal_lines
CREATE OR REPLACE FUNCTION prevent_posted_journal_lines_modification()
RETURNS TRIGGER AS $$
DECLARE
    parent_status VARCHAR(20);
BEGIN
    SELECT status INTO parent_status FROM journal_entries WHERE id = OLD.entry_id;
    IF parent_status = 'posted' THEN
        RAISE EXCEPTION 'Lines of posted journal entries cannot be modified';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_lines_immutable
    BEFORE UPDATE OR DELETE ON journal_lines
    FOR EACH ROW EXECUTE FUNCTION prevent_posted_journal_lines_modification();
```

### 3.4 Reversal Pattern

When a posted entry is voided:
1. New entry created with mirror debit/credit of original
2. New entry: `reverses_entry_id = original.id`, `entry_type = 'reversal'`
3. Original: `status = 'voided'`, `voided_at = NOW()`, `reversed_by_entry_id = new.id`, `void_reason = ...`
4. Both entries remain in history; full audit preserved

### 3.5 Recurring Journal Templates

Referenced by `journal_entries.journal_type = 'recurring_journal'` and gated at Growth+ in `pricing-plan-architecture-spec.md §4`. Tenants define templates (e.g. "Monthly office rent", "Quarterly insurance prepayment amortization") that the scheduler materializes into posted or draft entries per cadence.

```sql
recurring_journal_templates (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Identity
    code                        VARCHAR(40) NOT NULL,      -- "MONTHLY_RENT_HQ"
    name                        VARCHAR(200) NOT NULL,
    description                 TEXT,
    narration_template          TEXT NOT NULL,             -- substituted at run time (supports {period}, {month}, {year})

    -- Schedule
    frequency                   VARCHAR(20) NOT NULL,
    -- 'monthly','bi_monthly','quarterly','half_yearly','yearly','custom_cron'
    custom_cron                 VARCHAR(40),               -- when frequency = 'custom_cron'
    day_of_month                SMALLINT,                  -- 1-28 (or 31 = last day); for monthly/quarterly/etc
    first_run_date              DATE NOT NULL,
    last_run_date               DATE,                      -- null = indefinite
    next_scheduled_at           DATE NOT NULL,
    occurrences_total           INTEGER,                   -- null = indefinite; otherwise cap count
    occurrences_generated       INTEGER NOT NULL DEFAULT 0,

    -- Posting mode
    auto_post                   BOOLEAN NOT NULL DEFAULT FALSE,
    -- TRUE  = materialize as 'posted' journal entry automatically on schedule
    -- FALSE = materialize as 'draft' for review by an accountant
    approval_required           BOOLEAN NOT NULL DEFAULT TRUE,

    -- Template lines (flat JSONB — not normalized; small arrays)
    lines_json                  JSONB NOT NULL,
    -- [{"account_id":"<uuid>","debit_lkr":100000,"credit_lkr":0,"narration":"...",
    --   "branch_id":"...","cost_center_id":"...","tag_id":"...","tax_code_id":"..."}, ...]

    -- Variable amounts (optional)
    amount_basis                VARCHAR(30) NOT NULL DEFAULT 'fixed',
    -- 'fixed'               — lines_json amounts used as-is
    -- 'cpi_indexed'         — amounts scale annually by CPI factor (tenant-supplied)
    -- 'formula'             — computed from formula_expression (e.g. prepayment amortization)
    formula_expression          TEXT,
    cpi_annual_adjustment_pct   NUMERIC(5,2),

    -- Header defaults (applied to journal_entries header at run)
    default_branch_id           UUID,
    default_cost_center_id      UUID,
    default_tag_id              UUID REFERENCES tag_master(id),

    -- Lifecycle
    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','paused','completed','cancelled'
    paused_at                   TIMESTAMP WITH TIME ZONE,
    paused_by                   UUID,
    paused_reason               TEXT,

    -- Audit
    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_recurring_journal_code UNIQUE (tenant_id, code),
    CONSTRAINT chk_recurring_journal_day CHECK (day_of_month IS NULL OR (day_of_month BETWEEN 1 AND 31)),
    CONSTRAINT chk_recurring_journal_occurrences CHECK (
        occurrences_total IS NULL OR occurrences_generated <= occurrences_total
    )
);

CREATE INDEX idx_rjt_next_run ON recurring_journal_templates
    (tenant_id, next_scheduled_at)
    WHERE status = 'active';
CREATE INDEX idx_rjt_status ON recurring_journal_templates (tenant_id, status);

ALTER TABLE recurring_journal_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_journal_templates FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Linkage on generation**: each materialized `journal_entries` row gets `source_type='recurring_journal_template'`, `source_id=<template_id>`, enabling traceability from posted entries back to the template. The scheduler (Part 7 `scheduled_jobs`) advances `next_scheduled_at` and increments `occurrences_generated` on each successful materialization; marks `status='completed'` when `occurrences_generated = occurrences_total` or `next_scheduled_at > last_run_date`.

**Edits after first run**: changing `lines_json` or `amount_basis` only affects future occurrences. Already-generated `journal_entries` remain immutable per §3.3.

---

## 4. Tax Codes

### 4.1 Tax Codes Table

Captures all SL tax types with effective dating.

```sql
tax_codes (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    -- Identity
    code                       VARCHAR(30) NOT NULL,  -- 'VAT18','VAT0','SSCL2.5','WHT_RENT_10','STAMP_DUTY_CHEQUE'
    name                       VARCHAR(100) NOT NULL,
    description                TEXT,

    -- Tax type
    tax_type                   VARCHAR(20) NOT NULL,
    -- 'vat','sscl','wht','stamp_duty','customs_duty','other'

    -- Rate
    rate                       NUMERIC(7,4) NOT NULL,
    -- 18.0000 for 18%, 2.5000 for 2.5%
    calculation_basis          VARCHAR(30) NOT NULL DEFAULT 'on_value',
    -- 'on_value' — standard
    -- 'on_value_plus_other_tax' — compound tax (VAT on value + SSCL)
    -- 'fixed_amount' — stamp duty
    fixed_amount               NUMERIC(15,2),
    -- for 'fixed_amount' basis

    is_inclusive_default       BOOLEAN NOT NULL DEFAULT FALSE,

    -- GL account mapping (where this tax posts)
    payable_account_id         UUID REFERENCES chart_of_accounts(id),
    -- for output VAT collected, WHT collected, SSCL payable
    receivable_account_id      UUID REFERENCES chart_of_accounts(id),
    -- for input VAT claimable
    expense_account_id         UUID REFERENCES chart_of_accounts(id),
    -- for ineligible input VAT (expensed instead of claimed)

    -- Applicability
    applies_to_sales           BOOLEAN NOT NULL DEFAULT FALSE,
    applies_to_purchases       BOOLEAN NOT NULL DEFAULT FALSE,
    is_eligible_input          BOOLEAN NOT NULL DEFAULT TRUE,
    -- for VAT: claimable vs blocked (entertainment, certain capital goods)

    -- WHT-specific
    wht_payment_category       VARCHAR(100),
    -- 'rent','professional_services','contracts','dividends','interest','commissions'
    wht_supplier_type          VARCHAR(30),
    -- 'individual','company','foreign','government'

    -- Stamp duty specifics
    stamp_duty_document_type   VARCHAR(50),
    -- 'cheque','receipt','contract','other'
    stamp_duty_threshold       NUMERIC(15,2),
    -- only applies above this amount

    -- Effective dating (when govt changes rates)
    effective_from             DATE NOT NULL,
    effective_until            DATE,  -- NULL = current
    superseded_by_code_id      UUID REFERENCES tax_codes(id),

    -- Platform sync
    platform_rate_id           UUID,
    -- links to platform_tax_rates; NULL if tenant-defined custom
    tenant_override            BOOLEAN NOT NULL DEFAULT FALSE,
    -- true = tenant customized rate differently from platform default

    -- Reporting
    vat_return_box             VARCHAR(20),
    -- which box on SL VAT return this maps to (e.g. 'box_3_standard_rated')

    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','superseded','inactive'

    created_at, updated_at, deleted_at, created_by, updated_by, version

    CONSTRAINT uk_tax_codes_tenant_code_effective UNIQUE (tenant_id, code, effective_from)
);

CREATE INDEX idx_tax_codes_tenant_type ON tax_codes (tenant_id, tax_type, status);
CREATE INDEX idx_tax_codes_effective ON tax_codes (tenant_id, effective_from, effective_until);
CREATE INDEX idx_tax_codes_wht ON tax_codes (tenant_id, wht_payment_category, wht_supplier_type)
    WHERE tax_type = 'wht';

ALTER TABLE tax_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_codes
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.2 Tax Rules (WHT Auto-Derivation + Conditional Tax)

Resolves to specific `tax_code_id` based on transaction context.

```sql
tax_rules (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    name                       VARCHAR(200),
    description                TEXT,

    -- Target tax code
    tax_code_id                UUID NOT NULL REFERENCES tax_codes(id),

    -- Matching conditions (all must match)
    condition_json             JSONB NOT NULL,
    -- Examples:
    -- {"supplier_type":"individual","payment_category":"rent"}
    -- {"customer_type":"government","item_category_id":"..."}
    -- {"supplier_country":"IN","import_customs_code":"..."}

    -- Priority for conflict resolution (higher wins)
    priority                   INTEGER NOT NULL DEFAULT 100,

    status                     VARCHAR(20) NOT NULL DEFAULT 'active',

    created_at, updated_at, ...
);

CREATE INDEX idx_tax_rules_tenant_active ON tax_rules (tenant_id, status, priority DESC) WHERE status = 'active';

ALTER TABLE tax_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_rules
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.3 Tax Resolution Flow (Application-Layer)

```typescript
async function resolveTaxCode(context: TaxContext): Promise<TaxCode> {
  // 1. Check customer/supplier-specific override
  if (context.supplier_id && context.item_id) {
    const override = await findSupplierItemTaxOverride(context);
    if (override) return override;
  }

  // 2. Evaluate tax_rules in priority order
  const rules = await db.query(`
    SELECT tr.tax_code_id, tr.condition_json, tr.priority
    FROM tax_rules tr
    WHERE tr.tenant_id = $1 AND tr.status = 'active'
    ORDER BY tr.priority DESC
  `, [context.tenant_id]);

  for (const rule of rules) {
    if (matchesConditions(rule.condition_json, context)) {
      return await getTaxCode(rule.tax_code_id);
    }
  }

  // 3. Fall back to item's default tax code
  if (context.item_id) {
    const item = await getItem(context.item_id);
    if (item.default_tax_code_id) {
      return await getTaxCode(item.default_tax_code_id);
    }
  }

  // 4. Fall back to account's default tax code
  if (context.account_id) {
    const account = await getAccount(context.account_id);
    if (account.default_tax_code_id) {
      return await getTaxCode(account.default_tax_code_id);
    }
  }

  // 5. Zero tax
  return await getTaxCode('TAX_ZERO');
}
```

---

## 5. Fiscal Periods & Period Locking

### 5.1 Fiscal Years

```sql
fiscal_years (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    year                       INTEGER NOT NULL,  -- 2026 (for April 2026 - March 2027)
    label                      VARCHAR(50),       -- "FY 2026-27" for display
    start_date                 DATE NOT NULL,
    end_date                   DATE NOT NULL,

    status                     VARCHAR(20) NOT NULL DEFAULT 'open',
    -- 'open','closed','archived'

    closed_at                  TIMESTAMP WITH TIME ZONE,
    closed_by                  UUID,

    -- Opening balance
    opening_balance_posted     BOOLEAN NOT NULL DEFAULT FALSE,
    opening_balance_entry_id   UUID,  -- references journal_entries(id)

    -- Year-end close
    year_end_close_entry_id    UUID,  -- the P&L-zeroing journal

    notes                      TEXT,

    created_at, updated_at, ...

    CONSTRAINT uk_fiscal_years_tenant_year UNIQUE (tenant_id, year)
);

CREATE INDEX idx_fiscal_years_tenant_status ON fiscal_years (tenant_id, status);

ALTER TABLE fiscal_years ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fiscal_years
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.2 Fiscal Periods

Typically 12 monthly periods per year + optional period 13 for year-end adjustments.

```sql
fiscal_periods (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    fiscal_year_id             UUID NOT NULL REFERENCES fiscal_years(id),

    period_number              INTEGER NOT NULL,  -- 1-12, 13 for adjustments
    name                       VARCHAR(50) NOT NULL,  -- "April 2026", "Year-End Adjustments 2026"
    start_date                 DATE NOT NULL,
    end_date                   DATE NOT NULL,

    -- 2-tier lock model
    status                     VARCHAR(20) NOT NULL DEFAULT 'open',
    -- 'open','soft_closed','hard_closed'

    soft_closed_at             TIMESTAMP WITH TIME ZONE,
    soft_closed_by             UUID,
    soft_closed_reason         TEXT,

    hard_closed_at             TIMESTAMP WITH TIME ZONE,
    hard_closed_by             UUID,
    hard_closed_reason         TEXT,

    -- Reopening tracking
    last_reopened_at           TIMESTAMP WITH TIME ZONE,
    last_reopened_by           UUID,
    reopen_count               INTEGER NOT NULL DEFAULT 0,

    -- Close checklist state
    close_checklist_json       JSONB,
    -- { "bank_reconciled": true, "ar_reviewed": true, "ap_reviewed": true,
    --   "inventory_counted": true, "depreciation_posted": true, "fx_revalued": true, ... }

    created_at, updated_at, ...

    CONSTRAINT uk_fiscal_periods UNIQUE (tenant_id, fiscal_year_id, period_number)
);

CREATE INDEX idx_fiscal_periods_tenant_dates ON fiscal_periods (tenant_id, start_date, end_date);
CREATE INDEX idx_fiscal_periods_tenant_status ON fiscal_periods (tenant_id, status);

ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fiscal_periods
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.3 Period Reopening Log

Immutable audit of every reopening.

```sql
period_reopening_log (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    period_id                  UUID NOT NULL REFERENCES fiscal_periods(id),

    previous_status            VARCHAR(20) NOT NULL,
    new_status                 VARCHAR(20) NOT NULL,
    reason                     TEXT NOT NULL,

    requested_by               UUID NOT NULL,
    approved_by                UUID NOT NULL,

    performed_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- What changed during reopen-until-reclose window
    reopened_until             TIMESTAMP WITH TIME ZONE,
    reclosed_at                TIMESTAMP WITH TIME ZONE,
    entries_modified_count     INTEGER,
    entries_added_count        INTEGER,
    entries_voided_count       INTEGER
);

CREATE INDEX idx_period_reopening_tenant_period ON period_reopening_log (tenant_id, period_id, performed_at DESC);

ALTER TABLE period_reopening_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON period_reopening_log
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.4 Period-Enforcing Check on Journal Posting

Triggered when journal entry transitions to `status = 'posted'`:

```sql
CREATE OR REPLACE FUNCTION enforce_period_lock_on_post()
RETURNS TRIGGER AS $$
DECLARE
    period_status VARCHAR(20);
    is_override_allowed BOOLEAN;
BEGIN
    IF NEW.status = 'posted' AND (OLD.status IS NULL OR OLD.status != 'posted') THEN
        SELECT status INTO period_status
        FROM fiscal_periods
        WHERE tenant_id = NEW.tenant_id
          AND fiscal_year_id = (SELECT id FROM fiscal_years WHERE tenant_id = NEW.tenant_id AND year = NEW.fiscal_year)
          AND period_number = NEW.period_number;

        IF period_status = 'hard_closed' THEN
            RAISE EXCEPTION 'Cannot post to hard-closed period';
        END IF;

        IF period_status = 'soft_closed' THEN
            -- Check if user has override permission (checked at application level; DB just flags)
            is_override_allowed := current_setting('app.allow_soft_closed_post', true) = 'true';
            IF NOT is_override_allowed THEN
                RAISE EXCEPTION 'Cannot post to soft-closed period without Owner override';
            END IF;
        END IF;

        -- Snapshot period status
        NEW.period_locked_at_post := (period_status != 'open');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_period_lock_check
    BEFORE UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION enforce_period_lock_on_post();
```

---

## 6. Exchange Rates & FX

### 6.1 Exchange Rates

Tenant-level rates (some set own, some use platform defaults).

```sql
exchange_rates (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,

    from_currency              CHAR(3) NOT NULL,  -- 'USD','EUR','INR'
    to_currency                CHAR(3) NOT NULL DEFAULT 'LKR',

    rate                       NUMERIC(15,6) NOT NULL,

    rate_type                  VARCHAR(20) NOT NULL DEFAULT 'spot',
    -- 'spot' — for transactions
    -- 'monthly_average' — for periodic reporting
    -- 'year_end' — for revaluation
    -- 'custom' — tenant-defined special rate

    effective_date             DATE NOT NULL,
    effective_until_date       DATE,

    source                     VARCHAR(50),
    -- 'manual','cbsl_import','platform_default','bank_source'

    notes                      TEXT,

    created_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by                 UUID,

    CONSTRAINT uk_exchange_rates UNIQUE (tenant_id, from_currency, to_currency, effective_date, rate_type)
);

CREATE INDEX idx_exchange_rates_lookup ON exchange_rates (tenant_id, from_currency, effective_date DESC);
CREATE INDEX idx_exchange_rates_type ON exchange_rates (tenant_id, rate_type, effective_date DESC);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exchange_rates
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 6.2 FX Revaluations

Period-end unrealized gain/loss on foreign-currency AP/AR balances.

```sql
fx_revaluations (
    id                         UUID PRIMARY KEY,
    tenant_id                  UUID NOT NULL,
    fiscal_period_id           UUID NOT NULL REFERENCES fiscal_periods(id),

    account_id                 UUID NOT NULL REFERENCES chart_of_accounts(id),
    currency                   CHAR(3) NOT NULL,

    -- Snapshots
    original_balance_fx        NUMERIC(15,2) NOT NULL,
    original_balance_lkr       NUMERIC(15,2) NOT NULL,  -- at historic rate
    revalued_balance_lkr       NUMERIC(15,2) NOT NULL,  -- at period-end rate
    gain_loss_lkr              NUMERIC(15,2) NOT NULL,

    rate_used                  NUMERIC(15,6) NOT NULL,
    rate_date                  DATE NOT NULL,

    journal_entry_id           UUID NOT NULL REFERENCES journal_entries(id),

    posted_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    posted_by                  UUID,

    -- Reversal (revaluation entries typically reverse in next period)
    reverses_at_period_id      UUID REFERENCES fiscal_periods(id),
    reversed                   BOOLEAN NOT NULL DEFAULT FALSE,
    reversed_entry_id          UUID
);

CREATE INDEX idx_fx_reval_period_account ON fx_revaluations (tenant_id, fiscal_period_id, account_id);
CREATE INDEX idx_fx_reval_account ON fx_revaluations (tenant_id, account_id, posted_at DESC);

ALTER TABLE fx_revaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fx_revaluations
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 7. Fixed Assets & Depreciation

Referenced by `accounting-module-spec.md §8` (5 subsections). Gated at Growth+ in `pricing-plan-architecture-spec.md §4`. Asset master + category-level depreciation policy + parallel book + tax depreciation schedules + lifecycle events (acquisition, addition, revaluation, disposal, impairment). All postings flow through `journal_entries` (§3).

### 7.1 Fixed Asset Categories

Tenant-defined categories with default depreciation policy. Policies can be overridden per asset.

```sql
fixed_asset_categories (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Identity
    code                        VARCHAR(40) NOT NULL,      -- "VEHICLE","COMPUTER","MACHINERY","BUILDING","LAND","FURNITURE","SOFTWARE","OTHER"
    name                        VARCHAR(120) NOT NULL,
    description                 TEXT,

    -- Default depreciation (Book policy — SLFRS)
    book_method                 VARCHAR(20) NOT NULL,
    -- 'slm','wdv','soyd','none'  (none = not depreciable, e.g., Land)
    book_useful_life_years      NUMERIC(5,2),             -- null when method='none'
    book_salvage_pct            NUMERIC(5,2) NOT NULL DEFAULT 0,  -- default % of cost
    book_rate_pct               NUMERIC(7,4),              -- for WDV; IRD-style

    -- Default depreciation (Tax policy — IRD)
    tax_method                  VARCHAR(20) NOT NULL,
    tax_useful_life_years       NUMERIC(5,2),
    tax_salvage_pct             NUMERIC(5,2) NOT NULL DEFAULT 0,
    tax_rate_pct                NUMERIC(7,4),

    -- GL mapping (default accounts used when creating assets in this category)
    asset_account_id            UUID REFERENCES chart_of_accounts(id),         -- e.g., "Motor Vehicles — Cost"
    accumulated_dep_account_id  UUID REFERENCES chart_of_accounts(id),         -- "Motor Vehicles — Accum Dep"
    depreciation_expense_account_id UUID REFERENCES chart_of_accounts(id),     -- "Depreciation Expense — Vehicles"
    disposal_gain_account_id    UUID REFERENCES chart_of_accounts(id),
    disposal_loss_account_id    UUID REFERENCES chart_of_accounts(id),
    revaluation_reserve_account_id UUID REFERENCES chart_of_accounts(id),      -- SLFRS Revaluation Reserve
    impairment_account_id       UUID REFERENCES chart_of_accounts(id),

    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_fa_category_code UNIQUE (tenant_id, code),
    CONSTRAINT chk_fa_cat_book_method CHECK (book_method IN ('slm','wdv','soyd','none')),
    CONSTRAINT chk_fa_cat_tax_method CHECK (tax_method IN ('slm','wdv','soyd','none')),
    CONSTRAINT chk_fa_cat_salvage CHECK (book_salvage_pct BETWEEN 0 AND 100 AND tax_salvage_pct BETWEEN 0 AND 100)
);

CREATE INDEX idx_fa_categories_active ON fixed_asset_categories (tenant_id, is_active);

ALTER TABLE fixed_asset_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fixed_asset_categories FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 7.2 Fixed Assets (Register)

One row per asset. Supports both book and tax depreciation policies in parallel, with per-asset overrides of category defaults.

```sql
fixed_assets (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Identity
    asset_code                  VARCHAR(60) NOT NULL,      -- tenant-configured numbering
    name                        VARCHAR(200) NOT NULL,
    description                 TEXT,
    category_id                 UUID NOT NULL REFERENCES fixed_asset_categories(id),

    -- Tagging / identification
    serial_number               VARCHAR(120),
    manufacturer                VARCHAR(120),
    model                       VARCHAR(120),
    barcode                     VARCHAR(80),

    -- Acquisition
    acquisition_date            DATE NOT NULL,
    put_in_service_date         DATE NOT NULL,            -- depreciation starts here
    acquisition_cost_lkr        NUMERIC(15,2) NOT NULL,
    acquisition_source          VARCHAR(30) NOT NULL,
    -- 'purchase_bill','opening_balance','manual','donation','transfer_in','lease_conversion'
    source_bill_id              UUID REFERENCES bills(id),
    source_journal_entry_id     UUID REFERENCES journal_entries(id),

    -- Book depreciation (copies from category; overridable)
    book_method                 VARCHAR(20) NOT NULL,
    book_useful_life_years      NUMERIC(5,2),
    book_salvage_value_lkr      NUMERIC(15,2) NOT NULL DEFAULT 0,
    book_rate_pct               NUMERIC(7,4),

    -- Tax depreciation (parallel track)
    tax_method                  VARCHAR(20) NOT NULL,
    tax_useful_life_years       NUMERIC(5,2),
    tax_salvage_value_lkr       NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_rate_pct                NUMERIC(7,4),

    -- Location / assignment
    branch_id                   UUID REFERENCES branches(id),
    warehouse_id                UUID REFERENCES warehouses(id),
    assigned_to_user_id         UUID REFERENCES users(id),
    assigned_to_department      VARCHAR(100),
    physical_location           VARCHAR(200),

    -- Running book values (denormalized; authoritative source is depreciation_schedules)
    current_book_value_lkr      NUMERIC(15,2) NOT NULL,    -- cost + additions + revaluations − accumulated dep − impairment
    accumulated_book_dep_lkr    NUMERIC(15,2) NOT NULL DEFAULT 0,
    current_tax_value_lkr       NUMERIC(15,2) NOT NULL,
    accumulated_tax_dep_lkr     NUMERIC(15,2) NOT NULL DEFAULT 0,
    last_depreciation_period    VARCHAR(7),                 -- "2026-04" — last period for which dep was posted

    -- Revaluation / impairment running totals
    total_additions_lkr         NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_revaluations_lkr      NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_impairments_lkr       NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- State
    status                      VARCHAR(20) NOT NULL DEFAULT 'in_service',
    -- 'in_service','idle','under_maintenance','disposed','written_off','held_for_sale','impaired'
    disposed_at                 DATE,
    disposal_type               VARCHAR(20),
    -- 'sale','scrap','donation','theft_loss','destruction'
    disposal_proceeds_lkr       NUMERIC(15,2),
    disposal_gain_loss_lkr      NUMERIC(15,2),
    disposal_journal_entry_id   UUID REFERENCES journal_entries(id),

    -- Attachments
    photo_urls                  TEXT[],                    -- S3 references
    document_ids                UUID[],                    -- REFERENCES documents(id) from Part 7

    notes                       TEXT,
    custom_fields_json          JSONB,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_fixed_asset_code UNIQUE (tenant_id, asset_code),
    CONSTRAINT chk_fa_status CHECK (status IN (
        'in_service','idle','under_maintenance','disposed','written_off','held_for_sale','impaired'
    )),
    CONSTRAINT chk_fa_disposal_coherence CHECK (
        (status NOT IN ('disposed','written_off') OR disposed_at IS NOT NULL)
    ),
    CONSTRAINT chk_fa_methods CHECK (
        book_method IN ('slm','wdv','soyd','none')
        AND tax_method IN ('slm','wdv','soyd','none')
    )
);

CREATE INDEX idx_fa_category ON fixed_assets (tenant_id, category_id, status);
CREATE INDEX idx_fa_branch ON fixed_assets (tenant_id, branch_id, status);
CREATE INDEX idx_fa_status ON fixed_assets (tenant_id, status);
CREATE INDEX idx_fa_in_service ON fixed_assets (tenant_id, put_in_service_date)
    WHERE status = 'in_service';
CREATE INDEX idx_fa_source_bill ON fixed_assets (tenant_id, source_bill_id)
    WHERE source_bill_id IS NOT NULL;
CREATE INDEX idx_fa_assigned_user ON fixed_assets (tenant_id, assigned_to_user_id)
    WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX idx_fa_name_trgm ON fixed_assets USING GIN (name gin_trgm_ops);

ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fixed_assets FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 7.3 Depreciation Schedules

Per-asset, per-period, per-track (book / tax) row. Generated at asset creation (forward-looking schedule through disposal or end-of-life), posted incrementally as each period closes. Re-generated on policy change, revaluation, or impairment (future rows only; posted rows stay immutable).

```sql
depreciation_schedules (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    asset_id                    UUID NOT NULL REFERENCES fixed_assets(id),

    -- Track
    track                       VARCHAR(10) NOT NULL,
    -- 'book','tax'

    -- Period
    fiscal_year                 INTEGER NOT NULL,
    fiscal_period_id            UUID REFERENCES fiscal_periods(id),
    period_month                SMALLINT NOT NULL,         -- 1-12 of fiscal year
    period_label                VARCHAR(7) NOT NULL,       -- "2026-04"

    -- Amounts
    opening_net_book_value_lkr  NUMERIC(15,2) NOT NULL,
    depreciation_amount_lkr     NUMERIC(15,2) NOT NULL,
    closing_net_book_value_lkr  NUMERIC(15,2) NOT NULL,
    accumulated_dep_lkr         NUMERIC(15,2) NOT NULL,

    -- State
    status                      VARCHAR(20) NOT NULL DEFAULT 'projected',
    -- 'projected','posted','skipped','reversed','superseded'
    posted_journal_entry_id     UUID REFERENCES journal_entries(id),
    posted_at                   TIMESTAMP WITH TIME ZONE,

    -- Supersession (when policy/revaluation forces re-generation)
    superseded_at               TIMESTAMP WITH TIME ZONE,
    superseded_by_schedule_id   UUID REFERENCES depreciation_schedules(id),
    supersede_reason            VARCHAR(60),
    -- 'policy_change','useful_life_change','addition','revaluation','impairment','manual_adjust'

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_dep_schedule UNIQUE (tenant_id, asset_id, track, period_label, status)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT chk_dep_track CHECK (track IN ('book','tax')),
    CONSTRAINT chk_dep_status CHECK (status IN ('projected','posted','skipped','reversed','superseded')),
    CONSTRAINT chk_dep_period_month CHECK (period_month BETWEEN 1 AND 12)
);

CREATE INDEX idx_dep_asset_track ON depreciation_schedules
    (tenant_id, asset_id, track, fiscal_year, period_month);
CREATE INDEX idx_dep_period_due ON depreciation_schedules
    (tenant_id, track, period_label)
    WHERE status = 'projected';
CREATE INDEX idx_dep_posted_by_period ON depreciation_schedules
    (tenant_id, fiscal_year, period_month, track)
    WHERE status = 'posted';
CREATE INDEX idx_dep_journal ON depreciation_schedules
    (tenant_id, posted_journal_entry_id)
    WHERE posted_journal_entry_id IS NOT NULL;

ALTER TABLE depreciation_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON depreciation_schedules FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Monthly depreciation run**: the scheduler (Part 7) selects all rows with `track='book' AND status='projected' AND period_label = :current_period AND tenant_id = ?`, aggregates debit (Dep Expense) / credit (Accum Dep) per category, posts a single consolidated journal entry per category per period, and flips matching schedule rows to `status='posted'` with `posted_journal_entry_id`. Tax track runs in parallel but never posts to GL (tax depreciation is reported separately for IRD, not booked).

### 7.4 Fixed Asset Events

Immutable ledger of lifecycle events. Additions, revaluations, impairments, disposals each write a row and may trigger schedule supersession (§7.3).

```sql
fixed_asset_events (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    asset_id                    UUID NOT NULL REFERENCES fixed_assets(id),

    event_date                  DATE NOT NULL,
    event_type                  VARCHAR(30) NOT NULL,
    -- 'acquisition','addition','revaluation_up','revaluation_down',
    -- 'impairment','reversal_of_impairment','reclassification',
    -- 'policy_change','disposal','partial_disposal','transfer','maintenance_log'

    -- Amounts (signed in LKR; interpretation depends on event_type)
    amount_lkr                  NUMERIC(15,2),
    -- acquisition: full cost; addition: capitalized amount; revaluation: uplift/write-down;
    -- impairment: loss amount (positive); disposal: proceeds
    new_net_book_value_lkr      NUMERIC(15,2),     -- snapshot after event (book track)

    -- Policy change detail
    previous_book_method        VARCHAR(20),
    new_book_method             VARCHAR(20),
    previous_useful_life_years  NUMERIC(5,2),
    new_useful_life_years       NUMERIC(5,2),

    -- Disposal detail
    disposal_type               VARCHAR(20),
    buyer_party_name            VARCHAR(200),
    buyer_customer_id           UUID REFERENCES customers(id),

    -- Transfer detail
    from_branch_id              UUID REFERENCES branches(id),
    to_branch_id                UUID REFERENCES branches(id),
    from_user_id                UUID REFERENCES users(id),
    to_user_id                  UUID REFERENCES users(id),

    -- Linkage
    journal_entry_id            UUID REFERENCES journal_entries(id),
    source_document_type        VARCHAR(30),
    -- 'bill','invoice','journal','manual'
    source_document_id          UUID,
    supersedes_schedule_from_period VARCHAR(7),    -- when event triggered schedule supersession

    -- Approval (revaluations and disposals typically require approval)
    requires_approval           BOOLEAN NOT NULL DEFAULT FALSE,
    approval_instance_id        UUID REFERENCES approval_instances(id),

    -- Attachments (valuation reports, disposal paperwork)
    document_ids                UUID[],

    reason                      TEXT NOT NULL,
    notes                       TEXT,

    recorded_by                 UUID NOT NULL REFERENCES users(id),
    recorded_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_fa_event_type CHECK (event_type IN (
        'acquisition','addition','revaluation_up','revaluation_down',
        'impairment','reversal_of_impairment','reclassification',
        'policy_change','disposal','partial_disposal','transfer','maintenance_log'
    ))
);

CREATE INDEX idx_fa_events_asset ON fixed_asset_events (tenant_id, asset_id, event_date DESC);
CREATE INDEX idx_fa_events_type ON fixed_asset_events (tenant_id, event_type, event_date DESC);
CREATE INDEX idx_fa_events_journal ON fixed_asset_events (tenant_id, journal_entry_id)
    WHERE journal_entry_id IS NOT NULL;

ALTER TABLE fixed_asset_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fixed_asset_events FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Common event patterns**:

| Event | Journal pattern |
|---|---|
| **Acquisition (from bill)** | `DR Asset (cost) / CR AP` — posted by bill; event links back |
| **Addition** (capitalizable improvement) | `DR Asset / CR AP (or Cash)` — event records capitalized amount; schedules regenerate from current period |
| **Revaluation up** (SLFRS) | `DR Asset / CR Revaluation Reserve` (equity) |
| **Revaluation down / Impairment** | `DR Impairment Loss (P&L) / CR Accumulated Impairment` (offset to asset block) |
| **Disposal (sale)** | `DR Cash/Bank + DR Accum Dep / CR Asset + CR/DR Gain or Loss on Disposal` |
| **Partial disposal** | Proportional split of cost + accum dep; remainder continues depreciating |
| **Transfer** | No GL impact; updates `branch_id` / `warehouse_id` / `assigned_to_user_id` on asset |

---

## 8. Budgets

Referenced by `accounting-module-spec.md §12`. **Scope**: minimal per-account per-month budgets with variance reporting; gated at Scale+ in pricing. Deferred features (versioning, alerts, forecasts, per-branch/tag budgets) listed in `accounting-module-spec.md §12.2` — not modeled here until demand emerges.

### 8.1 Budget Headers

```sql
budgets (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Identity
    name                        VARCHAR(200) NOT NULL,
    description                 TEXT,
    fiscal_year                 INTEGER NOT NULL,

    -- Scope (null = tenant-wide)
    branch_id                   UUID REFERENCES branches(id),
    cost_center_id              UUID,
    tag_id                      UUID REFERENCES tag_master(id),

    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',

    -- State
    status                      VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft','active','archived'
    locked                      BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at                   TIMESTAMP WITH TIME ZONE,
    locked_by                   UUID,

    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_budget_scope UNIQUE (tenant_id, fiscal_year, branch_id, cost_center_id, tag_id, name)
);

CREATE INDEX idx_budgets_year ON budgets (tenant_id, fiscal_year, status);
CREATE INDEX idx_budgets_branch ON budgets (tenant_id, branch_id, fiscal_year)
    WHERE branch_id IS NOT NULL;

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON budgets FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 8.2 Budget Lines

One row per (account × month). Actuals come from `journal_lines` aggregated at report time — not stored here.

```sql
budget_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    budget_id                   UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,

    account_id                  UUID NOT NULL REFERENCES chart_of_accounts(id),

    -- Period (one line per month of fiscal year)
    fiscal_year                 INTEGER NOT NULL,
    period_month                SMALLINT NOT NULL,         -- 1-12 of fiscal year

    -- Amount
    budgeted_amount_lkr         NUMERIC(15,2) NOT NULL,

    -- Signed convention (matches account natural side): positive = debit-natural for expense accounts,
    -- credit-natural for revenue accounts. Simplifies variance queries.

    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_budget_line UNIQUE (budget_id, account_id, period_month),
    CONSTRAINT chk_budget_line_period_month CHECK (period_month BETWEEN 1 AND 12)
);

CREATE INDEX idx_budget_lines_budget ON budget_lines (tenant_id, budget_id);
CREATE INDEX idx_budget_lines_account_period ON budget_lines
    (tenant_id, account_id, fiscal_year, period_month);

ALTER TABLE budget_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON budget_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Variance queries**: the Actual vs Budget report joins `budget_lines` against `journal_lines` (aggregated by `account_id`, `fiscal_year`, `EXTRACT(MONTH FROM entry_date)` filtered by budget scope) to compute `variance_lkr = actual − budgeted` and `variance_pct`. No precomputed variance table — report is cheap against `account_balances_period` (§2.3) and `journal_lines`.

**CSV upload**: bulk entry supported by the application layer; parses `account_code`, `period_month`, `budgeted_amount_lkr`, validates against active CoA, rejects unknown codes with a preview before commit.

---

## 9. Bank Reconciliation

Referenced by `accounting-module-spec.md §13` (upload-based primary + manual fallback; tick-through matching; unreconciled aging; per-bank-per-period report). Live bank feeds and statement-fetching APIs are explicitly out of scope (§13.4) — SL bank reliability makes live integration impractical at launch.

### 9.1 Bank Statements (Uploaded)

```sql
bank_statements (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Which bank account
    account_id                  UUID NOT NULL REFERENCES chart_of_accounts(id),
    -- the Bank GL account this statement is for

    -- Statement metadata
    bank_name                   VARCHAR(120) NOT NULL,     -- "Commercial Bank", "HNB", ...
    account_number_last_4       CHAR(4),                   -- UI display only
    statement_number            VARCHAR(50),               -- as printed on the statement
    period_start                DATE NOT NULL,
    period_end                  DATE NOT NULL,

    -- Opening / closing balances (as reported by bank)
    opening_balance_lkr         NUMERIC(15,2) NOT NULL,
    closing_balance_lkr         NUMERIC(15,2) NOT NULL,
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',

    -- Source file
    file_url                    VARCHAR(500) NOT NULL,     -- S3 reference
    file_name                   VARCHAR(200) NOT NULL,
    file_format                 VARCHAR(20) NOT NULL,      -- 'pdf','xlsx','csv','txt'
    file_hash_sha256            CHAR(64),                  -- dedupe guard
    file_size_bytes             BIGINT,

    -- Parsing
    parser_version              VARCHAR(20),
    parsed_at                   TIMESTAMP WITH TIME ZONE,
    parse_status                VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending','parsing','parsed','parse_failed','manually_entered'
    parse_confidence_pct        NUMERIC(5,2),              -- overall OCR/parser confidence
    parse_error_log             TEXT,

    lines_total                 INTEGER,
    lines_parsed                INTEGER,
    lines_manual_added          INTEGER NOT NULL DEFAULT 0,

    -- Lifecycle
    status                      VARCHAR(20) NOT NULL DEFAULT 'uploaded',
    -- 'uploaded','parsed','reconciling','reconciled','superseded','voided'
    uploaded_by                 UUID NOT NULL REFERENCES users(id),
    uploaded_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Supersession (when an amended statement replaces an earlier upload)
    supersedes_statement_id     UUID REFERENCES bank_statements(id),
    superseded_by_statement_id  UUID REFERENCES bank_statements(id),

    notes                       TEXT,

    CONSTRAINT uk_bank_statement_file_hash UNIQUE (tenant_id, file_hash_sha256),
    CONSTRAINT chk_bank_statement_period CHECK (period_end >= period_start)
);

CREATE INDEX idx_bank_statements_account_period ON bank_statements
    (tenant_id, account_id, period_end DESC);
CREATE INDEX idx_bank_statements_status ON bank_statements
    (tenant_id, status, uploaded_at DESC);

ALTER TABLE bank_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bank_statements FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 9.2 Bank Statement Lines

Parsed rows from the uploaded statement. Each row matches zero, one, or many journal lines through `bank_reconciliation_matches`.

```sql
bank_statement_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    statement_id                UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,

    -- As reported by bank
    line_number                 INTEGER NOT NULL,          -- ordinal within statement
    value_date                  DATE NOT NULL,
    posting_date                DATE,
    description                 TEXT,
    reference                   VARCHAR(100),              -- cheque#, SLIPS ref, etc.
    -- Counterparty info (often only in description; extracted where possible)
    counterparty_name           VARCHAR(200),
    counterparty_account_ref    VARCHAR(100),

    -- Signed amount (+ credit / inflow, - debit / outflow)
    amount_lkr                  NUMERIC(15,2) NOT NULL,
    direction                   VARCHAR(10) NOT NULL,      -- 'credit','debit'
    running_balance_lkr         NUMERIC(15,2),

    -- Classification (suggested by parser; accountant can override)
    suggested_transaction_type  VARCHAR(40),
    -- 'customer_receipt','supplier_payment','cheque_presented','cheque_issued',
    -- 'bank_charge','interest_earned','interest_paid','transfer_in','transfer_out',
    -- 'standing_order','reversal','other'

    -- Parse confidence
    parse_confidence_pct        NUMERIC(5,2),

    -- Reconciliation state (denormalized for fast filtering)
    match_status                VARCHAR(20) NOT NULL DEFAULT 'unmatched',
    -- 'unmatched','auto_matched','manual_matched','partially_matched','ignored','requires_investigation'
    matched_amount_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Source
    is_manually_added           BOOLEAN NOT NULL DEFAULT FALSE,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_bank_statement_line UNIQUE (statement_id, line_number),
    CONSTRAINT chk_bank_line_direction CHECK (direction IN ('credit','debit'))
);

CREATE INDEX idx_bsl_statement ON bank_statement_lines (tenant_id, statement_id, value_date);
CREATE INDEX idx_bsl_match_status ON bank_statement_lines
    (tenant_id, match_status, value_date DESC)
    WHERE match_status IN ('unmatched','partially_matched','requires_investigation');
CREATE INDEX idx_bsl_amount_date ON bank_statement_lines
    (tenant_id, amount_lkr, value_date)
    WHERE match_status = 'unmatched';

ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bank_statement_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 9.3 Bank Reconciliations (Session)

One reconciliation session per bank account per period. Holds the outcome state and links to the matched statement.

```sql
bank_reconciliations (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    account_id                  UUID NOT NULL REFERENCES chart_of_accounts(id),
    statement_id                UUID NOT NULL REFERENCES bank_statements(id),

    -- Period
    period_start                DATE NOT NULL,
    period_end                  DATE NOT NULL,
    fiscal_period_id            UUID REFERENCES fiscal_periods(id),

    -- Balances at reconciliation point
    book_balance_opening_lkr    NUMERIC(15,2) NOT NULL,     -- sum of journal_lines up to period_start
    book_balance_closing_lkr    NUMERIC(15,2) NOT NULL,
    bank_balance_opening_lkr    NUMERIC(15,2) NOT NULL,     -- from statement
    bank_balance_closing_lkr    NUMERIC(15,2) NOT NULL,

    -- Reconciliation math
    outstanding_deposits_lkr    NUMERIC(15,2) NOT NULL DEFAULT 0,  -- in books, not yet on bank
    outstanding_withdrawals_lkr NUMERIC(15,2) NOT NULL DEFAULT 0,  -- in books, not yet on bank
    unrecorded_bank_credits_lkr NUMERIC(15,2) NOT NULL DEFAULT 0,  -- on bank, not yet in books
    unrecorded_bank_debits_lkr  NUMERIC(15,2) NOT NULL DEFAULT 0,
    adjusted_book_balance_lkr   NUMERIC(15,2) NOT NULL,
    variance_lkr                NUMERIC(15,2) NOT NULL,            -- should be 0 at completion

    -- State
    status                      VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    -- 'in_progress','reconciled','abandoned','disputed'
    started_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_by                  UUID NOT NULL REFERENCES users(id),
    completed_at                TIMESTAMP WITH TIME ZONE,
    completed_by                UUID REFERENCES users(id),

    -- Unmatched items aging flag (accountant dashboard trigger from §13.3)
    unmatched_items_count       INTEGER NOT NULL DEFAULT 0,
    oldest_unmatched_date       DATE,

    -- Lock on completion — reconciled items become immutable per §13.3
    locked                      BOOLEAN NOT NULL DEFAULT FALSE,

    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by                  UUID,
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_bank_rec_account_period UNIQUE (tenant_id, account_id, period_end, status)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT chk_bank_rec_period CHECK (period_end >= period_start)
);

CREATE INDEX idx_bank_rec_account ON bank_reconciliations
    (tenant_id, account_id, period_end DESC);
CREATE INDEX idx_bank_rec_status ON bank_reconciliations
    (tenant_id, status, period_end DESC);
CREATE INDEX idx_bank_rec_aging ON bank_reconciliations
    (tenant_id, oldest_unmatched_date)
    WHERE status = 'in_progress' AND unmatched_items_count > 0;

ALTER TABLE bank_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bank_reconciliations FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 9.4 Bank Reconciliation Matches

Many-to-many link between `bank_statement_lines` and `journal_lines`. A single statement line can match multiple journal lines (deposit-of-multiple-receipts) or a single journal line can match multiple statement lines (partial clearances).

```sql
bank_reconciliation_matches (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    reconciliation_id           UUID NOT NULL REFERENCES bank_reconciliations(id) ON DELETE CASCADE,

    -- The two sides
    statement_line_id           UUID NOT NULL REFERENCES bank_statement_lines(id),
    journal_line_id             UUID NOT NULL,              -- composite FK (journal_lines is partitioned)
    journal_line_entry_date     DATE NOT NULL,              -- partition key

    -- Matched amount (supports partial matches)
    matched_amount_lkr          NUMERIC(15,2) NOT NULL,

    -- Classification
    match_type                  VARCHAR(20) NOT NULL,
    -- 'auto_high_confidence','auto_low_confidence','manual','adjustment_created'
    confidence_pct              NUMERIC(5,2),

    -- When match created a compensating entry (e.g., bank charge not in books)
    creates_adjustment_journal  BOOLEAN NOT NULL DEFAULT FALSE,
    adjustment_journal_entry_id UUID REFERENCES journal_entries(id),

    -- Who / when
    matched_by                  UUID NOT NULL REFERENCES users(id),
    matched_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Unmatching (before reconciliation locks)
    unmatched_at                TIMESTAMP WITH TIME ZONE,
    unmatched_by                UUID REFERENCES users(id),
    unmatch_reason              TEXT,

    notes                       TEXT,

    CONSTRAINT chk_bank_match_type CHECK (match_type IN (
        'auto_high_confidence','auto_low_confidence','manual','adjustment_created'
    )),
    CONSTRAINT chk_bank_match_amount CHECK (matched_amount_lkr > 0)
);

CREATE INDEX idx_brm_reconciliation ON bank_reconciliation_matches
    (tenant_id, reconciliation_id);
CREATE INDEX idx_brm_statement_line ON bank_reconciliation_matches
    (tenant_id, statement_line_id)
    WHERE unmatched_at IS NULL;
CREATE INDEX idx_brm_journal_line ON bank_reconciliation_matches
    (tenant_id, journal_line_id)
    WHERE unmatched_at IS NULL;

ALTER TABLE bank_reconciliation_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bank_reconciliation_matches FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Auto-match algorithm** (application-layer): for each unmatched `bank_statement_lines` row, search `journal_lines` where `account_id = reconciliation.account_id AND ABS(debit_lkr - credit_lkr - statement_line.amount_lkr) < 0.01 AND entry_date BETWEEN value_date - 5 AND value_date + 5`. Confidence boost for reference-string match (cheque number, SLIPS ref). Matches with confidence ≥ 90% auto-tick; below threshold flagged for manual review (§13.1).

**Completion**: on `status → 'reconciled'`, all matched journal_lines get flagged as `is_bank_reconciled = TRUE` (column already present on journal_lines? if not, derivable from existence of a non-unmatched `bank_reconciliation_matches` row). Reconciliation row locks; no further match changes allowed.

---

## 10. Bad Debt Write-offs & Recovery

Referenced by `accounting-module-spec.md §11` (5 subsections: write-off flow, VAT bad-debt relief per SL VAT Act, customer flagging, recovery flow, reports). Integrated with Customer Credit Limits (§8 Layer 2) — write-off auto-sets `customers.credit_limit_lkr = 0` and triggers a `customer_credit_limit_history` row (Part 3 §3.4).

### 10.1 Bad Debt Write-offs

```sql
bad_debt_writeoffs (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    customer_id                 UUID NOT NULL REFERENCES customers(id),

    -- Scope: what was written off
    writeoff_date               DATE NOT NULL,
    writeoff_type               VARCHAR(20) NOT NULL,
    -- 'full_balance'       — entire outstanding
    -- 'partial'            — specific amount
    -- 'specific_invoices'  — named invoices only

    writeoff_amount_lkr         NUMERIC(15,2) NOT NULL,
    -- gross amount (includes VAT portion when applicable)

    -- Affected invoices (when writeoff_type='specific_invoices')
    invoice_ids                 UUID[],
    -- otherwise: all_open_invoices as of writeoff_date, resolved at application layer

    -- Reason
    reason_code                 VARCHAR(40) NOT NULL,
    -- 'bankruptcy','dispute_settled','aged_beyond_recovery','legal_loss',
    -- 'fraud_confirmed','deceased','other'
    reason_detail               TEXT NOT NULL,
    supporting_document_ids     UUID[],  -- documents(id) — legal letter, bankruptcy notice, etc.

    -- VAT bad-debt relief (§11.2 — SL VAT Act: relief on debts > 12 months)
    vat_relief_eligible         BOOLEAN NOT NULL DEFAULT FALSE,
    vat_relief_amount_lkr       NUMERIC(15,2) NOT NULL DEFAULT 0,
    vat_relief_period           VARCHAR(7),              -- "2026-04" — VAT return period relief filed in
    vat_relief_posted_at        TIMESTAMP WITH TIME ZONE,
    vat_relief_journal_entry_id UUID REFERENCES journal_entries(id),

    -- GL posting (DR Bad Debt Expense / CR Customer Receivable)
    journal_entry_id            UUID REFERENCES journal_entries(id),

    -- Approval
    requires_approval           BOOLEAN NOT NULL DEFAULT TRUE,
    approval_instance_id        UUID REFERENCES approval_instances(id),
    approved_by                 UUID REFERENCES users(id),
    approved_at                 TIMESTAMP WITH TIME ZONE,

    -- Lifecycle
    status                      VARCHAR(20) NOT NULL DEFAULT 'pending_approval',
    -- 'pending_approval','posted','recovered','partially_recovered','reversed'
    posted_at                   TIMESTAMP WITH TIME ZONE,

    -- Recovery tracking (denormalized)
    total_recovered_lkr         NUMERIC(15,2) NOT NULL DEFAULT 0,
    last_recovery_at            TIMESTAMP WITH TIME ZONE,

    -- Credit limit side effect (§11.3)
    credit_limit_reset_at       TIMESTAMP WITH TIME ZONE,   -- when customers.credit_limit_lkr set to 0
    credit_limit_history_id     UUID,                       -- references customer_credit_limit_history(id)

    initiated_by                UUID NOT NULL REFERENCES users(id),

    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT chk_bad_debt_amount CHECK (writeoff_amount_lkr > 0),
    CONSTRAINT chk_bad_debt_vat CHECK (vat_relief_amount_lkr <= writeoff_amount_lkr)
);

CREATE INDEX idx_bdw_customer ON bad_debt_writeoffs
    (tenant_id, customer_id, writeoff_date DESC);
CREATE INDEX idx_bdw_status ON bad_debt_writeoffs
    (tenant_id, status, writeoff_date DESC);
CREATE INDEX idx_bdw_vat_pending ON bad_debt_writeoffs
    (tenant_id, writeoff_date)
    WHERE vat_relief_eligible = TRUE AND vat_relief_posted_at IS NULL;
CREATE INDEX idx_bdw_reason ON bad_debt_writeoffs
    (tenant_id, reason_code, writeoff_date DESC);

ALTER TABLE bad_debt_writeoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bad_debt_writeoffs FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 10.2 Bad Debt Recoveries

```sql
bad_debt_recoveries (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    writeoff_id                 UUID NOT NULL REFERENCES bad_debt_writeoffs(id),
    customer_id                 UUID NOT NULL REFERENCES customers(id),

    recovery_date               DATE NOT NULL,
    recovery_amount_lkr         NUMERIC(15,2) NOT NULL,

    -- Payment source (how the recovery arrived)
    receipt_id                  UUID,                      -- REFERENCES receipts(id) when via standard receipt flow
    payment_method              VARCHAR(20),               -- mirrors receipts.tender_method for manual entries

    -- GL posting (reverses DR Bad Debt Expense / CR Bad Debt Recovery or DR Cash / CR Bad Debt Recovery)
    journal_entry_id            UUID REFERENCES journal_entries(id),

    -- VAT relief reversal (§11.4 — bad debt VAT relief must be reversed on recovery)
    vat_relief_reversal_amount_lkr NUMERIC(15,2) NOT NULL DEFAULT 0,
    vat_relief_reversal_period  VARCHAR(7),
    vat_relief_reversal_journal_entry_id UUID REFERENCES journal_entries(id),

    -- Credit limit restoration hint (requires Owner review — not automatic)
    credit_limit_restoration_flagged BOOLEAN NOT NULL DEFAULT FALSE,

    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by                  UUID NOT NULL,

    CONSTRAINT chk_bdr_amount CHECK (recovery_amount_lkr > 0)
);

CREATE INDEX idx_bdr_writeoff ON bad_debt_recoveries
    (tenant_id, writeoff_id, recovery_date DESC);
CREATE INDEX idx_bdr_customer ON bad_debt_recoveries
    (tenant_id, customer_id, recovery_date DESC);
CREATE INDEX idx_bdr_vat_pending_reversal ON bad_debt_recoveries
    (tenant_id, recovery_date)
    WHERE vat_relief_reversal_amount_lkr > 0 AND vat_relief_reversal_journal_entry_id IS NULL;

ALTER TABLE bad_debt_recoveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bad_debt_recoveries FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Recovery update trigger**: each `bad_debt_recoveries` insert bumps `bad_debt_writeoffs.total_recovered_lkr` and `last_recovery_at`. When `total_recovered_lkr >= writeoff_amount_lkr` the writeoff flips to `status='recovered'`; partial to `'partially_recovered'`.

**VAT relief timing**: per SL VAT Act, relief is filed in the VAT return for the period of write-off (forward, not backdated). On recovery, the relief is reversed in the VAT return for the period of recovery. The two journal entries post to the appropriate VAT Output Adjustments account and show in the VAT Adjustments Register (`accounting-module-spec.md §14`).

---

## 11. Common Journal Posting Patterns

Reference patterns for each transaction type. Application code generates these.

### 11.1 Sales Invoice Posting

```
Dr. Accounts Receivable       Customer Control Account       1180.00
    Cr. Sales Revenue                                           1000.00
    Cr. Output VAT Payable                                       180.00

Dr. Cost of Goods Sold                                         600.00
    Cr. Inventory                                                600.00
```

### 11.2 Bill Posting (Purchase with WHT)

```
Dr. Office Rent Expense                                      100000.00
Dr. Input VAT Receivable                                      18000.00
    Cr. Accounts Payable — Supplier                            108000.00
    Cr. WHT Payable (Rent 10%)                                  10000.00
```

### 11.3 Payroll Posting

```
Dr. Salary Expense                                           500000.00
Dr. EPF Employer Expense (12%)                                60000.00
Dr. ETF Expense (3%)                                          15000.00
    Cr. Salary Payable                                          480000.00  (net pay)
    Cr. EPF Employee Payable (8%)                                40000.00
    Cr. PAYE Payable                                             20000.00
    Cr. EPF Employer Payable                                     60000.00
    Cr. ETF Payable                                              15000.00
```

### 11.4 GRN Accrual (before Bill arrives)

```
Dr. Inventory                                                 50000.00
Dr. Input VAT Receivable (Accrued)                             9000.00
    Cr. GRN Clearing Account                                    59000.00

-- When Bill arrives and matches:
Dr. GRN Clearing Account                                      59000.00
    Cr. Accounts Payable                                        59000.00
```

---

## 12. Next Parts

- **Part 5 — Transactions**: invoices, bills, receipts, payments, GRNs, cheques, POS (where the journal patterns actually get generated)
- **Part 6 — Payroll & HR**: employee master, salary structures, payroll runs, leave, loans
- **Part 7 — System**: audit log, document storage, notifications, workflows, number series, integrations, plans
- **Part 8 — Performance & ERDs**: indexes, partitioning, materialized views, Mermaid diagrams, RLS examples

---

*Document version: 1.0 · Part 4/8 · Accounting · Scope: Sri Lanka only · Full system (not MVP)*

*Decisions locked in Round 4: Chart of Accounts with unlimited-depth hierarchy, system-required flag preventing deletion of critical accounts, control vs posting account distinction, full SL account type taxonomy with VAT/WHT/AR/AP/inventory flags; materialized views for current and period balances; tag_master as tenant-defined dimensional tag library (separate from fixed dimensions), applied via `tag_id` FK on journal_entries and journal_lines, editable post-posting as non-financial field; journal_entries as the GL spine with polymorphic source linkage, full multi-currency support, 2-tier period lock enforcement, immutability via triggers after posting, reversal pattern via paired entries; journal_lines with comprehensive dimensions (branch, cost center, customer, supplier, employee, item, project, tag) enabling any slice-and-dice reporting; recurring_journal_templates with flexible frequency (monthly / bi-monthly / quarterly / half-yearly / yearly / custom_cron), JSONB-stored lines, configurable auto-post vs draft review, three amount bases (fixed / cpi_indexed / formula), occurrence cap + pause/resume lifecycle, scheduler-driven materialization via `scheduled_jobs` (Part 7) with polymorphic linkage on generated entries; tax_codes with effective dating for govt rate changes, compound tax calculation basis, eligible/ineligible Input VAT flag, WHT category/supplier-type derivation, stamp duty thresholds; tax_rules for conditional WHT auto-derivation; fiscal_years + fiscal_periods with soft/hard lock states and reopening audit; exchange_rates with rate types (spot/monthly/year-end/custom) and fx_revaluations for period-end unrealized gain/loss per SLFRS 21; fixed_asset_categories with default depreciation policy (SLM/WDV/SOYD/none) and full GL account mapping (asset / accumulated-dep / dep-expense / gain / loss / revaluation-reserve / impairment); fixed_assets register with parallel book + tax depreciation policies (both tracks tracked simultaneously, book posts to GL, tax reported separately for IRD), full lifecycle state machine (in_service / idle / under_maintenance / disposed / written_off / held_for_sale / impaired), linkage to source bill, attachments, custom fields; depreciation_schedules as per-asset-per-period-per-track projected-then-posted rows with supersession pattern for policy changes / revaluations / impairments; fixed_asset_events as immutable lifecycle ledger covering acquisition / addition / revaluation / impairment / reversal / reclassification / policy change / disposal / partial disposal / transfer / maintenance log, with approval routing for revaluations and disposals; budgets scoped per fiscal year + optional branch / cost center / tag dimensions with locked-flag workflow, budget_lines as per-account-per-month rows, actuals computed at report time from journal_lines (no precomputed variance table), CSV bulk upload supported; bank_statements with PDF/Excel/CSV upload + SHA-256 dedupe + supersession chain + parse-confidence tracking, bank_statement_lines with parser-suggested transaction type classification and denormalized match_status for fast unmatched-items queries, bank_reconciliations as per-account-per-period session with full balance reconciliation math (outstanding deposits / withdrawals / unrecorded credits + debits / adjusted book balance / variance) and unmatched-aging flag, bank_reconciliation_matches as many-to-many link between statement lines and journal lines with partial-match support + confidence scoring + adjustment-journal creation + reversible unmatch before session lock; bad_debt_writeoffs with 3 scope types (full balance / partial / specific invoices) + 7 reason codes + supporting-document linkage + SL VAT bad-debt-relief eligibility and auto-filing in VAT return + approval routing + credit-limit auto-reset integration with customer_credit_limit_history (Part 3 §3.4), bad_debt_recoveries with VAT-relief-reversal tracking + paired journal entries + denormalized totals rollup on parent writeoff flipping status between posted / partially_recovered / recovered.*
