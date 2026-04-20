# Data Model — Part 2: Identity & Access

> Platform governance entities, the tenant registry, user accounts within tenants, the multi-role permission model, sessions, and MFA. Extends Part 1 (Foundation). Target: Sri Lanka only. Scope: full system.

---

## 1. Scope

Defines:
- Platform-level entities (Super Admin domain, no tenant_id)
- `tenants` — the central registry
- `users`, `roles`, `permissions`, `user_roles` (the multi-role core)
- `user_sessions`, `user_login_history`, `otp_codes`, `user_mfa_config`

Does not cover: audit log (Part 7), notifications (Part 7), integrations (Part 7).

---

## 2. Platform-Level Entities (No tenant_id)

Accessed only by Super Admin roles. Different RLS pattern (bypass by super-admin claim).

### 2.1 Platform Governance Tables

```sql
platform_users (
    id                    UUID PRIMARY KEY,
    email                 VARCHAR(200) NOT NULL UNIQUE,
    password_hash         VARCHAR(255) NOT NULL,
    first_name            VARCHAR(100),
    last_name             VARCHAR(100),
    status                VARCHAR(20) NOT NULL,  -- 'active','suspended','removed'
    ip_allowlist          JSONB,                  -- optional IP restrictions
    geo_restrictions      JSONB,                  -- e.g. ["LK","SG"] only
    last_login_at         TIMESTAMP WITH TIME ZONE,
    last_login_ip         INET,
    session_timeout_minutes INTEGER DEFAULT 30,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at            TIMESTAMP WITH TIME ZONE,
    created_by            UUID,
    updated_by            UUID,
    version               INTEGER NOT NULL DEFAULT 1
);

platform_user_roles (
    id                    UUID PRIMARY KEY,
    platform_user_id      UUID NOT NULL REFERENCES platform_users(id),
    role_name             VARCHAR(50) NOT NULL,  -- 'platform_owner','finance_admin','support_admin','marketing_admin','devops_admin','custom'
    custom_permissions    JSONB,                  -- for 'custom' role type
    assigned_at           TIMESTAMP WITH TIME ZONE NOT NULL,
    assigned_by           UUID NOT NULL REFERENCES platform_users(id),
    expires_at            TIMESTAMP WITH TIME ZONE,
    UNIQUE (platform_user_id, role_name)
);

platform_user_2fa (
    id                    UUID PRIMARY KEY,
    platform_user_id      UUID NOT NULL UNIQUE REFERENCES platform_users(id),
    totp_secret_encrypted VARCHAR(500) NOT NULL,  -- encrypted at rest (KMS)
    backup_codes_hash     TEXT[],                  -- bcrypt hashes
    enabled               BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_at            TIMESTAMP WITH TIME ZONE,
    last_verified_at      TIMESTAMP WITH TIME ZONE
);

platform_audit_log (
    id                    UUID PRIMARY KEY,
    platform_user_id      UUID REFERENCES platform_users(id),
    action                VARCHAR(100) NOT NULL,
    target_type           VARCHAR(50) NOT NULL,  -- 'tenant','plan','config','impersonation'
    target_id             UUID,                    -- may reference tenant_id or similar
    before_value          JSONB,
    after_value           JSONB,
    reason                TEXT,
    ip_address            INET,
    user_agent            TEXT,
    performed_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
-- Immutable: no UPDATE, no DELETE triggers

CREATE INDEX idx_platform_audit_log_user ON platform_audit_log (platform_user_id, performed_at DESC);
CREATE INDEX idx_platform_audit_log_target ON platform_audit_log (target_type, target_id, performed_at DESC);
```

### 2.2 Tenant Registry

