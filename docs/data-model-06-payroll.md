# Data Model — Part 6: Payroll & HR

> The people side. Employee master, salary structure library and per-employee assignments, payroll runs with full calculation audit, payslips, statutory returns (EPF/ETF/PAYE), disbursement files for SL banks, leave management with balance ledger, loans with EMI schedules, bonus schemes, expense claims, and final settlement. Extends Parts 1-5. Target: Sri Lanka only. Scope: full system.

---

## 1. Scope

Defines:
- Employee master (core + extensions)
- Salary component library + structure templates + employee assignments
- Wage types (7 types, combinable)
- Commission schemes + rule engine + commission earnings ledger (with claw-back)
- Multi-branch salary allocation
- Attendance devices, biometric employee mapping, daily attendance records, file imports, exceptions
- Payroll runs + payroll_run_employees + payroll_run_employee_lines
- Payslips with versioning
- Statutory returns (EPF C-form, ETF return, PAYE T-10, T-9)
- Banks master + disbursement files
- Leave types, balances, applications, accrual event ledger
- Employee loans + EMI schedules + payments
- Bonus schemes + bonus runs
- Expense claims with OCR + petty cash linkage
- Final settlements with auto-gratuity

All tables tenant-scoped via RLS. All financial postings via `journal_entries` (Part 4). Two-stage posting (accrual at approval, settlement at disbursement).

---

## 2. Employee Master

### 2.1 Core Employees Table

```sql
employees (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Identity (frequently queried, inline)
    employee_code               VARCHAR(30) NOT NULL,
    first_name                  VARCHAR(100) NOT NULL,
    middle_name                 VARCHAR(100),
    last_name                   VARCHAR(100) NOT NULL,
    display_name                VARCHAR(200),
    gender                      VARCHAR(20),  -- 'male','female','other','prefer_not_to_say'
    date_of_birth               DATE,

    -- SL-specific identity
    nic                         VARCHAR(20),  -- old or new format NIC
    epf_number                  VARCHAR(30),  -- assigned by EPF department
    etf_number                  VARCHAR(30),
    tin                         VARCHAR(50),
    passport_number             VARCHAR(20),  -- for foreign nationals

    -- Contact (inline for quick lookup)
    personal_email              VARCHAR(200),
    work_email                  VARCHAR(200),
    mobile_phone                VARCHAR(20),
    home_phone                  VARCHAR(20),

    -- Current employment (inline)
    designation                 VARCHAR(200),
    department                  VARCHAR(100),
    employment_type             VARCHAR(30) NOT NULL DEFAULT 'permanent',
    -- 'permanent','contract','consultant','intern','temporary','part_time','apprentice'
    grade                       VARCHAR(30),
    employee_category           VARCHAR(30),
    -- 'executive','officer','labour','admin','technical','sales','other'

    -- Organizational
    primary_branch_id           UUID NOT NULL,
    reports_to_employee_id      UUID REFERENCES employees(id),

    -- Dates
    hire_date                   DATE NOT NULL,
    confirmed_date              DATE,  -- end of probation
    probation_end_date          DATE,
    contract_start_date         DATE,
    contract_end_date           DATE,
    exit_date                   DATE,
    rehire_eligible             BOOLEAN,

    -- Wage type
    wage_type_primary           VARCHAR(30) NOT NULL DEFAULT 'monthly',
    -- 'monthly','daily','hourly','piece','commission','contract','stipend'

    -- User account linkage
    user_id                     UUID,  -- references users(id) — NULL if employee has no login
    self_service_enabled        BOOLEAN NOT NULL DEFAULT FALSE,

    -- Status lifecycle
    status                      VARCHAR(30) NOT NULL DEFAULT 'active',
    -- 'applicant','offered','active','on_probation','confirmed','on_leave_extended',
    -- 'suspended','resigned','terminated','retired','deceased'
    -- Note: 'applicant','offered' reserved for future ATS; not used at launch.
    status_changed_at           TIMESTAMP WITH TIME ZONE,
    status_change_reason        TEXT,

    -- Statutory flags
    epf_eligible                BOOLEAN NOT NULL DEFAULT TRUE,
    etf_eligible                BOOLEAN NOT NULL DEFAULT TRUE,
    paye_applicable             BOOLEAN NOT NULL DEFAULT TRUE,
    paye_category               VARCHAR(30),  -- 'regular','non_resident','exempt','special'

    -- Biometric integration
    biometric_employee_id       VARCHAR(50),  -- ID from ZKTeco/eSSL device
    attendance_required         BOOLEAN NOT NULL DEFAULT TRUE,

    -- Display
    photo_url                   VARCHAR(500),

    -- Metadata
    tags                        JSONB,
    custom_fields_json          JSONB,
    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    deleted_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_employees_tenant_code UNIQUE (tenant_id, employee_code),
    CONSTRAINT uk_employees_tenant_nic UNIQUE (tenant_id, nic) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_employees_tenant_status ON employees (tenant_id, status);
CREATE INDEX idx_employees_tenant_branch ON employees (tenant_id, primary_branch_id, status);
CREATE INDEX idx_employees_tenant_reports_to ON employees (tenant_id, reports_to_employee_id) WHERE reports_to_employee_id IS NOT NULL;
CREATE INDEX idx_employees_tenant_name ON employees USING GIN ((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX idx_employees_nic ON employees (tenant_id, nic) WHERE nic IS NOT NULL;
CREATE INDEX idx_employees_epf_number ON employees (tenant_id, epf_number) WHERE epf_number IS NOT NULL;
CREATE INDEX idx_employees_biometric ON employees (tenant_id, biometric_employee_id) WHERE biometric_employee_id IS NOT NULL;

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employees FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.2 Employee Personal Details

```sql
employee_personal_details (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,

    -- Address
    permanent_address_json      JSONB,
    current_address_json        JSONB,
    same_as_permanent           BOOLEAN NOT NULL DEFAULT FALSE,

    -- Family
    marital_status              VARCHAR(30),  -- 'single','married','divorced','widowed','separated'
    spouse_name                 VARCHAR(200),
    spouse_nic                  VARCHAR(20),
    spouse_occupation           VARCHAR(200),
    spouse_employer             VARCHAR(200),

    -- Personal
    nationality                 VARCHAR(50) NOT NULL DEFAULT 'Sri Lankan',
    religion                    VARCHAR(50),
    ethnicity                   VARCHAR(50),
    blood_group                 VARCHAR(10),
    mother_tongue               VARCHAR(30),

    -- Languages known
    languages_known_json        JSONB,  -- [{"lang":"Sinhala","proficiency":"native"},...]

    -- Physical
    height_cm                   NUMERIC(5,2),
    weight_kg                   NUMERIC(5,2),

    -- Health
    has_medical_conditions      BOOLEAN,
    medical_conditions_notes    TEXT,
    known_allergies             TEXT,

    -- Legal
    has_criminal_record         BOOLEAN,
    criminal_record_notes       TEXT,

    -- Residency (for foreign employees)
    visa_type                   VARCHAR(50),
    visa_expiry_date            DATE,
    work_permit_number          VARCHAR(50),
    work_permit_expiry_date     DATE,

    custom_fields_json          JSONB,

    created_at, updated_at, version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_emp_personal_tenant ON employee_personal_details (tenant_id);

ALTER TABLE employee_personal_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_personal_details FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.3 Employee Dependents (for PAYE exemptions)

```sql
employee_dependents (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    relationship                VARCHAR(30) NOT NULL,
    -- 'spouse','child','parent','sibling','other'
    name                        VARCHAR(200) NOT NULL,
    nic                         VARCHAR(20),
    date_of_birth               DATE,
    is_financially_dependent    BOOLEAN NOT NULL DEFAULT FALSE,
    paye_exemption_claimed      BOOLEAN NOT NULL DEFAULT FALSE,
    is_emergency_contact        BOOLEAN NOT NULL DEFAULT FALSE,
    emergency_phone             VARCHAR(20),

    notes                       TEXT,
    created_at, updated_at, deleted_at
);

CREATE INDEX idx_emp_dependents_employee ON employee_dependents (tenant_id, employee_id);

ALTER TABLE employee_dependents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_dependents FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.4 Employee Emergency Contacts

```sql
employee_emergency_contacts (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    name                        VARCHAR(200) NOT NULL,
    relationship                VARCHAR(50),
    phone_primary               VARCHAR(20),
    phone_secondary             VARCHAR(20),
    email                       VARCHAR(200),
    address                     TEXT,
    is_primary                  BOOLEAN NOT NULL DEFAULT FALSE,
    priority                    SMALLINT DEFAULT 1,

    created_at, updated_at, deleted_at
);

CREATE INDEX idx_emp_emergency_employee ON employee_emergency_contacts (tenant_id, employee_id);

ALTER TABLE employee_emergency_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_emergency_contacts FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.5 Employee Bank Details

```sql
employee_bank_details (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    bank_id                     UUID NOT NULL,  -- references banks (section 9)
    bank_name_snapshot          VARCHAR(100),
    branch_name                 VARCHAR(100),
    branch_code                 VARCHAR(20),
    account_number              VARCHAR(50) NOT NULL,
    account_name                VARCHAR(200) NOT NULL,
    account_type                VARCHAR(30),  -- 'savings','current','salary'

    currency                    CHAR(3) DEFAULT 'LKR',
    is_primary                  BOOLEAN NOT NULL DEFAULT TRUE,
    salary_split_percentage     NUMERIC(5,2) DEFAULT 100,  -- for split-disbursement

    -- Verification
    verified                    BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at                 TIMESTAMP WITH TIME ZONE,
    verified_by                 UUID,
    verification_method         VARCHAR(30),  -- 'cheque_copy','bank_letter','micro_deposit'

    effective_from              DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_until             DATE,

    created_at, updated_at, deleted_at
);

CREATE INDEX idx_emp_bank_employee ON employee_bank_details (tenant_id, employee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_emp_bank_primary ON employee_bank_details (tenant_id, employee_id)
    WHERE is_primary = TRUE AND deleted_at IS NULL;

ALTER TABLE employee_bank_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_bank_details FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.6 Employee Education

```sql
employee_education (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    qualification_level         VARCHAR(50),  -- 'ol','al','diploma','degree','postgrad','doctorate','professional'
    qualification_name          VARCHAR(200) NOT NULL,
    institution                 VARCHAR(200),
    field_of_study              VARCHAR(200),
    year_of_completion          INTEGER,
    grade_or_class              VARCHAR(30),  -- '1st Class','2nd Upper', etc.
    percentage_or_gpa           NUMERIC(5,2),
    certificate_document_id     UUID,
    is_verified                 BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at                 TIMESTAMP WITH TIME ZONE,
    verified_by                 UUID,

    notes                       TEXT,
    created_at, updated_at, deleted_at
);

CREATE INDEX idx_emp_education_employee ON employee_education (tenant_id, employee_id);
ALTER TABLE employee_education ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_education FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.7 Employee Experience (Previous Employment)

```sql
employee_experience (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    employer_name               VARCHAR(200) NOT NULL,
    designation                 VARCHAR(200),
    industry                    VARCHAR(100),
    start_date                  DATE,
    end_date                    DATE,  -- NULL = current
    responsibilities            TEXT,
    reason_for_leaving          VARCHAR(100),
    last_drawn_salary_lkr       NUMERIC(15,2),
    supervisor_contact          VARCHAR(200),
    reference_letter_doc_id     UUID,

    is_verified                 BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at                 TIMESTAMP WITH TIME ZONE,
    verified_by                 UUID,

    notes                       TEXT,
    created_at, updated_at, deleted_at
);

CREATE INDEX idx_emp_experience_employee ON employee_experience (tenant_id, employee_id);
ALTER TABLE employee_experience ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_experience FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.8 Employee Documents

```sql
employee_documents (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    document_type               VARCHAR(50) NOT NULL,
    -- 'appointment_letter','nic_copy','passport_copy','photo','bank_statement',
    -- 'epf_form','etf_form','medical_certificate','offer_letter','resignation_letter',
    -- 'experience_letter','certificate','other'
    document_name               VARCHAR(200),
    file_url                    VARCHAR(500) NOT NULL,  -- S3 URL
    file_size_bytes             BIGINT,
    mime_type                   VARCHAR(100),

    uploaded_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    uploaded_by                 UUID,
    is_confidential             BOOLEAN NOT NULL DEFAULT FALSE,

    expires_at                  DATE,  -- for passport/visa/work permit
    expiry_reminder_sent        BOOLEAN DEFAULT FALSE,

    notes                       TEXT,
    created_at, updated_at, deleted_at
);

CREATE INDEX idx_emp_documents_employee ON employee_documents (tenant_id, employee_id, document_type);
CREATE INDEX idx_emp_documents_expiring ON employee_documents (tenant_id, expires_at)
    WHERE expires_at IS NOT NULL;

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_documents FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 2.9 Employee Branch Allocations (Multi-Branch Salary Splits)

```sql
employee_branch_allocations (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id),

    effective_from              DATE NOT NULL,
    effective_until             DATE,

    allocations_json            JSONB NOT NULL,
    -- [{"branch_id": "...", "percentage": 60}, {"branch_id": "...", "percentage": 40}]
    -- Sum must = 100

    reason                      VARCHAR(200),  -- why split created
    approved_by                 UUID,

    created_at, updated_at, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_emp_branch_alloc UNIQUE (employee_id, effective_from)
);

CREATE INDEX idx_emp_branch_alloc_employee ON employee_branch_allocations (tenant_id, employee_id, effective_from DESC);

ALTER TABLE employee_branch_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_branch_allocations FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

Default behavior: no allocation row = 100% to `employees.primary_branch_id`.

### 2.10 Employee Wage Types (Combinable)

```sql
employee_wage_types (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id),

    wage_type                   VARCHAR(30) NOT NULL,
    -- 'monthly','daily','hourly','piece','commission','contract','stipend'
    is_primary                  BOOLEAN NOT NULL DEFAULT FALSE,

    rate_amount                 NUMERIC(15,4) NOT NULL,
    rate_basis                  VARCHAR(30) NOT NULL DEFAULT 'fixed',
    -- 'fixed','sliding_scale','formula'

    -- Wage-type-specific fields
    commission_scheme_id        UUID,  -- for commission type
    piece_rate_unit             VARCHAR(30),  -- "per garment","per piece"
    contract_deliverable        TEXT,  -- for contract type
    calculation_params_json     JSONB,

    effective_from              DATE NOT NULL,
    effective_until             DATE,

    notes                       TEXT,
    created_at, updated_at, deleted_at
);