```sql
tenants (
    id                        UUID PRIMARY KEY,
    business_name             VARCHAR(200) NOT NULL,
    registered_name           VARCHAR(200),
    registration_number       VARCHAR(50),
    vat_number                VARCHAR(50),
    sscl_applicable           BOOLEAN DEFAULT FALSE,

    -- Geography / localization
    country                   CHAR(2) NOT NULL DEFAULT 'LK',  -- multi-country ready
    currency                  CHAR(3) NOT NULL DEFAULT 'LKR',
    language_preference       VARCHAR(5) NOT NULL DEFAULT 'en-LK',
    timezone                  VARCHAR(50) NOT NULL DEFAULT 'Asia/Colombo',
    data_region               VARCHAR(30) NOT NULL DEFAULT 'ap-southeast-1',  -- future SL-localization ready

    -- Structural
    industry_template_id      UUID,
    fiscal_year_start_month   SMALLINT DEFAULT 4,  -- April (SL standard)

    -- Contact / profile
    phone                     VARCHAR(20),
    email                     VARCHAR(200),
    address_json              JSONB,
    logo_url                  VARCHAR(500),

    -- Subscription state
    status                    VARCHAR(30) NOT NULL,
    -- 'trial','trial_extended','active','past_due','suspended','churned','terminated'

    plan_version_id           UUID,  -- grandfathered plan version
    trial_started_at          TIMESTAMP WITH TIME ZONE,
    trial_ends_at             TIMESTAMP WITH TIME ZONE,
    activated_at              TIMESTAMP WITH TIME ZONE,  -- first invoice posted
    suspended_at              TIMESTAMP WITH TIME ZONE,
    churned_at                TIMESTAMP WITH TIME ZONE,
    terminated_at             TIMESTAMP WITH TIME ZONE,

    -- Owner / primary contact
    primary_contact_name      VARCHAR(200),
    primary_contact_phone     VARCHAR(20),
    primary_contact_email     VARCHAR(200),

    -- Metadata
    tags                      JSONB,
    custom_metadata           JSONB,
    signup_source             VARCHAR(50),  -- 'organic','google_ads','referral','partner'
    referral_code             VARCHAR(50),

    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                TIMESTAMP WITH TIME ZONE,
    version                   INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_tenants_status ON tenants (status);
CREATE INDEX idx_tenants_industry ON tenants (industry_template_id);
CREATE INDEX idx_tenants_plan_version ON tenants (plan_version_id);

-- Tenant subscription history (platform-level, separate from tenant billing side in Part 7)
tenant_subscriptions (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL REFERENCES tenants(id),
    plan_version_id           UUID NOT NULL,
    billing_cycle             VARCHAR(20) NOT NULL,  -- 'monthly','annual'
    started_at                TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at                  TIMESTAMP WITH TIME ZONE,
    ended_reason              VARCHAR(50),
    current_period_start      DATE NOT NULL,
    current_period_end        DATE NOT NULL,
    next_renewal_at           TIMESTAMP WITH TIME ZONE,
    paused_at                 TIMESTAMP WITH TIME ZONE,
    paused_until              TIMESTAMP WITH TIME ZONE,
    cancellation_requested_at TIMESTAMP WITH TIME ZONE,
    cancellation_effective_at TIMESTAMP WITH TIME ZONE,
    monthly_rate_lkr          NUMERIC(15,2) NOT NULL,
    annual_rate_lkr           NUMERIC(15,2),
    discount_applied_pct      NUMERIC(5,2) DEFAULT 0,
    coupon_id                 UUID,
    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenant_subscriptions_tenant ON tenant_subscriptions (tenant_id, started_at DESC);

-- Tenant usage metrics (counts only, no business values — privacy lock)
tenant_usage_metrics (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL REFERENCES tenants(id),
    metric_type               VARCHAR(50) NOT NULL,  -- 'invoices_month','grns_month','payslips_month','api_calls','storage_mb','users_count'
    metric_value              BIGINT NOT NULL,
    period_start              DATE NOT NULL,
    period_end                DATE NOT NULL,
    recorded_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, metric_type, period_start)
);

CREATE INDEX idx_tenant_usage_lookup ON tenant_usage_metrics (tenant_id, metric_type, period_start DESC);

-- Tenant health score (churn prediction)
tenant_health_score (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL REFERENCES tenants(id),
    snapshot_date             DATE NOT NULL,
    score                     NUMERIC(5,2) NOT NULL,  -- 0-100
    factors_json              JSONB NOT NULL,
    churn_risk_level          VARCHAR(20),  -- 'low','medium','high','critical'
    UNIQUE (tenant_id, snapshot_date)
);

CREATE INDEX idx_tenant_health_risk ON tenant_health_score (churn_risk_level, snapshot_date DESC);

-- Tenant lifecycle events (state transitions)
tenant_lifecycle_events (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL REFERENCES tenants(id),
    from_status               VARCHAR(30),
    to_status                 VARCHAR(30) NOT NULL,
    trigger                   VARCHAR(50),  -- 'user_action','payment_failed','grace_expired','admin_override'
    trigger_metadata          JSONB,
    occurred_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    performed_by              UUID  -- platform_user_id if admin-initiated
);

CREATE INDEX idx_tenant_lifecycle_tenant ON tenant_lifecycle_events (tenant_id, occurred_at DESC);
```

### 2.3 Plans, Add-ons, Coupons

Schema details in **Part 7 — System** (to keep identity layer focused). Referenced here via `plan_version_id` and `coupon_id` only.

### 2.4 Platform Configuration Tables

```sql
platform_tax_rates (
    id                        UUID PRIMARY KEY,
    tax_type                  VARCHAR(30) NOT NULL,  -- 'vat','sscl','wht','paye','stamp_duty'
    category                  VARCHAR(100),           -- for WHT: 'rent','professional_services', etc.
    rate                      NUMERIC(7,4) NOT NULL,
    calculation_basis         VARCHAR(50),
    effective_from            DATE NOT NULL,
    effective_until           DATE,
    description               TEXT,
    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by                UUID REFERENCES platform_users(id)
);

CREATE INDEX idx_platform_tax_rates_lookup ON platform_tax_rates (tax_type, category, effective_from);

industry_templates (
    id                        UUID PRIMARY KEY,
    code                      VARCHAR(50) NOT NULL UNIQUE,  -- 'textile_wholesale','pharmacy','grocery','restaurant','salon','general_sme'
    name                      VARCHAR(200) NOT NULL,
    description               TEXT,
    default_coa_json          JSONB NOT NULL,  -- seed COA structure
    default_tax_codes_json    JSONB NOT NULL,
    default_expense_categories_json JSONB,
    default_item_categories_json JSONB,
    status                    VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

feature_flags (
    id                        UUID PRIMARY KEY,
    flag_name                 VARCHAR(100) NOT NULL UNIQUE,
    description               TEXT,
    enabled_globally          BOOLEAN NOT NULL DEFAULT FALSE,
    rollout_percentage        NUMERIC(5,2) DEFAULT 0,  -- 0-100
    enabled_tenant_ids        UUID[],
    disabled_tenant_ids       UUID[],
    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

---

## 3. Users Within Tenants

### 3.1 Users Table

Tenant-scoped. Cross-tenant email allowed (same person in multiple tenants = separate user records).

```sql
users (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL,

    -- Identity
    email                     VARCHAR(200) NOT NULL,
    phone                     VARCHAR(20),
    password_hash             VARCHAR(255),  -- nullable for future SSO
    first_name                VARCHAR(100),
    last_name                 VARCHAR(100),
    display_name              VARCHAR(200),

    -- Preferences
    language_preference       VARCHAR(5) DEFAULT 'en-LK',
    timezone                  VARCHAR(50) DEFAULT 'Asia/Colombo',
    avatar_url                VARCHAR(500),

    -- State
    status                    VARCHAR(30) NOT NULL,
    -- 'invited_pending','active','suspended','removed'

    suspended_at              TIMESTAMP WITH TIME ZONE,
    suspended_reason          TEXT,

    -- Invitation
    invited_by                UUID REFERENCES users(id),
    invited_at                TIMESTAMP WITH TIME ZONE,
    invite_token              VARCHAR(255),
    invite_token_hash         VARCHAR(255),
    invite_expires_at         TIMESTAMP WITH TIME ZONE,
    activated_at              TIMESTAMP WITH TIME ZONE,

    -- Login tracking
    last_login_at             TIMESTAMP WITH TIME ZONE,
    last_login_ip             INET,
    last_password_changed_at  TIMESTAMP WITH TIME ZONE,
    failed_login_count        INTEGER DEFAULT 0,
    lockout_until             TIMESTAMP WITH TIME ZONE,

    -- MFA
    mfa_enabled               BOOLEAN NOT NULL DEFAULT FALSE,

    -- Metadata
    tags                      JSONB,

    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                TIMESTAMP WITH TIME ZONE,
    created_by                UUID REFERENCES users(id),
    updated_by                UUID REFERENCES users(id),
    deleted_by                UUID REFERENCES users(id),
    version                   INTEGER NOT NULL DEFAULT 1,

    -- One email per tenant; same email can exist across tenants
    CONSTRAINT uk_users_tenant_email UNIQUE (tenant_id, email),
    CONSTRAINT uk_users_invite_token UNIQUE (invite_token_hash)
);