CREATE INDEX idx_emp_wage_employee ON employee_wage_types (tenant_id, employee_id, effective_from DESC);

ALTER TABLE employee_wage_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_wage_types FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 3. Salary Structure

### 3.1 Salary Components Library

```sql
salary_components (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    code                        VARCHAR(30) NOT NULL,  -- 'BASIC','BRA','COLA','OT15','EPF_EE','PAYE'
    name                        VARCHAR(100) NOT NULL,
    description                 TEXT,

    component_type              VARCHAR(30) NOT NULL,
    -- 'earning','deduction','employer_contribution','statutory','reimbursement'
    sub_type                    VARCHAR(50),
    -- For earnings: 'basic','allowance','overtime','bonus','commission','shift'
    -- For deductions: 'statutory_deduction','loan','advance','other_deduction'

    -- Calculation
    calculation_method          VARCHAR(30) NOT NULL,
    -- 'fixed','percentage_of_basic','percentage_of_gross','formula',
    -- 'attendance_based','slab_based','external_input'
    formula_expression          TEXT,  -- e.g. "basic * 0.10"
    formula_json                JSONB,
    slab_rules_json             JSONB,  -- for PAYE-style slabs

    -- Tax / statutory behavior (critical for SL)
    is_taxable                  BOOLEAN NOT NULL DEFAULT TRUE,
    is_epf_liable               BOOLEAN NOT NULL DEFAULT FALSE,
    is_etf_liable               BOOLEAN NOT NULL DEFAULT FALSE,
    is_bonus_base               BOOLEAN NOT NULL DEFAULT FALSE,
    is_gratuity_base            BOOLEAN NOT NULL DEFAULT FALSE,
    is_ot_base                  BOOLEAN NOT NULL DEFAULT FALSE,

    -- GL mapping
    expense_account_id          UUID,
    payable_account_id          UUID,  -- for deductions and employer contributions

    -- Display / payslip
    display_on_payslip          BOOLEAN NOT NULL DEFAULT TRUE,
    payslip_category            VARCHAR(50),  -- grouping on payslip
    display_order               SMALLINT DEFAULT 100,

    -- Lockdown
    is_system_locked            BOOLEAN NOT NULL DEFAULT FALSE,
    -- true = statutory components (EPF/ETF/PAYE); can be configured but not deleted
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,

    -- Min/max bounds (safety)
    min_value_lkr               NUMERIC(15,2),
    max_value_lkr               NUMERIC(15,2),

    tags                        JSONB,
    created_at, updated_at, deleted_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_salary_components_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_salary_components_tenant_type ON salary_components (tenant_id, component_type, is_active);

ALTER TABLE salary_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON salary_components FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.2 Salary Structure Templates

```sql
salary_structure_templates (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    name                        VARCHAR(200) NOT NULL,
    description                 TEXT,

    applies_to_rule             VARCHAR(30),  -- 'all','by_department','by_designation','by_grade','by_category'
    applies_to_filter_json      JSONB,

    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,

    created_at, updated_at, deleted_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1
);

salary_structure_template_components (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    template_id                 UUID NOT NULL REFERENCES salary_structure_templates(id) ON DELETE CASCADE,
    component_id                UUID NOT NULL REFERENCES salary_components(id),

    default_value               NUMERIC(15,2),
    default_calculation_params  JSONB,
    is_mandatory                BOOLEAN NOT NULL DEFAULT FALSE,
    display_order               SMALLINT DEFAULT 100,

    created_at, updated_at,

    CONSTRAINT uk_template_components UNIQUE (template_id, component_id)
);

CREATE INDEX idx_sst_tenant_active ON salary_structure_templates (tenant_id, is_active);
CREATE INDEX idx_sstc_template ON salary_structure_template_components (tenant_id, template_id);

ALTER TABLE salary_structure_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_structure_template_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON salary_structure_templates FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON salary_structure_template_components FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.3 Employee Salary Structures (Effective-Dated Per Employee)

```sql
employee_salary_structures (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id),

    effective_from              DATE NOT NULL,
    effective_until             DATE,

    structure_template_id       UUID,  -- if created from template

    reason_for_change           VARCHAR(50),
    -- 'new_hire','promotion','annual_increment','role_change',
    -- 'correction','salary_review','demotion','cost_adjustment','restructuring'
    change_details              TEXT,
    previous_structure_id       UUID REFERENCES employee_salary_structures(id),

    -- Approval
    approved_by                 UUID,
    approved_at                 TIMESTAMP WITH TIME ZONE,
    approval_instance_id        UUID,

    -- Status
    status                      VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft','pending_approval','approved','active','superseded','voided'

    notes                       TEXT,
    created_at, updated_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_emp_salary_structure UNIQUE (employee_id, effective_from)
);

CREATE INDEX idx_ess_employee_effective ON employee_salary_structures (tenant_id, employee_id, effective_from DESC);
CREATE INDEX idx_ess_active ON employee_salary_structures (tenant_id, status) WHERE status = 'active';

ALTER TABLE employee_salary_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_salary_structures FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.4 Employee Salary Components (Per Employee, Input Parameters)

```sql
employee_salary_components (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_salary_structure_id UUID NOT NULL REFERENCES employee_salary_structures(id) ON DELETE CASCADE,
    component_id                UUID NOT NULL REFERENCES salary_components(id),

    -- Input parameters (not computed value)
    value                       NUMERIC(15,4),  -- for fixed components
    calculation_params_json     JSONB,
    -- For % based: {"percentage": 10, "base": "basic"}
    -- For formula: {"formula": "basic * 0.15", "vars": {...}}
    -- For attendance: {"per_day_rate": 2000, "max_days": 30}

    -- Overrides
    override_reason             TEXT,

    -- Validity override (e.g., special allowance only for Jan-Mar)
    effective_from_override     DATE,
    effective_until_override    DATE,

    notes                       TEXT,
    created_at, updated_at,

    CONSTRAINT uk_esc_structure_component UNIQUE (employee_salary_structure_id, component_id)
);

CREATE INDEX idx_esc_structure ON employee_salary_components (tenant_id, employee_salary_structure_id);
CREATE INDEX idx_esc_component ON employee_salary_components (tenant_id, component_id);

ALTER TABLE employee_salary_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_salary_components FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

### 3.5 Commission Schemes & Earnings

Referenced by `sell-module-spec.md §10 Commission Engine` and `employee_wage_types.commission_scheme_id` (§2). Per Sell module: pre-built rule types (flat %, tiered, per-item/category, per-customer-segment, net-of-returns, on-collection), tenant-customizable composable rules, multi-rule aggregation, claw-backs on returns, auto-flow to payroll.

#### `commission_schemes` — tenant library of named schemes

```sql
commission_schemes (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Identity
    code                        VARCHAR(40) NOT NULL,      -- "SALES_TIER_2025", "WHOLESALE_STD"
    name                        VARCHAR(120) NOT NULL,
    description                 TEXT,

    -- Accrual trigger
    accrual_basis               VARCHAR(20) NOT NULL,
    -- 'on_invoice_post'   — commission earned when invoice posts (retail default)
    -- 'on_collection'     — commission earned only on customer receipt/allocation (wholesale SL)
    -- 'on_delivery'       — commission earned on DN

    -- Claw-back policy (applies when source invoice credit-noted)
    clawback_on_return          BOOLEAN NOT NULL DEFAULT TRUE,
    clawback_proportional       BOOLEAN NOT NULL DEFAULT TRUE,  -- partial return → proportional claw-back

    -- Payout cadence (payroll integration)
    payout_frequency            VARCHAR(20) NOT NULL DEFAULT 'monthly',
    -- 'monthly','quarterly','on_collection'
    payout_lag_days             SMALLINT NOT NULL DEFAULT 0,  -- delay before commission becomes payable (cooling-off for returns)

    -- Multi-rule aggregation
    aggregation_mode            VARCHAR(20) NOT NULL DEFAULT 'sum_all_matching',
    -- 'sum_all_matching'  — every matching rule adds up (default)
    -- 'highest_only'      — only the highest-value matching rule applies
    -- 'first_match'       — only first matching rule in priority order

    -- Lifecycle
    effective_from              DATE NOT NULL,
    effective_until             DATE,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_commission_scheme_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_commission_schemes_active ON commission_schemes (tenant_id, is_active, effective_from);

ALTER TABLE commission_schemes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON commission_schemes FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

#### `commission_scheme_rules` — individual rules within a scheme

```sql
commission_scheme_rules (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    scheme_id                   UUID NOT NULL REFERENCES commission_schemes(id) ON DELETE CASCADE,

    priority                    SMALLINT NOT NULL,  -- evaluated ascending; used by 'first_match' aggregation

    -- Rule type
    rule_type                   VARCHAR(30) NOT NULL,
    -- 'flat_pct','tiered_volume','per_item','per_category','per_customer_segment','per_brand','custom_formula'

    -- Scope filters (null = applies to all)
    item_id                     UUID,
    category_id                 UUID,
    brand                       VARCHAR(100),
    customer_segment            VARCHAR(60),   -- 'new','repeat','wholesale','retail', tenant-defined
    customer_id                 UUID,          -- for single-customer override
    min_margin_pct              NUMERIC(5,2),  -- only apply if line margin meets floor
    max_margin_pct              NUMERIC(5,2),

    -- Rate calculation
    basis                       VARCHAR(20) NOT NULL DEFAULT 'line_net',
    -- 'line_net','line_gross','line_margin','line_qty'

    -- For flat_pct and per_*
    rate_pct                    NUMERIC(7,4),        -- e.g. 2.5 = 2.5%
    rate_per_unit_lkr           NUMERIC(15,4),       -- alt: flat LKR per unit

    -- For tiered_volume (JSON tier table)
    tiers_json                  JSONB,
    -- Example: [{"up_to_lkr":1000000,"pct":1.0},{"up_to_lkr":5000000,"pct":2.0},{"up_to_lkr":null,"pct":3.0}]
    tier_accumulator            VARCHAR(30),
    -- 'salesperson_month','salesperson_quarter','salesperson_year','per_invoice'

    -- For custom_formula
    formula_expression          TEXT,  -- evaluated in application layer with guarded variables

    -- Caps
    max_commission_per_line_lkr     NUMERIC(15,2),
    max_commission_per_invoice_lkr  NUMERIC(15,2),

    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,

    created_at, updated_at      TIMESTAMP WITH TIME ZONE,

    CONSTRAINT chk_rule_has_rate CHECK (
        rule_type = 'custom_formula'
        OR rate_pct IS NOT NULL
        OR rate_per_unit_lkr IS NOT NULL
        OR tiers_json IS NOT NULL
    )
);

CREATE INDEX idx_commission_rules_scheme ON commission_scheme_rules (tenant_id, scheme_id, priority);
CREATE INDEX idx_commission_rules_item ON commission_scheme_rules (tenant_id, item_id)
    WHERE item_id IS NOT NULL;
CREATE INDEX idx_commission_rules_category ON commission_scheme_rules (tenant_id, category_id)
    WHERE category_id IS NOT NULL;

ALTER TABLE commission_scheme_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON commission_scheme_rules FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

#### `commission_earnings` — per-transaction accrual ledger

Feeds payroll as an earning component and powers the commission ledger per salesperson (earnings, claw-backs, payouts).

```sql
commission_earnings (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Subject
    employee_id                 UUID NOT NULL REFERENCES employees(id),
    scheme_id                   UUID NOT NULL REFERENCES commission_schemes(id),
    rule_id                     UUID REFERENCES commission_scheme_rules(id),  -- which rule fired

    -- Source (polymorphic — commission can derive from invoice, invoice_line, or receipt allocation)
    source_type                 VARCHAR(30) NOT NULL,
    -- 'invoice','invoice_line','receipt_allocation','credit_note','credit_note_line'
    source_id                   UUID NOT NULL,
    source_line_id              UUID,        -- when source_type includes _line
    source_invoice_id           UUID,        -- denormalized for fast filtering
    source_customer_id          UUID,        -- denormalized

    -- Split (one invoice/line can split across multiple salespeople)
    split_pct                   NUMERIC(5,2) NOT NULL DEFAULT 100.00,

    -- Amounts
    basis_amount_lkr            NUMERIC(15,2) NOT NULL,  -- the measured base (line_net, margin, etc.)
    commission_amount_lkr       NUMERIC(15,2) NOT NULL,

    -- Lifecycle
    status                      VARCHAR(20) NOT NULL DEFAULT 'accrued',
    -- 'accrued'    — earned but not yet payable (within payout_lag_days or waiting for collection)
    -- 'payable'    — released to payroll; awaiting next run
    -- 'paid'       — included in a payroll_run
    -- 'clawed_back'— reversed due to return/void
    -- 'void'       — manually voided

    accrued_on                  DATE NOT NULL,
    payable_on                  DATE,
    paid_on                     DATE,
    paid_in_payroll_run_id      UUID REFERENCES payroll_runs(id),

    -- Reversal linkage
    reverses_earning_id         UUID REFERENCES commission_earnings(id),
    reversed_by_earning_id      UUID REFERENCES commission_earnings(id),
    reversal_reason             VARCHAR(60),  -- 'customer_return','invoice_void','manual_adjust'

    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by                  UUID,

    CONSTRAINT chk_commission_split_pct CHECK (split_pct > 0 AND split_pct <= 100)
);

CREATE INDEX idx_commission_earn_employee_period ON commission_earnings
    (tenant_id, employee_id, accrued_on DESC);
CREATE INDEX idx_commission_earn_status_payable ON commission_earnings
    (tenant_id, status, payable_on)
    WHERE status IN ('accrued','payable');
CREATE INDEX idx_commission_earn_source ON commission_earnings
    (tenant_id, source_type, source_id);
CREATE INDEX idx_commission_earn_invoice ON commission_earnings
    (tenant_id, source_invoice_id)
    WHERE source_invoice_id IS NOT NULL;
CREATE INDEX idx_commission_earn_payroll_run ON commission_earnings
    (tenant_id, paid_in_payroll_run_id)
    WHERE paid_in_payroll_run_id IS NOT NULL;

ALTER TABLE commission_earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON commission_earnings FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Payroll integration**: a payroll run's eligibility query pulls `commission_earnings WHERE status = 'payable' AND payable_on <= run_period_end AND employee_id IN (...)`, maps each row to a payslip earning line with `component_type = 'commission'`, and flips rows to `status='paid'` with `paid_in_payroll_run_id` on run post.

**Claw-back**: when an invoice is credit-noted or voided, the orchestrator (Part 5 §10) emits a reversal row with `reverses_earning_id` pointing at the original, negative `commission_amount_lkr`, and `status='clawed_back'`. If the original is still `accrued` or `payable`, it is also flipped to `clawed_back` and never reaches payroll. If already `paid`, the reversal is queued as a negative earning in the next run.

---

## 4. Attendance Tracking

Referenced by `business-tenant-layer2-spec.md §5 Attendance Tracking`. Five capture methods (live biometric API, biometric file import, manual entry, mobile app, supervisor proxy), per-branch device registry, validation + exception handling, and direct flow into payroll calculation for attendance-based wage types. All attendance records are per-employee-per-day unique and drive wage calculation for daily/hourly/piece-rate workers.

### 4.1 Attendance Devices

Tenant-scoped registry of biometric devices and other capture endpoints.

```sql
attendance_devices (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Identity
    branch_id                   UUID REFERENCES branches(id),
    name                        VARCHAR(100) NOT NULL,     -- "Main gate — ZKTeco K40"
    device_code                 VARCHAR(50) NOT NULL,      -- short code used in UI
    vendor                      VARCHAR(60),               -- 'ZKTeco','Suprema','eSSL','Realtime','Other'
    model                       VARCHAR(80),
    serial_number               VARCHAR(80),
    firmware_version            VARCHAR(40),

    -- Integration
    integration_mode            VARCHAR(20) NOT NULL,
    -- 'live_api'        — polls device via network API
    -- 'file_import'     — admin uploads CSV/Excel from device export
    -- 'manual_only'     — no device, manual entry
    -- 'mobile_app'      — employee app check-in/out
    api_endpoint                VARCHAR(255),
    api_credentials_ref         VARCHAR(100),             -- vault reference; never plaintext
    poll_interval_minutes       SMALLINT,                 -- null for non-live
    timezone                    VARCHAR(50) DEFAULT 'Asia/Colombo',

    -- Health
    last_sync_at                TIMESTAMP WITH TIME ZONE,
    last_sync_status            VARCHAR(20),              -- 'success','failed','stale'
    last_sync_error             TEXT,
    consecutive_failures        SMALLINT NOT NULL DEFAULT 0,

    -- Status
    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','suspended','retired'
    installed_at                DATE,
    retired_at                  DATE,
    retired_reason              TEXT,

    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    created_by                  UUID,
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_attendance_devices_code UNIQUE (tenant_id, device_code)
);

CREATE INDEX idx_attendance_devices_branch ON attendance_devices (tenant_id, branch_id, status);
CREATE INDEX idx_attendance_devices_stale ON attendance_devices (tenant_id, last_sync_at)
    WHERE status = 'active' AND integration_mode = 'live_api';

ALTER TABLE attendance_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_devices FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.2 Biometric Employee Map

Maps device-side employee identifiers to platform `employees(id)`. Many employees may have several device codes across several devices (multi-site staff).

```sql
biometric_employee_map (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    employee_id                 UUID NOT NULL REFERENCES employees(id),
    device_id                   UUID NOT NULL REFERENCES attendance_devices(id),

    device_employee_code        VARCHAR(50) NOT NULL,     -- the ID the device reports for this employee
    enrolled_at                 DATE,
    enrolled_by                 UUID REFERENCES users(id),

    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    deactivated_at              TIMESTAMP WITH TIME ZONE,
    deactivated_reason          TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_biometric_map UNIQUE (tenant_id, device_id, device_employee_code)
);

CREATE INDEX idx_biometric_map_employee ON biometric_employee_map (tenant_id, employee_id, is_active);
CREATE INDEX idx_biometric_map_device ON biometric_employee_map (tenant_id, device_id, is_active);

ALTER TABLE biometric_employee_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON biometric_employee_map FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.3 Attendance Records

One row per employee per day. Stores aggregated shift state; raw punches can be expanded if needed (deferred — SL norm is single IN + single OUT).

```sql
attendance_records (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Subject
    employee_id                 UUID NOT NULL REFERENCES employees(id),
    branch_id                   UUID REFERENCES branches(id),

    attendance_date             DATE NOT NULL,

    -- Daily status
    status                      VARCHAR(20) NOT NULL,
    -- 'present','absent','half_day','leave','holiday','weekly_off','weekly_off_worked'

    -- Punches
    check_in_at                 TIMESTAMP WITH TIME ZONE,
    check_out_at                TIMESTAMP WITH TIME ZONE,
    break_minutes               SMALLINT DEFAULT 0,
    hours_worked                NUMERIC(5,2),
    overtime_hours              NUMERIC(5,2) DEFAULT 0,
    late_minutes                SMALLINT DEFAULT 0,
    early_leave_minutes         SMALLINT DEFAULT 0,

    -- Shift
    shift_code                  VARCHAR(40),             -- tenant-defined shift identifier
    expected_hours              NUMERIC(5,2),

    -- Source
    source                      VARCHAR(20) NOT NULL,
    -- 'biometric_live','biometric_file','manual','mobile_app','supervisor_proxy'
    device_id                   UUID REFERENCES attendance_devices(id),
    file_import_id              UUID REFERENCES attendance_file_imports(id),
    entered_by                  UUID REFERENCES users(id),
    entered_on_behalf_of        BOOLEAN NOT NULL DEFAULT FALSE,

    -- Linked leave (if status = 'leave' or 'half_day')
    leave_application_id        UUID REFERENCES leave_applications(id),

    -- Validation
    validation_status           VARCHAR(20) NOT NULL DEFAULT 'valid',
    -- 'valid','exception_unresolved','exception_resolved','overridden'
    override_reason             TEXT,
    overridden_by               UUID REFERENCES users(id),
    overridden_at               TIMESTAMP WITH TIME ZONE,

    -- Payroll linkage (set when consumed by a run; read-only after)
    payroll_run_id              UUID REFERENCES payroll_runs(id),
    consumed_for_payroll_at     TIMESTAMP WITH TIME ZONE,

    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by                  UUID,
    updated_by                  UUID,

    CONSTRAINT uk_attendance_employee_date UNIQUE (tenant_id, employee_id, attendance_date),
    CONSTRAINT chk_attendance_punches CHECK (
        check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at
    )
);