CREATE INDEX idx_users_tenant_status ON users (tenant_id, status);
CREATE INDEX idx_users_tenant_email ON users (tenant_id, email);
CREATE INDEX idx_users_invite_token ON users (invite_token_hash) WHERE invite_token_hash IS NOT NULL;

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON users
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.2 Multi-Tenant User Identity (Optional — Future)

When we want "switch between tenants" UX later:

```sql
-- Platform-level table (no tenant_id), Phase 2
user_identities (
    id                        UUID PRIMARY KEY,
    email                     VARCHAR(200) NOT NULL UNIQUE,
    master_password_hash      VARCHAR(255),  -- for unified login
    master_mfa_config         JSONB,
    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

user_identity_links (
    id                        UUID PRIMARY KEY,
    user_identity_id          UUID NOT NULL REFERENCES user_identities(id),
    tenant_id                 UUID NOT NULL REFERENCES tenants(id),
    user_id                   UUID NOT NULL,  -- the per-tenant user record
    linked_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (user_identity_id, tenant_id)
);
```

Not implemented at launch; schema reserved.

---

## 4. Roles & Permissions (Multi-Role Core)

### 4.1 Roles Table

```sql
roles (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL,
    name                      VARCHAR(100) NOT NULL,
    description               TEXT,
    is_preset                 BOOLEAN NOT NULL DEFAULT FALSE,
    preset_key                VARCHAR(50),  -- 'owner','accountant','cashier','sales','stock_keeper','labour','hr','view_only' for presets; NULL for custom
    cloned_from_role_id       UUID REFERENCES roles(id),
    status                    VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','inactive','archived'

    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                TIMESTAMP WITH TIME ZONE,
    created_by                UUID REFERENCES users(id),
    updated_by                UUID REFERENCES users(id),
    version                   INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_roles_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX idx_roles_tenant_status ON roles (tenant_id, status);
CREATE INDEX idx_roles_tenant_preset ON roles (tenant_id, is_preset, preset_key);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON roles
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Preset roles seeded on tenant creation**:
- `owner`, `accountant`, `cashier`, `sales`, `stock_keeper`, `labour`, `hr`, `view_only`

Preset roles can be cloned for customization; original preset remains locked.

### 4.2 Role Permissions

```sql
role_permissions (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL,
    role_id                   UUID NOT NULL REFERENCES roles(id),
    module                    VARCHAR(50) NOT NULL,
    -- 'sell','buy','inventory','accounting','payroll','admin','reports','crm','system'

    action                    VARCHAR(100) NOT NULL,
    -- Examples: 'view_invoices','create_invoice','post_invoice','void_invoice',
    -- 'apply_discount','approve_invoice_above_threshold','view_profit_margin',
    -- 'invite_users','assign_roles','edit_coa','configure_workflows','cancel_subscription'

    granted                   BOOLEAN NOT NULL,

    conditions_json           JSONB,
    -- Examples:
    -- {"max_discount_pct": 5.0}  for capped discount
    -- {"threshold_lkr": 100000}  for approval thresholds
    -- {"max_voucher_amount": 5000}  for petty cash limits

    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_role_permissions UNIQUE (role_id, module, action)
);

CREATE INDEX idx_role_permissions_role ON role_permissions (tenant_id, role_id);
CREATE INDEX idx_role_permissions_lookup ON role_permissions (tenant_id, role_id, module);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON role_permissions
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.3 User-Role Assignments (Multi-Role + Scoping)