-- Partition by attendance_date (monthly) — high write volume, time-bounded queries
-- Indexes assume partitioning

CREATE INDEX idx_attendance_employee_date ON attendance_records
    (tenant_id, employee_id, attendance_date DESC);
CREATE INDEX idx_attendance_branch_date ON attendance_records
    (tenant_id, branch_id, attendance_date DESC);
CREATE INDEX idx_attendance_status_date ON attendance_records
    (tenant_id, attendance_date, status);
CREATE INDEX idx_attendance_exceptions ON attendance_records
    (tenant_id, validation_status, attendance_date DESC)
    WHERE validation_status IN ('exception_unresolved','exception_resolved');
CREATE INDEX idx_attendance_unconsumed ON attendance_records
    (tenant_id, attendance_date, employee_id)
    WHERE payroll_run_id IS NULL;

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_records FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Immutability once consumed**: a trigger blocks edits to `attendance_records` where `payroll_run_id IS NOT NULL` except on `notes`. Corrections post-payroll follow the attendance-adjustment flow (reversal record + new record) with audit trail.

### 4.4 Attendance File Imports

Audit of CSV/Excel uploads from biometric devices (the common SL deployment path where devices aren't network-integrated).

```sql
attendance_file_imports (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Source
    source_device_id            UUID REFERENCES attendance_devices(id),  -- null if cross-device batch
    uploaded_by                 UUID NOT NULL REFERENCES users(id),
    uploaded_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- File
    file_url                    VARCHAR(500) NOT NULL,    -- S3 reference
    file_name                   VARCHAR(200) NOT NULL,
    file_size_bytes             BIGINT,
    file_hash_sha256            CHAR(64),                 -- dedupe guard
    file_format                 VARCHAR(20),              -- 'csv','xlsx','dat','txt'

    -- Covered period (from rows, not filename)
    period_start                DATE,
    period_end                  DATE,

    -- Counts
    records_total               INTEGER,
    records_imported            INTEGER,
    records_skipped             INTEGER,                  -- duplicates, out-of-period
    records_failed              INTEGER,                  -- unmapped device_id, validation errors
    employees_covered           INTEGER,

    -- State
    status                      VARCHAR(20) NOT NULL DEFAULT 'processing',
    -- 'processing','completed','completed_with_errors','failed','rolled_back'
    started_at                  TIMESTAMP WITH TIME ZONE,
    completed_at                TIMESTAMP WITH TIME ZONE,
    rolled_back_at              TIMESTAMP WITH TIME ZONE,
    rolled_back_by              UUID REFERENCES users(id),
    rolled_back_reason          TEXT,

    error_log                   TEXT,
    summary_json                JSONB,                    -- per-employee counts, exception rollup

    CONSTRAINT uk_attendance_file_hash UNIQUE (tenant_id, file_hash_sha256)
);

CREATE INDEX idx_attendance_imports_recent ON attendance_file_imports
    (tenant_id, uploaded_at DESC);
CREATE INDEX idx_attendance_imports_device ON attendance_file_imports
    (tenant_id, source_device_id, uploaded_at DESC)
    WHERE source_device_id IS NOT NULL;

ALTER TABLE attendance_file_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_file_imports FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Rollback**: if an import is flagged wrong (e.g., mixed-up device export), `status='rolled_back'` cascades to all `attendance_records WHERE file_import_id = :id AND payroll_run_id IS NULL`, deleting them. Records already consumed by a posted payroll run cannot be rolled back — an adjustment workflow runs instead.

### 4.5 Attendance Exceptions

Captured during import or live sync when a record fails validation (missing punch, impossible hours, unmapped device code, punch outside shift window).

```sql
attendance_exceptions (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Source
    attendance_record_id        UUID REFERENCES attendance_records(id),  -- null if could not create record
    file_import_id              UUID REFERENCES attendance_file_imports(id),
    device_id                   UUID REFERENCES attendance_devices(id),

    -- What we saw
    raw_device_employee_code    VARCHAR(50),
    raw_timestamp               TIMESTAMP WITH TIME ZONE,
    raw_payload                 JSONB,

    -- What's wrong
    exception_type              VARCHAR(40) NOT NULL,
    -- 'missing_check_out','missing_check_in','impossible_hours','outside_shift',
    -- 'duplicate_record','unmapped_device_code','inactive_employee',
    -- 'conflicting_leave','future_date','stale_sync','other'
    exception_detail            TEXT,

    detected_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    severity                    VARCHAR(10) NOT NULL DEFAULT 'warning',
    -- 'warning','error'

    -- Resolution
    resolved                    BOOLEAN NOT NULL DEFAULT FALSE,
    resolution                  VARCHAR(40),
    -- 'manually_entered','overridden','ignored','employee_mapped','record_corrected'
    resolved_by                 UUID REFERENCES users(id),
    resolved_at                 TIMESTAMP WITH TIME ZONE,
    resolution_notes            TEXT
);

CREATE INDEX idx_attendance_exceptions_unresolved ON attendance_exceptions
    (tenant_id, detected_at DESC)
    WHERE resolved = FALSE;
CREATE INDEX idx_attendance_exceptions_import ON attendance_exceptions
    (tenant_id, file_import_id)
    WHERE file_import_id IS NOT NULL;
CREATE INDEX idx_attendance_exceptions_employee ON attendance_exceptions
    (tenant_id, attendance_record_id)
    WHERE attendance_record_id IS NOT NULL;

ALTER TABLE attendance_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_exceptions FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.6 Payroll Integration

During payroll calculation (Part 6 §5.x — payroll run step 2: "compute"), the engine pulls `attendance_records WHERE tenant_id = ? AND employee_id IN (...) AND attendance_date BETWEEN period_start AND period_end AND payroll_run_id IS NULL`, aggregates per employee (present days, half days, overtime hours, late-deduction basis), and feeds into wage-type-specific formulas (`calculation_params_json` on `employee_wage_types` — e.g. `{"per_day_rate": 2000}` for daily wage).

On run approval, matching records are flipped to `payroll_run_id = :run_id, consumed_for_payroll_at = NOW()`. Unresolved exceptions (`validation_status = 'exception_unresolved'`) block the run — the user must resolve or override before proceeding.

---

## 5. Payroll Runs

### 5.1 Payroll Run Header

```sql
payroll_runs (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    run_number                  VARCHAR(50) NOT NULL,
    run_type                    VARCHAR(30) NOT NULL,
    -- 'regular_monthly','off_cycle','bonus','final_settlement','correction','advance'

    pay_period_start            DATE NOT NULL,
    pay_period_end              DATE NOT NULL,
    payment_date                DATE NOT NULL,

    -- Scope
    applies_to                  VARCHAR(30) NOT NULL DEFAULT 'all_employees',
    -- 'all_employees','branch','department','designation','selected_employees'
    scope_filter_json           JSONB,

    -- Currency
    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',

    -- Fiscal period
    fiscal_year                 INTEGER,
    period_number               INTEGER,

    -- Totals (computed from employees)
    total_gross_earnings_lkr    NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_deductions_lkr        NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_net_pay_lkr           NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Statutory totals
    total_epf_employee_lkr      NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_epf_employer_lkr      NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_etf_lkr               NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_paye_lkr              NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_other_statutory_lkr   NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Employer cost (gross + employer contribs)
    total_employer_cost_lkr     NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Counts
    employee_count              INTEGER NOT NULL DEFAULT 0,
    error_count                 INTEGER NOT NULL DEFAULT 0,
    adjusted_count              INTEGER NOT NULL DEFAULT 0,

    -- 6-step workflow status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','calculating','calculated','pending_review','review_completed',
    -- 'pending_approval','approved','disbursement_prepared','disbursed','posted',
    -- 'cancelled','superseded'

    -- Step timestamps
    calculated_at               TIMESTAMP WITH TIME ZONE,
    calculated_by               UUID,
    reviewed_at                 TIMESTAMP WITH TIME ZONE,
    reviewed_by                 UUID,
    approved_at                 TIMESTAMP WITH TIME ZONE,
    approved_by                 UUID,
    approval_instance_id        UUID,

    disbursement_prepared_at    TIMESTAMP WITH TIME ZONE,
    disbursement_file_id        UUID,
    disbursed_at                TIMESTAMP WITH TIME ZONE,
    disbursed_by                UUID,

    -- GL posting (two-stage)
    accrual_journal_entry_id    UUID,  -- posted at approval
    accrual_posted_at           TIMESTAMP WITH TIME ZONE,
    settlement_journal_entry_id UUID,  -- posted at disbursement
    settlement_posted_at        TIMESTAMP WITH TIME ZONE,

    -- Cancellation
    cancelled_at                TIMESTAMP WITH TIME ZONE,
    cancelled_by                UUID,
    cancel_reason               TEXT,

    -- Correction
    supersedes_run_id           UUID REFERENCES payroll_runs(id),
    superseded_by_run_id        UUID REFERENCES payroll_runs(id),

    notes                       TEXT,
    internal_notes              TEXT,
    tags                        JSONB,

    created_at, updated_at, deleted_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_payroll_runs_tenant_number UNIQUE (tenant_id, run_number)
);

CREATE INDEX idx_payroll_runs_tenant_period ON payroll_runs (tenant_id, pay_period_start DESC, pay_period_end DESC);
CREATE INDEX idx_payroll_runs_tenant_status ON payroll_runs (tenant_id, status);
CREATE INDEX idx_payroll_runs_tenant_type ON payroll_runs (tenant_id, run_type, payment_date DESC);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_runs FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.2 Payroll Run Employees

```sql
payroll_run_employees (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    run_id                      UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id                 UUID NOT NULL REFERENCES employees(id),

    -- Employee snapshot (frozen at calculation)
    employee_snapshot_json      JSONB NOT NULL,
    -- {"name":"...","nic":"...","designation":"...","branch_id":"...","epf_number":"..."}
    salary_structure_id         UUID,  -- which structure was used

    -- Attendance inputs
    days_in_period              INTEGER NOT NULL,
    days_worked                 NUMERIC(6,2) NOT NULL DEFAULT 0,
    days_paid_leave             NUMERIC(6,2) NOT NULL DEFAULT 0,
    days_unpaid_leave           NUMERIC(6,2) NOT NULL DEFAULT 0,
    days_absent                 NUMERIC(6,2) NOT NULL DEFAULT 0,
    hours_worked                NUMERIC(8,2) DEFAULT 0,
    hours_overtime              NUMERIC(8,2) DEFAULT 0,
    lop_days                    NUMERIC(6,2) DEFAULT 0,  -- loss of pay days

    -- Computed totals per employee
    gross_earnings_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_deductions_lkr        NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_pay_lkr                 NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Statutory per employee
    epf_base_lkr                NUMERIC(15,2) NOT NULL DEFAULT 0,  -- sum of EPF-liable components
    epf_employee_lkr            NUMERIC(15,2) NOT NULL DEFAULT 0,
    epf_employer_lkr            NUMERIC(15,2) NOT NULL DEFAULT 0,
    etf_lkr                     NUMERIC(15,2) NOT NULL DEFAULT 0,
    paye_lkr                    NUMERIC(15,2) NOT NULL DEFAULT 0,
    paye_taxable_income_lkr     NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Bonuses / loans / expenses applied
    bonus_additions_lkr         NUMERIC(15,2) DEFAULT 0,
    loan_deductions_lkr         NUMERIC(15,2) DEFAULT 0,
    advance_deductions_lkr      NUMERIC(15,2) DEFAULT 0,
    expense_reimbursements_lkr  NUMERIC(15,2) DEFAULT 0,

    -- Branch split (for GL posting)
    branch_split_json           JSONB,
    -- [{"branch_id":"...","percentage":60,"amount_lkr":...}, ...]

    -- Payslip reference
    payslip_id                  UUID,

    -- Disbursement
    disbursement_status         VARCHAR(20) DEFAULT 'pending',
    -- 'pending','sent','bounced','completed','held','failed'
    disbursement_amount_lkr     NUMERIC(15,2),
    bank_transaction_reference  VARCHAR(100),
    bank_account_snapshot_json  JSONB,

    -- Flags
    has_errors                  BOOLEAN NOT NULL DEFAULT FALSE,
    error_notes                 TEXT,
    manually_adjusted           BOOLEAN NOT NULL DEFAULT FALSE,
    adjustment_reason           TEXT,
    adjusted_by                 UUID,
    adjusted_at                 TIMESTAMP WITH TIME ZONE,

    -- Held (salary withheld pending investigation)
    is_held                     BOOLEAN NOT NULL DEFAULT FALSE,
    hold_reason                 TEXT,
    held_by                     UUID,

    notes                       TEXT,
    created_at, updated_at, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_pre_run_employee UNIQUE (run_id, employee_id)
);

CREATE INDEX idx_pre_run ON payroll_run_employees (tenant_id, run_id);
CREATE INDEX idx_pre_employee ON payroll_run_employees (tenant_id, employee_id, created_at DESC);
CREATE INDEX idx_pre_errors ON payroll_run_employees (tenant_id, run_id) WHERE has_errors = TRUE;
CREATE INDEX idx_pre_held ON payroll_run_employees (tenant_id, run_id) WHERE is_held = TRUE;

ALTER TABLE payroll_run_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_run_employees FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.3 Payroll Run Employee Lines

One row per component per employee per run. Full traceability.

```sql
payroll_run_employee_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    run_employee_id             UUID NOT NULL REFERENCES payroll_run_employees(id) ON DELETE CASCADE,
    run_id                      UUID NOT NULL,  -- denormalized for fast queries
    employee_id                 UUID NOT NULL,
    component_id                UUID NOT NULL REFERENCES salary_components(id),

    -- Component snapshot
    component_code              VARCHAR(30) NOT NULL,
    component_name              VARCHAR(100) NOT NULL,
    component_type              VARCHAR(30) NOT NULL,
    sub_type                    VARCHAR(50),

    -- Calculation
    calculation_method          VARCHAR(30) NOT NULL,
    calculation_input_json      JSONB,
    -- Snapshot of inputs: {"percentage":10,"base_value":50000}
    computed_value_lkr          NUMERIC(15,2) NOT NULL,

    -- Adjustment
    adjusted_value_lkr          NUMERIC(15,2),  -- manual override
    final_value_lkr             NUMERIC(15,2) NOT NULL,  -- used in totals
    adjustment_reason           TEXT,

    -- Statutory flags (from component at run time — snapshot)
    is_taxable                  BOOLEAN NOT NULL,
    is_epf_liable               BOOLEAN NOT NULL,
    is_etf_liable               BOOLEAN NOT NULL,

    -- GL info (for posting)
    expense_account_id          UUID,
    payable_account_id          UUID,
    cost_center_id              UUID,

    display_order               SMALLINT DEFAULT 100,

    notes                       TEXT,
    created_at, updated_at
);

CREATE INDEX idx_prel_run_employee ON payroll_run_employee_lines (tenant_id, run_employee_id);
CREATE INDEX idx_prel_run_component ON payroll_run_employee_lines (tenant_id, run_id, component_id);
CREATE INDEX idx_prel_employee_component ON payroll_run_employee_lines (tenant_id, employee_id, component_id, created_at DESC);

ALTER TABLE payroll_run_employee_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_run_employee_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 6. Payslips

```sql
payslips (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    payslip_number              VARCHAR(50) NOT NULL,
    run_id                      UUID NOT NULL REFERENCES payroll_runs(id),
    run_employee_id             UUID NOT NULL REFERENCES payroll_run_employees(id),
    employee_id                 UUID NOT NULL REFERENCES employees(id),

    pay_period_start            DATE NOT NULL,
    pay_period_end              DATE NOT NULL,
    payment_date                DATE NOT NULL,

    -- Versioning
    version_number              SMALLINT NOT NULL DEFAULT 1,
    regenerated_from_id         UUID REFERENCES payslips(id),
    superseded_by_id            UUID REFERENCES payslips(id),
    superseded_at               TIMESTAMP WITH TIME ZONE,

    -- Frozen snapshots
    employee_snapshot_json      JSONB NOT NULL,
    company_snapshot_json       JSONB NOT NULL,
    -- Company: {"name":"","address":"","logo_url":"","vat":"","signatory":""}

    -- Totals
    gross_earnings_lkr          NUMERIC(15,2) NOT NULL,
    total_deductions_lkr        NUMERIC(15,2) NOT NULL,
    net_pay_lkr                 NUMERIC(15,2) NOT NULL,

    -- Breakdown for rendering
    earnings_breakdown_json     JSONB NOT NULL,
    deductions_breakdown_json   JSONB NOT NULL,
    employer_contributions_breakdown_json JSONB NOT NULL,

    -- YTD cumulative
    ytd_gross_lkr               NUMERIC(15,2),
    ytd_paye_lkr                NUMERIC(15,2),
    ytd_epf_employee_lkr        NUMERIC(15,2),
    ytd_epf_employer_lkr        NUMERIC(15,2),
    ytd_etf_lkr                 NUMERIC(15,2),

    -- Distribution
    pdf_url                     VARCHAR(500),
    nic_password_hint           CHAR(4),  -- last 4 of NIC
    delivered_via               VARCHAR(20),
    -- 'email','portal','print','whatsapp_future','sms_future'
    delivered_at                TIMESTAMP WITH TIME ZONE,
    viewed_at                   TIMESTAMP WITH TIME ZONE,

    -- Employee acknowledgment / dispute
    acknowledged_at             TIMESTAMP WITH TIME ZONE,
    acknowledgment_method       VARCHAR(20),  -- 'portal','email_reply','signed_copy'
    disputed_at                 TIMESTAMP WITH TIME ZONE,
    dispute_reason              TEXT,

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','generated','distributed','acknowledged','disputed','superseded','voided'

    notes                       TEXT,
    created_at, updated_at, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_payslips_tenant_number UNIQUE (tenant_id, payslip_number, version_number)
);

CREATE INDEX idx_payslips_employee ON payslips (tenant_id, employee_id, payment_date DESC);
CREATE INDEX idx_payslips_run ON payslips (tenant_id, run_id);
CREATE INDEX idx_payslips_current_version ON payslips (tenant_id, employee_id, pay_period_start)
    WHERE superseded_at IS NULL;

ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payslips FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 7. Statutory Returns

```sql
statutory_returns (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    return_number               VARCHAR(50) NOT NULL,
    return_type                 VARCHAR(50) NOT NULL,
    -- 'epf_c_form','etf_return','paye_t10_monthly',
    -- 'paye_t9_annual_employer','paye_t10_annual_employee'

    period_type                 VARCHAR(20) NOT NULL,  -- 'monthly','annual'
    period_year                 INTEGER NOT NULL,
    period_month                SMALLINT,  -- NULL for annual

    -- Source payroll runs contributing to this return
    source_payroll_run_ids      UUID[] NOT NULL,

    -- Aggregates
    total_employees             INTEGER NOT NULL DEFAULT 0,
    total_contribution_lkr      NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_employer_portion_lkr  NUMERIC(15,2),
    total_employee_portion_lkr  NUMERIC(15,2),
    summary_json                JSONB NOT NULL,
    -- Type-specific aggregates

    -- Generated file
    return_file_url             VARCHAR(500),
    return_file_format          VARCHAR(20),  -- 'csv','xml','pdf','excel'
    return_file_generated_at    TIMESTAMP WITH TIME ZONE,
    return_file_version         SMALLINT DEFAULT 1,

    -- Submission
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','generating','generated','ready_to_submit','submitted',
    -- 'acknowledged_by_authority','rejected','amended','superseded'

    submitted_at                TIMESTAMP WITH TIME ZONE,
    submitted_by                UUID,
    submission_method           VARCHAR(30),  -- 'online_portal','offline_counter','courier'
    submission_reference        VARCHAR(100),
    acknowledgment_received_at  TIMESTAMP WITH TIME ZONE,
    acknowledgment_reference    VARCHAR(100),
    rejection_reason            TEXT,

    -- Contribution payment (employer remits the money)
    payment_required            BOOLEAN NOT NULL DEFAULT TRUE,
    payment_amount_lkr          NUMERIC(15,2),
    payment_due_date            DATE,
    payment_date                DATE,
    payment_reference           VARCHAR(100),
    payment_journal_entry_id    UUID,

    -- Amendments
    supersedes_return_id        UUID REFERENCES statutory_returns(id),
    superseded_by_return_id     UUID REFERENCES statutory_returns(id),
    amendment_reason            TEXT,

    notes                       TEXT,
    created_at, updated_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_statutory_returns_tenant_number UNIQUE (tenant_id, return_number)
);

statutory_return_employees (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    return_id                   UUID NOT NULL REFERENCES statutory_returns(id) ON DELETE CASCADE,
    employee_id                 UUID NOT NULL REFERENCES employees(id),

    -- Employee snapshot
    employee_name_snapshot      VARCHAR(200) NOT NULL,
    nic_snapshot                VARCHAR(20),
    epf_number_snapshot         VARCHAR(30),
    designation_snapshot        VARCHAR(200),

    -- Period contribution
    gross_earnings_lkr          NUMERIC(15,2),
    epf_base_lkr                NUMERIC(15,2),
    employee_contribution_lkr   NUMERIC(15,2),
    employer_contribution_lkr   NUMERIC(15,2),
    paye_deducted_lkr           NUMERIC(15,2),
    days_worked                 NUMERIC(6,2),

    -- Type-specific
    details_json                JSONB,

    created_at, updated_at,

    CONSTRAINT uk_sre_return_employee UNIQUE (return_id, employee_id)
);

CREATE INDEX idx_statutory_returns_tenant_period ON statutory_returns (tenant_id, return_type, period_year, period_month);
CREATE INDEX idx_statutory_returns_status ON statutory_returns (tenant_id, status);
CREATE INDEX idx_sre_return ON statutory_return_employees (tenant_id, return_id);
CREATE INDEX idx_sre_employee ON statutory_return_employees (tenant_id, employee_id);

ALTER TABLE statutory_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory_return_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON statutory_returns FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON statutory_return_employees FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 8. Banks Master & Disbursement Files

### 8.1 Banks Master (Platform-Level)

```sql
banks (
    id                          UUID PRIMARY KEY,

    bank_code                   VARCHAR(30) NOT NULL UNIQUE,
    -- 'commercial','hnb','sampath','boc','peoples','ndb','nsb','seylan',
    -- 'pan_asia','dfcc','nations_trust','cargills','other'
    bank_name                   VARCHAR(100) NOT NULL,
    short_name                  VARCHAR(50),
    swift_code                  VARCHAR(20),

    -- SLIPS participation
    is_slips_participant        BOOLEAN NOT NULL DEFAULT FALSE,
    slips_member_id             VARCHAR(20),

    -- Disbursement file format
    disbursement_file_format    VARCHAR(30),  -- 'csv','xml','fixed_width','excel','mt100'
    file_format_spec_json       JSONB,
    -- Field mappings, delimiters, headers required, etc.

    -- Operational
    country                     CHAR(2) NOT NULL DEFAULT 'LK',
    currency                    CHAR(3) DEFAULT 'LKR',
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,

    -- Contact
    head_office_address         TEXT,
    customer_service_number     VARCHAR(20),
    website                     VARCHAR(200),

    logo_url                    VARCHAR(500),

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_banks_code ON banks (bank_code);
CREATE INDEX idx_banks_active ON banks (is_active);
```

Platform-managed. No tenant_id. Seeded with all major SL banks.

### 8.2 Disbursement Files

```sql
disbursement_files (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    file_number                 VARCHAR(50) NOT NULL,

    source_type                 VARCHAR(30) NOT NULL,
    -- 'payroll','supplier_payment_batch','bonus_run','final_settlement',
    -- 'commission_run','advance_payment','statutory_remittance'
    source_payroll_run_id       UUID,
    source_payment_batch_id     UUID,

    -- Bank and format
    bank_id                     UUID NOT NULL REFERENCES banks(id),
    file_format                 VARCHAR(30) NOT NULL,
    file_format_version         VARCHAR(20),

    -- Transaction summary
    total_transactions          INTEGER NOT NULL,
    successful_count            INTEGER NOT NULL DEFAULT 0,
    failed_count                INTEGER NOT NULL DEFAULT 0,
    total_amount_lkr            NUMERIC(15,2) NOT NULL,
    transaction_date            DATE NOT NULL,

    -- From-account
    from_bank_account_id        UUID NOT NULL,
    from_account_name           VARCHAR(200),
    from_account_number         VARCHAR(50),

    -- File artifacts
    file_url                    VARCHAR(500),
    file_hash                   VARCHAR(128),
    file_size_bytes             BIGINT,
    generated_at                TIMESTAMP WITH TIME ZONE,
    generated_by                UUID,

    -- Lifecycle
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','generated','approved','uploaded_to_bank','processing',
    -- 'completed','partial_failure','failed','cancelled'

    approved_by                 UUID,
    approved_at                 TIMESTAMP WITH TIME ZONE,
    uploaded_at                 TIMESTAMP WITH TIME ZONE,
    uploaded_by                 UUID,
    bank_reference_number       VARCHAR(100),

    completed_at                TIMESTAMP WITH TIME ZONE,
    failure_report_json         JSONB,
    failure_report_url          VARCHAR(500),

    notes                       TEXT,
    created_at, updated_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_disbursement_files_tenant_number UNIQUE (tenant_id, file_number)
);

disbursement_file_transactions (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    disbursement_file_id        UUID NOT NULL REFERENCES disbursement_files(id) ON DELETE CASCADE,
    line_number                 INTEGER NOT NULL,

    recipient_type              VARCHAR(20) NOT NULL,  -- 'employee','supplier','other'
    recipient_id                UUID,  -- employee_id or supplier_id
    recipient_name_snapshot     VARCHAR(200) NOT NULL,
    recipient_bank_id           UUID REFERENCES banks(id),
    recipient_bank_name         VARCHAR(100),
    recipient_branch_code       VARCHAR(20),
    recipient_branch_name       VARCHAR(100),
    recipient_account_number    VARCHAR(50) NOT NULL,
    recipient_account_name      VARCHAR(200) NOT NULL,

    amount_lkr                  NUMERIC(15,2) NOT NULL,
    narrative                   VARCHAR(200),
    our_reference               VARCHAR(50),

    -- Result
    transaction_status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending','successful','failed','returned','duplicate','rejected'
    bank_response_code          VARCHAR(30),
    bank_response_message       TEXT,
    settled_at                  TIMESTAMP WITH TIME ZONE,

    -- Retry
    retry_count                 SMALLINT DEFAULT 0,
    next_retry_at               TIMESTAMP WITH TIME ZONE,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_dft_file_line UNIQUE (disbursement_file_id, line_number)
);

CREATE INDEX idx_disbursement_files_tenant ON disbursement_files (tenant_id, transaction_date DESC);
CREATE INDEX idx_disbursement_files_status ON disbursement_files (tenant_id, status);
CREATE INDEX idx_dft_file ON disbursement_file_transactions (tenant_id, disbursement_file_id);
CREATE INDEX idx_dft_recipient ON disbursement_file_transactions (tenant_id, recipient_type, recipient_id);
CREATE INDEX idx_dft_failed ON disbursement_file_transactions (tenant_id, transaction_status)
    WHERE transaction_status IN ('failed','returned');

ALTER TABLE disbursement_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement_file_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON disbursement_files FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON disbursement_file_transactions FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 9. Leave Management

### 9.1 Leave Types

```sql
leave_types (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    code                        VARCHAR(30) NOT NULL,
    name                        VARCHAR(100) NOT NULL,
    description                 TEXT,

    -- Behavior
    is_paid                     BOOLEAN NOT NULL DEFAULT TRUE,
    is_encashable               BOOLEAN NOT NULL DEFAULT FALSE,
    is_carry_forward            BOOLEAN NOT NULL DEFAULT FALSE,
    max_carry_forward_days      NUMERIC(6,2),
    max_accrual_days            NUMERIC(6,2),

    accrual_method              VARCHAR(30) NOT NULL DEFAULT 'upfront_yearly',
    -- 'upfront_yearly','monthly_proration','on_completion_of_year','none'
    annual_entitlement_default  NUMERIC(6,2),
    accrual_rate_per_month      NUMERIC(6,2),

    -- Eligibility
    min_service_months          INTEGER DEFAULT 0,
    gender_specific             VARCHAR(20),  -- NULL,'male','female'
    employment_types_eligible   VARCHAR(50)[],  -- e.g., {'permanent','contract'}

    -- Application behavior
    requires_medical_certificate BOOLEAN NOT NULL DEFAULT FALSE,
    min_days_per_application    NUMERIC(6,2) DEFAULT 0.5,
    max_days_per_application    NUMERIC(6,2),
    min_notice_days             INTEGER DEFAULT 0,
    allow_half_day              BOOLEAN NOT NULL DEFAULT TRUE,
    allow_past_dated            BOOLEAN NOT NULL DEFAULT TRUE,

    -- Approval
    approval_workflow_template_id UUID,

    -- Payroll impact
    affects_attendance          BOOLEAN NOT NULL DEFAULT TRUE,
    -- true = reduces days_worked in payroll

    -- Display
    is_system_required          BOOLEAN NOT NULL DEFAULT FALSE,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    display_order               SMALLINT DEFAULT 100,
    color                       VARCHAR(10),  -- hex for calendar display

    notes                       TEXT,
    created_at, updated_at, deleted_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_leave_types_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX idx_leave_types_tenant_active ON leave_types (tenant_id, is_active);

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON leave_types FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 9.2 Employee Leave Balances

```sql
employee_leave_balances (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id),
    leave_type_id               UUID NOT NULL REFERENCES leave_types(id),

    balance_year                INTEGER NOT NULL,
    -- Components of balance
    opening_balance             NUMERIC(6,2) NOT NULL DEFAULT 0,  -- carry-forward
    accrued                     NUMERIC(6,2) NOT NULL DEFAULT 0,
    used                        NUMERIC(6,2) NOT NULL DEFAULT 0,
    adjusted                    NUMERIC(6,2) NOT NULL DEFAULT 0,  -- manual +/-
    encashed                    NUMERIC(6,2) NOT NULL DEFAULT 0,
    expired                     NUMERIC(6,2) NOT NULL DEFAULT 0,

    closing_balance_projected   NUMERIC(6,2) NOT NULL DEFAULT 0,
    closing_balance_computed    NUMERIC(6,2),  -- at year-end, finalized
    last_accrual_date           DATE,

    notes                       TEXT,
    created_at, updated_at, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_elb UNIQUE (employee_id, leave_type_id, balance_year)
);

CREATE INDEX idx_elb_employee_year ON employee_leave_balances (tenant_id, employee_id, balance_year);
CREATE INDEX idx_elb_type_year ON employee_leave_balances (tenant_id, leave_type_id, balance_year);

ALTER TABLE employee_leave_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_leave_balances FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 9.3 Leave Accrual Events (Immutable Ledger)

```sql
leave_accrual_events (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    employee_id                 UUID NOT NULL,
    leave_type_id               UUID NOT NULL,
    balance_year                INTEGER NOT NULL,

    event_type                  VARCHAR(30) NOT NULL,
    -- 'opening','monthly_accrual','yearly_grant','carry_forward',
    -- 'application_deducted','application_restored','manual_adjustment',
    -- 'encashment','expiry','year_end_close'

    change_amount               NUMERIC(6,2) NOT NULL,  -- signed
    running_balance_after       NUMERIC(6,2) NOT NULL,

    source_document_type        VARCHAR(30),
    source_document_id          UUID,
    reason                      TEXT,
    performed_by                UUID,

    event_date                  DATE NOT NULL,
    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Immutable
CREATE OR REPLACE FUNCTION prevent_leave_event_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'leave_accrual_events is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_events_immutable
    BEFORE UPDATE OR DELETE ON leave_accrual_events
    FOR EACH ROW EXECUTE FUNCTION prevent_leave_event_modification();

CREATE INDEX idx_leave_events_employee_type_year ON leave_accrual_events
    (tenant_id, employee_id, leave_type_id, balance_year, event_date);
CREATE INDEX idx_leave_events_source ON leave_accrual_events
    (tenant_id, source_document_type, source_document_id);

ALTER TABLE leave_accrual_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON leave_accrual_events FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 9.4 Leave Applications

```sql
leave_applications (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    application_number          VARCHAR(50) NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id),
    leave_type_id               UUID NOT NULL REFERENCES leave_types(id),

    from_date                   DATE NOT NULL,
    to_date                     DATE NOT NULL,
    days_requested              NUMERIC(6,2) NOT NULL,
    half_day                    BOOLEAN NOT NULL DEFAULT FALSE,
    half_day_session            VARCHAR(20),  -- 'morning','afternoon'

    reason                      TEXT,
    medical_cert_document_id    UUID,
    covering_employee_id        UUID REFERENCES employees(id),
    contact_during_leave        VARCHAR(100),

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','submitted','pending_approval','approved','rejected',
    -- 'cancelled_by_employee','withdrawn','in_progress','completed','expired'

    approval_instance_id        UUID,
    submitted_at                TIMESTAMP WITH TIME ZONE,
    approved_at                 TIMESTAMP WITH TIME ZONE,
    approved_by                 UUID,
    rejection_reason            TEXT,
    cancelled_at                TIMESTAMP WITH TIME ZONE,
    cancellation_reason         TEXT,

    -- Balance deduction (on approval)
    balance_deducted_at         TIMESTAMP WITH TIME ZONE,
    accrual_event_id            UUID REFERENCES leave_accrual_events(id),

    -- Payroll impact
    affects_payroll_run_id      UUID,
    days_actually_taken         NUMERIC(6,2),  -- may differ from requested

    notes                       TEXT,
    created_at, updated_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_leave_applications_tenant_number UNIQUE (tenant_id, application_number)
);

CREATE INDEX idx_leave_apps_employee ON leave_applications (tenant_id, employee_id, from_date DESC);
CREATE INDEX idx_leave_apps_status ON leave_applications (tenant_id, status);
CREATE INDEX idx_leave_apps_covering ON leave_applications (tenant_id, covering_employee_id) WHERE covering_employee_id IS NOT NULL;
CREATE INDEX idx_leave_apps_date_range ON leave_applications (tenant_id, from_date, to_date)
    WHERE status IN ('approved','in_progress');

ALTER TABLE leave_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON leave_applications FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 10. Loans

### 10.1 Employee Loans

```sql
employee_loans (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    loan_number                 VARCHAR(50) NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id),

    loan_type                   VARCHAR(30) NOT NULL,
    -- 'personal','salary_advance','festival','housing','vehicle',
    -- 'medical','education','hardship','other'

    principal_amount_lkr        NUMERIC(15,2) NOT NULL,
    interest_rate_pct           NUMERIC(7,4) DEFAULT 0,
    interest_type               VARCHAR(20) NOT NULL DEFAULT 'none',
    -- 'none','simple','reducing_balance','flat'
    tenure_months               INTEGER NOT NULL,

    -- Dates
    application_date            DATE,
    sanction_date               DATE,
    disbursement_date           DATE,
    first_emi_date              DATE,
    maturity_date               DATE,

    -- Disbursement
    disbursed_via               VARCHAR(30),  -- 'salary_credit','bank_transfer','cash','cheque'
    disbursement_reference      VARCHAR(100),
    disbursement_journal_entry_id UUID,

    -- EMI
    emi_amount_lkr              NUMERIC(15,2),
    emi_deduction_from          VARCHAR(20) NOT NULL DEFAULT 'salary',
    -- 'salary','direct_payment','both'

    -- Tracking
    total_repaid_lkr            NUMERIC(15,2) NOT NULL DEFAULT 0,
    outstanding_principal_lkr   NUMERIC(15,2) NOT NULL DEFAULT 0,
    outstanding_interest_lkr    NUMERIC(15,2) NOT NULL DEFAULT 0,
    installments_paid           INTEGER NOT NULL DEFAULT 0,
    installments_remaining      INTEGER,
    next_emi_date               DATE,
    last_payment_date           DATE,

    -- Early settlement
    allow_early_settlement      BOOLEAN NOT NULL DEFAULT TRUE,
    early_settlement_fee_pct    NUMERIC(5,2) DEFAULT 0,

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'applied',
    -- 'applied','pending_approval','approved','rejected','disbursed','active',
    -- 'prepaid','closed','written_off','defaulted','restructured','superseded'

    approval_instance_id        UUID,
    approved_at                 TIMESTAMP WITH TIME ZONE,
    approved_by                 UUID,
    rejection_reason            TEXT,

    closed_at                   TIMESTAMP WITH TIME ZONE,
    closure_type                VARCHAR(30),
    -- 'matured','early_settlement','termination_settlement','written_off','restructured'
    closure_journal_entry_id    UUID,

    -- Collateral / guarantor
    has_collateral              BOOLEAN DEFAULT FALSE,
    collateral_details          TEXT,
    guarantor_name              VARCHAR(200),
    guarantor_nic               VARCHAR(20),

    purpose                     TEXT,
    notes                       TEXT,
    created_at, updated_at, deleted_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_loans_tenant_number UNIQUE (tenant_id, loan_number)
);

CREATE INDEX idx_loans_employee_status ON employee_loans (tenant_id, employee_id, status);
CREATE INDEX idx_loans_active ON employee_loans (tenant_id, next_emi_date) WHERE status = 'active';

ALTER TABLE employee_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_loans FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 10.2 Loan Repayment Schedule

```sql
loan_repayment_schedule (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    loan_id                     UUID NOT NULL REFERENCES employee_loans(id),

    installment_number          SMALLINT NOT NULL,
    due_date                    DATE NOT NULL,

    -- Scheduled amounts
    opening_balance_lkr         NUMERIC(15,2) NOT NULL,
    principal_due_lkr           NUMERIC(15,2) NOT NULL,
    interest_due_lkr            NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_emi_lkr               NUMERIC(15,2) NOT NULL,
    closing_balance_lkr         NUMERIC(15,2) NOT NULL,

    -- Actual
    status                      VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending','partially_paid','paid','overdue','waived','superseded'
    paid_amount_lkr             NUMERIC(15,2) DEFAULT 0,
    principal_paid_lkr          NUMERIC(15,2) DEFAULT 0,
    interest_paid_lkr           NUMERIC(15,2) DEFAULT 0,
    paid_date                   DATE,
    paid_via_payroll_run_id     UUID,
    journal_entry_id            UUID,

    notes                       TEXT,
    created_at, updated_at,

    CONSTRAINT uk_lrs_loan_installment UNIQUE (loan_id, installment_number)
);