```sql
user_roles (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL,
    user_id                   UUID NOT NULL REFERENCES users(id),
    role_id                   UUID NOT NULL REFERENCES roles(id),

    -- Scoping
    scope_type                VARCHAR(20) NOT NULL DEFAULT 'global',
    -- 'global','branch','warehouse','custom'
    scope_ids                 UUID[],  -- array of branch_ids or warehouse_ids depending on scope_type
    scope_conditions_json     JSONB,    -- for 'custom' scope

    -- Assignment tracking
    assigned_by               UUID NOT NULL REFERENCES users(id),
    assigned_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    assignment_reason         TEXT,
    expires_at                TIMESTAMP WITH TIME ZONE,  -- for time-bounded assignments (external auditor)

    -- Lifecycle
    revoked_at                TIMESTAMP WITH TIME ZONE,
    revoked_by                UUID REFERENCES users(id),
    revoke_reason             TEXT,

    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    version                   INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_user_roles_active UNIQUE (user_id, role_id, scope_type) WHERE revoked_at IS NULL
);

CREATE INDEX idx_user_roles_user ON user_roles (tenant_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_roles_role ON user_roles (tenant_id, role_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_roles_scope ON user_roles USING GIN (scope_ids);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON user_roles
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.4 Role Change Audit Log

```sql
role_audit_log (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL,
    action                    VARCHAR(50) NOT NULL,
    -- 'role_created','role_modified','role_deleted',
    -- 'user_role_assigned','user_role_revoked','user_role_scope_changed',
    -- 'permission_granted','permission_revoked'

    target_user_id            UUID REFERENCES users(id),
    target_role_id            UUID REFERENCES roles(id),
    old_value                 JSONB,
    new_value                 JSONB,
    reason                    TEXT,
    performed_by              UUID NOT NULL REFERENCES users(id),
    performed_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ip_address                INET,
    scheduled_for             TIMESTAMP WITH TIME ZONE  -- for scheduled role changes
);
-- Immutable

CREATE INDEX idx_role_audit_user ON role_audit_log (tenant_id, target_user_id, performed_at DESC);
CREATE INDEX idx_role_audit_role ON role_audit_log (tenant_id, target_role_id, performed_at DESC);

ALTER TABLE role_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON role_audit_log
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.5 Permission Resolution Flow

Performed at **application layer**, not in DB. Rationale: multi-role + per-role scoping + condition evaluation too complex for DB views.

Pseudo-code:

```typescript
async function getEffectivePermissions(userId: string, tenantId: string): Promise<Permission[]> {
  const activeRoles = await db.query(`
    SELECT ur.id as user_role_id, ur.scope_type, ur.scope_ids, ur.scope_conditions_json,
           r.id as role_id, r.name as role_name
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.tenant_id = $1 AND ur.user_id = $2
      AND ur.revoked_at IS NULL
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND r.status = 'active'
  `, [tenantId, userId]);

  const permissionsByRole = await Promise.all(activeRoles.map(async (ur) => {
    const perms = await db.query(`
      SELECT module, action, granted, conditions_json
      FROM role_permissions
      WHERE tenant_id = $1 AND role_id = $2
    `, [tenantId, ur.role_id]);

    return perms.map(p => ({
      module: p.module,
      action: p.action,
      granted: p.granted,
      conditions: p.conditions_json,
      scope_type: ur.scope_type,
      scope_ids: ur.scope_ids,
      source_role_id: ur.role_id,
      source_role_name: ur.role_name
    }));
  }));

  // Flatten + dedupe with union semantics (granted wins over not-granted)
  return mergePermissions(permissionsByRole.flat());
}

function canPerform(user, action, context): boolean {
  const perms = user.effectivePermissions;
  const matching = perms.filter(p =>
    p.module === context.module &&
    p.action === action &&
    p.granted === true
  );

  if (matching.length === 0) return false;

  // Check scope
  const scoped = matching.filter(p =>
    p.scope_type === 'global' ||
    isInScope(context, p.scope_type, p.scope_ids)
  );

  if (scoped.length === 0) return false;

  // Check conditions (e.g. discount cap)
  return scoped.some(p => checkConditions(p.conditions, context));
}
```

Effective permissions **cached in session** to avoid repeated DB hits; invalidated on role change.

---

## 5. Sessions & Authentication

### 5.1 User Sessions