CREATE INDEX idx_lrs_loan ON loan_repayment_schedule (tenant_id, loan_id, installment_number);
CREATE INDEX idx_lrs_due_pending ON loan_repayment_schedule (tenant_id, due_date)
    WHERE status IN ('pending','partially_paid','overdue');

ALTER TABLE loan_repayment_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loan_repayment_schedule FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 10.3 Loan Payments

```sql
loan_payments (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    loan_id                     UUID NOT NULL REFERENCES employee_loans(id),

    installment_number          SMALLINT,  -- nullable for extra/settlement payments
    payment_date                DATE NOT NULL,
    amount_lkr                  NUMERIC(15,2) NOT NULL,
    principal_portion_lkr       NUMERIC(15,2) NOT NULL,
    interest_portion_lkr        NUMERIC(15,2) NOT NULL DEFAULT 0,
    fee_portion_lkr             NUMERIC(15,2) DEFAULT 0,  -- early settlement fee

    payment_source              VARCHAR(30) NOT NULL,
    -- 'salary_deduction','direct_payment','settlement','prepayment'
    payroll_run_id              UUID,
    journal_entry_id            UUID,

    reference                   VARCHAR(100),
    notes                       TEXT,
    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by                  UUID
);

CREATE INDEX idx_loan_payments_loan ON loan_payments (tenant_id, loan_id, payment_date DESC);
CREATE INDEX idx_loan_payments_payroll ON loan_payments (tenant_id, payroll_run_id) WHERE payroll_run_id IS NOT NULL;

ALTER TABLE loan_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loan_payments FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 11. Bonuses

### 11.1 Bonus Schemes

```sql
bonus_schemes (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    name                        VARCHAR(200) NOT NULL,
    description                 TEXT,

    trigger_type                VARCHAR(30) NOT NULL,
    -- 'annual','festival','performance','retention','signing',
    -- 'project_completion','referral','sales_target','ad_hoc'

    calculation_method          VARCHAR(30) NOT NULL,
    -- 'fixed_amount','percentage_of_basic','percentage_of_gross',
    -- 'formula','tiered','manager_discretion'
    base_amount_lkr             NUMERIC(15,2),
    percentage                  NUMERIC(7,4),
    formula_json                JSONB,
    tier_rules_json             JSONB,

    eligibility_rules_json      JSONB,

    -- Tax / statutory
    is_taxable                  BOOLEAN NOT NULL DEFAULT TRUE,
    is_epf_liable               BOOLEAN NOT NULL DEFAULT FALSE,
    is_etf_liable               BOOLEAN NOT NULL DEFAULT FALSE,

    expense_account_id          UUID,

    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    display_order               SMALLINT DEFAULT 100,

    notes                       TEXT,
    created_at, updated_at, deleted_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_bonus_schemes_tenant ON bonus_schemes (tenant_id, is_active);

ALTER TABLE bonus_schemes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bonus_schemes FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 11.2 Bonus Runs

```sql
bonus_runs (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    run_number                  VARCHAR(50) NOT NULL,
    scheme_id                   UUID NOT NULL REFERENCES bonus_schemes(id),
    run_name                    VARCHAR(200),

    bonus_period_start          DATE NOT NULL,
    bonus_period_end            DATE NOT NULL,
    payment_date                DATE NOT NULL,

    -- Scope
    applies_to_filter_json      JSONB,
    applies_to_employee_ids     UUID[],

    -- Totals
    total_bonus_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,
    employee_count              INTEGER NOT NULL DEFAULT 0,

    -- Workflow
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','calculating','calculated','pending_approval','approved',
    -- 'distributed','posted','cancelled'

    -- Processing method
    included_in_payroll_run_id  UUID,  -- bundled with monthly run
    as_separate_payroll_run_id  UUID,  -- standalone off-cycle run

    approval_instance_id        UUID,
    calculated_at               TIMESTAMP WITH TIME ZONE,
    approved_at                 TIMESTAMP WITH TIME ZONE,
    approved_by                 UUID,
    distributed_at              TIMESTAMP WITH TIME ZONE,

    cancelled_at                TIMESTAMP WITH TIME ZONE,
    cancel_reason               TEXT,

    notes                       TEXT,
    created_at, updated_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_bonus_runs_tenant_number UNIQUE (tenant_id, run_number)
);

bonus_run_employees (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    bonus_run_id                UUID NOT NULL REFERENCES bonus_runs(id) ON DELETE CASCADE,
    employee_id                 UUID NOT NULL REFERENCES employees(id),

    calculated_amount_lkr       NUMERIC(15,2) NOT NULL,
    manual_adjustment_lkr       NUMERIC(15,2) DEFAULT 0,
    final_amount_lkr            NUMERIC(15,2) NOT NULL,
    adjustment_reason           TEXT,
    adjusted_by                 UUID,

    calculation_basis_json      JSONB,

    payslip_id                  UUID,
    paid_at                     TIMESTAMP WITH TIME ZONE,

    notes                       TEXT,
    created_at, updated_at,

    CONSTRAINT uk_bre_run_employee UNIQUE (bonus_run_id, employee_id)
);

CREATE INDEX idx_bonus_runs_tenant_status ON bonus_runs (tenant_id, status);
CREATE INDEX idx_bonus_runs_scheme ON bonus_runs (tenant_id, scheme_id);
CREATE INDEX idx_bre_run ON bonus_run_employees (tenant_id, bonus_run_id);
CREATE INDEX idx_bre_employee ON bonus_run_employees (tenant_id, employee_id);

ALTER TABLE bonus_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonus_run_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bonus_runs FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON bonus_run_employees FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 12. Expense Claims

```sql
expense_claims (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    claim_number                VARCHAR(50) NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id),

    claim_date                  DATE NOT NULL,
    period_start                DATE,
    period_end                  DATE,

    -- Totals
    total_claimed_lkr           NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_approved_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_paid_lkr              NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Purpose
    purpose_category            VARCHAR(50),
    -- 'travel','client_entertainment','office_supplies','telephone',
    -- 'fuel','training','conference','medical','other'
    purpose_details             TEXT,
    project_id                  UUID,
    branch_id                   UUID,
    cost_center_id              UUID,

    -- Settlement
    settlement_method           VARCHAR(30) NOT NULL DEFAULT 'reimbursement',
    -- 'reimbursement','petty_cash','advance_settlement','payroll_addition'
    advance_taken_lkr           NUMERIC(15,2) DEFAULT 0,
    net_reimbursement_lkr       NUMERIC(15,2),

    -- Payment linkage
    payment_id                  UUID,
    petty_cash_voucher_id       UUID,
    reimbursement_date          DATE,
    payment_method              VARCHAR(30),

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','submitted','pending_approval','approved','partially_approved',
    -- 'rejected','pending_payment','paid','cancelled'

    approval_instance_id        UUID,
    submitted_at                TIMESTAMP WITH TIME ZONE,
    approved_at                 TIMESTAMP WITH TIME ZONE,
    approved_by                 UUID,
    rejection_reason            TEXT,

    -- Journal
    journal_entry_id            UUID,

    notes                       TEXT,
    internal_notes              TEXT,
    created_at, updated_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_expense_claims_tenant_number UNIQUE (tenant_id, claim_number)
);

expense_claim_lines (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    claim_id                    UUID NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
    line_number                 SMALLINT NOT NULL,

    expense_date                DATE NOT NULL,
    expense_category            VARCHAR(50),
    description                 TEXT,
    vendor_name                 VARCHAR(200),

    -- Amounts
    claimed_amount_lkr          NUMERIC(15,2) NOT NULL,
    approved_amount_lkr         NUMERIC(15,2),
    tax_amount_lkr              NUMERIC(15,2) DEFAULT 0,
    tax_code_id                 UUID,

    -- Receipt
    receipt_document_id         UUID,
    ocr_extracted_json          JSONB,
    ocr_confidence              NUMERIC(5,2),
    manually_verified           BOOLEAN DEFAULT FALSE,

    -- GL coding
    expense_account_id          UUID,
    cost_center_id              UUID,
    branch_id                   UUID,

    -- Line-level status
    line_status                 VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending','approved','partial_approved','rejected'
    rejection_reason            TEXT,

    notes                       TEXT,
    created_at, updated_at
);

CREATE INDEX idx_expense_claims_employee ON expense_claims (tenant_id, employee_id, claim_date DESC);
CREATE INDEX idx_expense_claims_status ON expense_claims (tenant_id, status);
CREATE INDEX idx_expense_claims_petty_cash ON expense_claims (tenant_id, petty_cash_voucher_id)
    WHERE petty_cash_voucher_id IS NOT NULL;