```sql
user_sessions (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL,
    user_id                   UUID NOT NULL REFERENCES users(id),

    session_token_hash        VARCHAR(255) NOT NULL UNIQUE,
    refresh_token_hash        VARCHAR(255) UNIQUE,

    ip_address                INET,
    user_agent                TEXT,
    device_fingerprint        VARCHAR(255),
    device_name               VARCHAR(200),  -- user-labelled device
    location_country          CHAR(2),
    location_city             VARCHAR(100),

    mfa_satisfied             BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_verified_at           TIMESTAMP WITH TIME ZONE,
    impersonating_platform_user_id UUID REFERENCES platform_users(id),  -- for Super Admin impersonation sessions
    impersonation_ticket_ref  VARCHAR(100),  -- links to support ticket

    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at                TIMESTAMP WITH TIME ZONE NOT NULL,
    last_activity_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    revoked_at                TIMESTAMP WITH TIME ZONE,
    revoke_reason             VARCHAR(100)
    -- 'logout','password_change','admin_force','mfa_required','suspicious_activity','session_expired'
);

CREATE INDEX idx_user_sessions_active ON user_sessions (tenant_id, user_id, expires_at)
    WHERE revoked_at IS NULL;
CREATE INDEX idx_user_sessions_token ON user_sessions (session_token_hash);
CREATE INDEX idx_user_sessions_impersonation ON user_sessions (impersonating_platform_user_id)
    WHERE impersonating_platform_user_id IS NOT NULL;

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON user_sessions
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Session tokens**: opaque random strings, hashed via bcrypt/argon2 in DB (never plaintext). JWT option also supported, with session table serving as revocation list.

### 5.2 Login History

Tracks all authentication attempts, successes and failures.

```sql
user_login_history (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID,  -- nullable for unknown-email failed attempts
    user_id                   UUID REFERENCES users(id),  -- nullable for failed attempts with unknown email
    email_attempted           VARCHAR(200) NOT NULL,

    success                   BOOLEAN NOT NULL,
    failure_reason            VARCHAR(100),
    -- 'invalid_password','user_not_found','user_suspended','tenant_suspended',
    -- 'mfa_failed','rate_limited','invalid_invite_token','locked_out'

    ip_address                INET,
    user_agent                TEXT,
    country_detected          CHAR(2),
    city_detected             VARCHAR(100),
    asn                       INTEGER,  -- for suspicious-network detection

    mfa_challenged            BOOLEAN DEFAULT FALSE,
    mfa_succeeded             BOOLEAN,

    attempted_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_login_history_user ON user_login_history (tenant_id, user_id, attempted_at DESC);
CREATE INDEX idx_user_login_history_email ON user_login_history (email_attempted, attempted_at DESC);
CREATE INDEX idx_user_login_history_ip ON user_login_history (ip_address, attempted_at DESC);
```

Partitioned monthly by `attempted_at` for retention and performance (details in Part 8).

### 5.3 OTP Codes

For email verification, password reset, login MFA, role-sensitive actions.

```sql
otp_codes (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL,
    user_id                   UUID NOT NULL REFERENCES users(id),

    purpose                   VARCHAR(50) NOT NULL,
    -- 'email_verification','password_reset','login_mfa','role_sensitive_action',
    -- 'tenant_impersonation_consent','data_export_authorization'

    code_hash                 VARCHAR(255) NOT NULL,
    delivery_channel          VARCHAR(20) NOT NULL,  -- 'email','sms_future','whatsapp_future'
    delivered_to              VARCHAR(200),

    expires_at                TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at                   TIMESTAMP WITH TIME ZONE,
    attempts                  SMALLINT NOT NULL DEFAULT 0,
    max_attempts              SMALLINT NOT NULL DEFAULT 5,

    action_context_json       JSONB,  -- e.g. role change being approved, or invoice being voided

    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_codes_active ON otp_codes (tenant_id, user_id, purpose, expires_at)
    WHERE used_at IS NULL;

ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON otp_codes
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

Used OTPs hard-deleted after 24 hours (no value in retention).

### 5.4 User MFA Configuration

```sql
user_mfa_config (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID NOT NULL,
    user_id                   UUID NOT NULL REFERENCES users(id),

    method                    VARCHAR(20) NOT NULL,
    -- 'totp','email_otp','sms_otp_future','whatsapp_otp_future'

    totp_secret_encrypted     VARCHAR(500),  -- encrypted at rest (KMS)
    totp_algorithm            VARCHAR(20) DEFAULT 'SHA1',
    totp_digits               SMALLINT DEFAULT 6,
    totp_period               SMALLINT DEFAULT 30,

    phone_for_sms             VARCHAR(20),

    backup_codes_hash         TEXT[],
    backup_codes_used         INTEGER DEFAULT 0,

    enabled                   BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_at                TIMESTAMP WITH TIME ZONE,
    last_verified_at          TIMESTAMP WITH TIME ZONE,

    created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_user_mfa_user_method UNIQUE (user_id, method)
);

CREATE INDEX idx_user_mfa_user ON user_mfa_config (tenant_id, user_id) WHERE enabled = TRUE;

ALTER TABLE user_mfa_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON user_mfa_config
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.5 Rate Limiting

```sql
rate_limit_counters (
    id                        UUID PRIMARY KEY,
    tenant_id                 UUID,  -- nullable for platform-level limits
    subject_type              VARCHAR(30) NOT NULL,  -- 'user','ip','tenant','platform'
    subject_id                VARCHAR(200) NOT NULL,  -- user_id, IP address, etc.
    endpoint                  VARCHAR(200) NOT NULL,
    window_start              TIMESTAMP WITH TIME ZONE NOT NULL,
    window_duration_seconds   INTEGER NOT NULL,
    counter                   INTEGER NOT NULL DEFAULT 0,
    limit_value               INTEGER NOT NULL,
    last_request_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_rate_limit UNIQUE (subject_type, subject_id, endpoint, window_start)
);

CREATE INDEX idx_rate_limit_lookup ON rate_limit_counters (subject_type, subject_id, window_start DESC);
```

Short retention (24 hours); old rows purged. Used for: login attempts, API calls, password resets, OTP requests.

---

## 6. Data Isolation for User Tables

All user-related tables get standard tenant isolation RLS policies. Example applied to all tables in this part:

```sql
-- Template applied to: users, roles, role_permissions, user_roles, role_audit_log,
-- user_sessions, otp_codes, user_mfa_config

ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON {table}
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY super_admin_bypass ON {table}
    FOR ALL
    USING (current_setting('app.is_super_admin', true) = 'true');
```

`user_login_history` gets slightly looser policy (failed logins with `tenant_id IS NULL`):

```sql
CREATE POLICY tenant_isolation_nullable ON user_login_history
    FOR ALL
    USING (
        tenant_id = current_setting('app.current_tenant_id')::UUID
        OR tenant_id IS NULL AND current_setting('app.is_super_admin', true) = 'true'
    );
```

---

## 7. Standard Seed Data on Tenant Creation

When a new tenant signs up, a platform-level job seeds:

1. `tenants` row with `status = 'trial'`
2. First `users` row for the Owner, `status = 'active'`
3. 8 preset `roles` rows (owner / accountant / cashier / sales / stock_keeper / labour / hr / view_only)
4. ~50-100 `role_permissions` rows per preset (from industry template)
5. Initial `user_roles` row linking Owner user → owner role, `scope_type = 'global'`
6. COA from `industry_templates.default_coa_json` (Part 4)
7. Tax codes from `industry_templates.default_tax_codes_json` (Part 4)
8. Default branch + warehouse (Part 3)
9. Number series defaults (Part 7)

---

## 8. Next Parts

- **Part 3 — Operations**: branches, warehouses, customers, suppliers, items, stock ledger, pricing
- **Part 4 — Accounting**: COA, journals, tax codes, periods, FX
- **Part 5 — Transactions**: invoices, bills, receipts, payments, GRNs, cheques, POS
- **Part 6 — Payroll & HR**: employees, salary structures, payroll runs, leave, loans, bonuses
- **Part 7 — System**: audit log, document storage, notifications, workflows, number series, integrations, plans
- **Part 8 — Performance & ERDs**: indexes, partitioning, materialized views, Mermaid diagrams, RLS examples

---

*Document version: 1.0 · Part 2/8 · Identity & Access · Scope: Sri Lanka only · Full system (not MVP)*

*Decisions locked in Round 2: platform-level governance entities (no tenant_id) including 5 sub-role system for Super Admins; tenants table with multi-country-ready fields; users table with cross-tenant email support (same person can be user in multiple tenants); multi-role + per-role-scoping model with application-layer permission resolution (too complex for DB views); user_sessions with impersonation tracking; comprehensive login history; OTP codes for multiple purposes; MFA config per user per method.*