CREATE INDEX idx_expense_claim_lines_claim ON expense_claim_lines (tenant_id, claim_id);

ALTER TABLE expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_claim_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON expense_claims FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON expense_claim_lines FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 13. Final Settlement

```sql
final_settlements (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    settlement_number           VARCHAR(50) NOT NULL,
    employee_id                 UUID NOT NULL REFERENCES employees(id),

    -- Exit context
    exit_type                   VARCHAR(30) NOT NULL,
    -- 'resignation','termination','retirement','death','contract_end','redundancy'
    exit_date                   DATE NOT NULL,
    last_working_day            DATE NOT NULL,

    -- Notice period
    notice_period_due_days      INTEGER,
    notice_period_served_days   INTEGER,
    notice_period_shortfall_lkr NUMERIC(15,2) DEFAULT 0,
    notice_period_waived        BOOLEAN DEFAULT FALSE,
    notice_period_waive_reason  TEXT,

    -- Earnings
    last_salary_earned_lkr      NUMERIC(15,2) DEFAULT 0,
    pro_rated_days              NUMERIC(6,2),
    pending_salary_arrears_lkr  NUMERIC(15,2) DEFAULT 0,
    pending_expense_claims_lkr  NUMERIC(15,2) DEFAULT 0,
    bonus_pro_rated_lkr         NUMERIC(15,2) DEFAULT 0,
    leave_encashment_lkr        NUMERIC(15,2) DEFAULT 0,
    leave_encashment_days       NUMERIC(6,2) DEFAULT 0,
    gratuity_lkr                NUMERIC(15,2) DEFAULT 0,
    gratuity_years_completed    NUMERIC(5,2),
    gratuity_last_basic_lkr     NUMERIC(15,2),
    gratuity_auto_computed      NUMERIC(15,2),
    gratuity_override_reason    TEXT,
    other_earnings_lkr          NUMERIC(15,2) DEFAULT 0,

    -- Statutory balances released
    epf_employee_balance_lkr    NUMERIC(15,2) DEFAULT 0,
    epf_employer_balance_lkr    NUMERIC(15,2) DEFAULT 0,
    etf_balance_lkr             NUMERIC(15,2) DEFAULT 0,

    -- Deductions
    outstanding_loan_settlement_lkr NUMERIC(15,2) DEFAULT 0,
    outstanding_advance_lkr     NUMERIC(15,2) DEFAULT 0,
    other_deductions_lkr        NUMERIC(15,2) DEFAULT 0,
    paye_on_settlement_lkr      NUMERIC(15,2) DEFAULT 0,

    -- Breakdown
    earnings_breakdown_json     JSONB,
    deductions_breakdown_json   JSONB,

    -- Net
    gross_total_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_deductions_lkr        NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_payable_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,

    -- Statutory withdrawal forms
    epf_withdrawal_form_generated BOOLEAN DEFAULT FALSE,
    epf_withdrawal_document_id  UUID,
    etf_withdrawal_form_generated BOOLEAN DEFAULT FALSE,
    etf_withdrawal_document_id  UUID,

    -- Exit documents
    service_letter_document_id  UUID,
    experience_letter_document_id UUID,
    relieving_letter_document_id UUID,
    noc_document_id             UUID,  -- no objection certificate

    -- Asset recovery
    asset_recovery_checklist_json JSONB,
    -- [{"asset":"laptop","status":"returned","date":"..."},
    --  {"asset":"id_card","status":"returned"},
    --  {"asset":"sim_card","status":"returned"}]
    asset_recovery_status       VARCHAR(20) DEFAULT 'pending',
    -- 'pending','in_progress','completed','waived'

    -- Workflow
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- 'draft','calculating','calculated','pending_approval','approved',
    -- 'pending_payment','paid','closed','cancelled'

    approval_instance_id        UUID,
    calculated_at               TIMESTAMP WITH TIME ZONE,
    approved_at                 TIMESTAMP WITH TIME ZONE,
    approved_by                 UUID,

    -- Payment
    payment_id                  UUID,
    paid_at                     TIMESTAMP WITH TIME ZONE,
    payment_method              VARCHAR(30),
    journal_entry_id            UUID,

    -- Closure
    closed_at                   TIMESTAMP WITH TIME ZONE,
    closed_by                   UUID,

    notes                       TEXT,
    internal_notes              TEXT,
    created_at, updated_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_final_settlements_tenant_number UNIQUE (tenant_id, settlement_number),
    CONSTRAINT uk_final_settlements_employee UNIQUE (employee_id)
);

CREATE INDEX idx_final_settlements_employee ON final_settlements (tenant_id, employee_id);
CREATE INDEX idx_final_settlements_status ON final_settlements (tenant_id, status);
CREATE INDEX idx_final_settlements_exit_type ON final_settlements (tenant_id, exit_type, exit_date DESC);

ALTER TABLE final_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON final_settlements FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 13.1 Gratuity Auto-Calculation (Reference)

Per SL Gratuity Act:

```
Eligibility: minimum 5 years of continuous service
Formula: 14 days × last drawn basic salary × years of service
         (where monthly basic / 30 × 14 = daily × 14)
Half-month's salary × years of service equivalent
```

Application auto-proposes value; HR can override with logged reason.

---

## 14. Common Posting Patterns (Reference)

### 14.1 Payroll Accrual (at Approval)

```
Dr. Salary Expense                       500,000
Dr. EPF Employer Expense                  60,000
Dr. ETF Expense                           15,000
   Cr. Salary Payable                           480,000
   Cr. EPF Employee Payable                      40,000
   Cr. EPF Employer Payable                      60,000
   Cr. ETF Payable                               15,000
   Cr. PAYE Payable                              20,000
```

### 14.2 Payroll Disbursement (Settlement)

```
Dr. Salary Payable                       480,000
   Cr. Bank Account                             480,000
```

### 14.3 Statutory Remittance (separately)

```
Dr. EPF Employee Payable                  40,000
Dr. EPF Employer Payable                  60,000
Dr. ETF Payable                           15,000
Dr. PAYE Payable                          20,000
   Cr. Bank Account                             135,000
```

### 14.4 Gratuity on Final Settlement

```
Dr. Gratuity Expense                     300,000
   Cr. Salary Payable (or Settlement Payable)   300,000
```

### 14.5 Loan Disbursement

```
Dr. Employee Loan Receivable             100,000
   Cr. Bank Account                             100,000
```

### 14.6 Loan Repayment via Salary Deduction

Already included in payroll accrual — loan deduction reduces net pay; equivalent credit reduces Loan Receivable.

---

## 15. Next Parts

- **Part 7 — System**: audit log, document storage, notifications, workflow templates, integrations, plans, coupons, feature flags, webhook events, scheduled jobs
- **Part 8 — Performance & ERDs**: indexes, partitioning, materialized views, Mermaid diagrams, RLS examples, query patterns

---

*Document version: 1.0 · Part 6/8 · Payroll & HR · Scope: Sri Lanka only · Full system (not MVP)*

*Decisions locked in Round 6: employee master with core + 7 extension tables (Option C), applicant/offered states reserved for future ATS; salary components library + structure templates + per-employee structures with input-parameter storage (computed at run-time); employee_branch_allocations for multi-branch salary splits (default 100% to primary); 7 combinable wage types; commission_schemes + commission_scheme_rules (pre-built types: flat_pct / tiered_volume / per_item / per_category / per_customer_segment / per_brand / custom_formula) with tenant-customizable composable rules, multi-rule aggregation modes (sum_all_matching / highest_only / first_match), per-line and per-invoice caps, configurable accrual basis (on_invoice_post / on_collection / on_delivery) and payout lag; commission_earnings ledger with polymorphic source linkage (invoice / invoice_line / receipt_allocation / credit_note), split across multiple salespeople (split_pct), 5-state lifecycle (accrued → payable → paid / clawed_back / void) with proportional claw-back on returns and paired-reversal pattern, auto-flow into payroll runs via `status='payable'` pull; attendance_devices registry (vendor, integration mode: live_api / file_import / manual_only / mobile_app; health tracking) + biometric_employee_map (device_code ↔ employee_id, multi-device supported) + attendance_records (one-per-employee-per-day with punches, overtime, late minutes, shift, 5 sources, validation state, payroll consumption tracking; immutable once consumed by a run) + attendance_file_imports (S3-backed CSV/Excel uploads with dedupe-by-hash, rollback support when not yet consumed by payroll) + attendance_exceptions (typed validation failures with raw-payload preservation and resolution workflow); payroll pulls unconsumed attendance at run calculation and blocks on unresolved exceptions; payroll_runs with 6-step workflow + two-stage posting (accrual at approval, settlement at disbursement); payroll_run_employees materialized at calculation + separate payroll_run_employee_lines per component for full traceability; payslips with versioning (regenerated_from_id + supersede model) and YTD cumulative; generic statutory_returns + statutory_return_employees with JSONB flexibility for format-specific fields; platform-level banks master referenced by disbursement_files; leave_types tenant-configured, employee_leave_balances per year, immutable leave_accrual_events ledger, half-day support, approval-time balance deduction; employee_loans with auto-generated loan_repayment_schedule at disbursement (restructuring deferred to Phase 2); bonus_schemes + bonus_runs supporting both bundle-to-monthly and standalone off-cycle paths; expense_claims with OCR fields + explicit petty_cash_voucher_id linkage; final_settlements with auto-gratuity per SL Gratuity Act (14 days × basic × years, 5yr min) plus manual override with reason logged, JSON checklist for asset recovery (formal asset management deferred).*
