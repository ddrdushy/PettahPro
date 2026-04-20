# Data Model — Part 7: System

> Cross-cutting infrastructure. Audit log (immutable change tracking across everything), document storage (S3-backed attachments), notifications (in-app + email + future channels), approval workflow templates (referenced by instances in Part 5), integrations and webhooks, subscription billing (plans, versions, add-ons, coupons), feature flags and usage limits, scheduled jobs, support console entities, and platform-level operational tables. Extends Parts 1-6. Target: Sri Lanka only. Scope: full system.

---

## 1. Scope

Defines:
- `audit_log` (immutable, partitioned monthly) with comprehensive change capture
- `documents` (metadata registry for S3 objects) + `document_access_log`
- `notifications` + `notification_deliveries` + `notification_preferences` + `notification_templates`
- `approval_workflow_templates` + `approval_workflow_steps` (definitions for instances in Part 5)
- `integration_connectors` + `webhook_endpoints` + `webhook_deliveries` + `integration_sync_log`
- `plans` + `plan_versions` + `plan_features` + `add_ons` + `coupons` + `coupon_redemptions`
- `tenant_feature_overrides` + `usage_enforcement_counters`
- `scheduled_jobs` + `job_runs`
- `support_tickets` + `support_ticket_messages` + `impersonation_sessions` (platform-level)
- `landing_page_content` + `email_templates_platform` + `help_center_articles` + `in_app_announcements`
- `tenant_announcements` + `migration_projects` (onboarding)

Some tables are tenant-scoped; others are platform-level (no tenant_id). Marked explicitly.

---

## 2. Audit Log (The Universal Change Ledger)

The single source of truth for "who did what when" across every tenant-owned entity. Immutable, partitioned monthly, queryable via deep-links from transaction pages.

### 2.1 Audit Log Table

```sql
audit_log (
    id                          UUID NOT NULL,  -- UUID v7
    tenant_id                   UUID NOT NULL,

    -- What happened
    action                      VARCHAR(50) NOT NULL,
    -- CRUD: 'create','update','delete','restore'
    -- Business: 'post','void','approve','reject','cancel','reissue','lock','unlock'
    -- Financial: 'credit','debit','adjust','reconcile','revalue'
    -- Workflow: 'submit','escalate','delegate','waive','recalculate'
    -- Security: 'login_success','login_failure','permission_grant','permission_revoke',
    --          'role_assign','role_revoke','password_change','mfa_enable','mfa_disable',
    --          'session_revoke','impersonation_start','impersonation_end'
    -- Data: 'export','bulk_import','bulk_update','bulk_delete'
    -- System: 'config_change','integration_sync','scheduled_job_run'

    -- What was affected
    entity_type                 VARCHAR(50) NOT NULL,
    -- 'invoice','bill','journal_entry','customer','supplier','item','user',
    -- 'role','permission','period','tax_code','payroll_run','payslip','employee',
    -- 'leave_application','loan','cheque','receipt','payment','subscription', etc.
    entity_id                   UUID,
    entity_number               VARCHAR(100),  -- denormalized business number (INV-2026-0047)
    entity_label                VARCHAR(500),  -- denormalized description for display

    -- Who did it
    actor_type                  VARCHAR(30) NOT NULL DEFAULT 'user',
    -- 'user','system','integration','platform_admin','scheduled_job','api_client'
    user_id                     UUID,
    platform_user_id            UUID,  -- set when super admin acted (impersonation)
    actor_name_snapshot         VARCHAR(200),  -- denormalized for display

    -- What changed (for UPDATE actions)
    before_value_json           JSONB,
    after_value_json            JSONB,
    changed_fields              TEXT[],  -- ['status','amount_lkr']
    diff_summary                TEXT,     -- human-readable one-liner

    -- Context
    reason                      TEXT,      -- user-provided justification
    business_context_json       JSONB,     -- transaction-specific context

    -- Request context
    ip_address                  INET,
    user_agent                  TEXT,
    session_id                  UUID,
    request_id                  UUID,       -- for correlating across services
    api_key_id                  UUID,       -- if API-initiated

    -- Special flags
    is_sensitive                BOOLEAN NOT NULL DEFAULT FALSE,
    -- Extra scrutiny: financial impact, permission changes, data exports
    requires_review             BOOLEAN NOT NULL DEFAULT FALSE,

    -- Timing
    occurred_at                 TIMESTAMP WITH TIME ZONE NOT NULL,  -- business time
    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)  -- composite for partitioning
);

-- Partitioned: tenant_id HASH + occurred_at RANGE monthly (see Part 8)

CREATE INDEX idx_audit_log_tenant_entity ON audit_log (tenant_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_log_tenant_user ON audit_log (tenant_id, user_id, occurred_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_audit_log_tenant_action ON audit_log (tenant_id, action, occurred_at DESC);
CREATE INDEX idx_audit_log_tenant_sensitive ON audit_log (tenant_id, is_sensitive, occurred_at DESC) WHERE is_sensitive = TRUE;
CREATE INDEX idx_audit_log_platform_user ON audit_log (tenant_id, platform_user_id, occurred_at DESC) WHERE platform_user_id IS NOT NULL;

-- Immutable
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY super_admin_access ON audit_log
    FOR SELECT USING (current_setting('app.is_super_admin', true) = 'true');
```

### 2.2 Common Audit Patterns

```sql
-- Application generates audit entries via a standard helper:
-- All posted transaction state changes → audit_log
-- All permission changes → audit_log
-- All period reopening → audit_log (plus period_reopening_log in Part 4)
-- All data exports → audit_log with is_sensitive = TRUE
-- All bulk operations → one audit row per affected entity + one summary row
```

### 2.3 Retention

- Default retention: **7 years** (SL statutory requirement for financial records)
- Tenant tier override: Enterprise → 10 years
- Partitions dropped after retention period via scheduled job

---

## 3. Document Storage

Central registry of all S3-backed attachments.

### 3.1 Documents Table

```sql
documents (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- Identity
    filename                    VARCHAR(500) NOT NULL,
    display_name                VARCHAR(500),
    document_type               VARCHAR(50) NOT NULL,
    -- 'invoice_attachment','receipt_image','grn_attachment','bill_attachment',
    -- 'payslip_pdf','statutory_return_file','disbursement_file','expense_receipt',
    -- 'employee_nic_copy','employee_photo','employee_cert','contract',
    -- 'cheque_image','bank_statement','logo','avatar','custom'
    mime_type                   VARCHAR(100) NOT NULL,
    file_extension              VARCHAR(20),
    file_size_bytes             BIGINT NOT NULL,

    -- Storage
    storage_provider            VARCHAR(30) NOT NULL DEFAULT 's3',
    -- 's3','s3_compatible','azure_blob','gcs','local'
    storage_bucket              VARCHAR(200),
    storage_key                 VARCHAR(1000) NOT NULL,  -- path within bucket
    storage_region              VARCHAR(30) DEFAULT 'ap-southeast-1',
    cdn_url                     VARCHAR(500),  -- signed or public URL
    url_expires_at              TIMESTAMP WITH TIME ZONE,

    -- Integrity
    content_hash                VARCHAR(128),  -- SHA-256
    content_hash_algorithm      VARCHAR(20) DEFAULT 'sha256',

    -- Classification
    is_confidential             BOOLEAN NOT NULL DEFAULT FALSE,
    is_public                   BOOLEAN NOT NULL DEFAULT FALSE,
    access_level                VARCHAR(20) NOT NULL DEFAULT 'tenant',
    -- 'tenant' — all tenant users
    -- 'role_restricted' — only specified roles
    -- 'owner_only' — only owner
    -- 'uploader' — only uploader
    allowed_role_ids            UUID[],
    allowed_user_ids            UUID[],

    -- Relation
    related_entity_type         VARCHAR(50),
    related_entity_id           UUID,

    -- OCR / processing
    ocr_processed               BOOLEAN NOT NULL DEFAULT FALSE,
    ocr_text                    TEXT,
    ocr_confidence              NUMERIC(5,2),
    ocr_extracted_json          JSONB,
    ocr_processed_at            TIMESTAMP WITH TIME ZONE,
    ocr_engine                  VARCHAR(30),  -- 'tesseract','otr','chandra_phase2'

    -- Thumbnails / previews
    thumbnail_url               VARCHAR(500),
    preview_url                 VARCHAR(500),  -- PDF-rendered preview of non-PDF types

    -- Virus scan
    virus_scanned               BOOLEAN NOT NULL DEFAULT FALSE,
    virus_scan_clean            BOOLEAN,
    virus_scan_at               TIMESTAMP WITH TIME ZONE,

    -- Expiry (for temporary uploads)
    expires_at                  TIMESTAMP WITH TIME ZONE,

    -- Versioning
    version_number              SMALLINT NOT NULL DEFAULT 1,
    parent_document_id          UUID REFERENCES documents(id),
    is_current_version          BOOLEAN NOT NULL DEFAULT TRUE,

    tags                        JSONB,
    metadata                    JSONB,

    -- Audit
    uploaded_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    uploaded_by                 UUID,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMP WITH TIME ZONE,
    deleted_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_documents_tenant_entity ON documents (tenant_id, related_entity_type, related_entity_id)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_tenant_type ON documents (tenant_id, document_type);
CREATE INDEX idx_documents_tenant_uploader ON documents (tenant_id, uploaded_by, uploaded_at DESC);
CREATE INDEX idx_documents_tenant_expires ON documents (tenant_id, expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_documents_ocr_pending ON documents (tenant_id, ocr_processed) WHERE ocr_processed = FALSE;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.2 Document Access Log

Tracks who accessed which document (for sensitive docs).

```sql
document_access_log (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    document_id                 UUID NOT NULL REFERENCES documents(id),

    access_type                 VARCHAR(20) NOT NULL,  -- 'view','download','share','delete'
    accessed_by                 UUID,
    platform_user_id            UUID,  -- for super admin access
    ip_address                  INET,
    user_agent                  TEXT,
    session_id                  UUID,
    accessed_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doc_access_document ON document_access_log (tenant_id, document_id, accessed_at DESC);
CREATE INDEX idx_doc_access_user ON document_access_log (tenant_id, accessed_by, accessed_at DESC);

ALTER TABLE document_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_access_log FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 3.3 Document Folders (Optional Organization)

```sql
document_folders (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    name                        VARCHAR(200) NOT NULL,
    parent_folder_id            UUID REFERENCES document_folders(id),
    path                        VARCHAR(1000),  -- materialized path
    depth_level                 SMALLINT NOT NULL DEFAULT 0,

    access_level                VARCHAR(20) DEFAULT 'tenant',
    allowed_role_ids            UUID[],

    notes                       TEXT,
    created_at, updated_at, deleted_at, created_by, updated_by
);

document_folder_memberships (
    folder_id                   UUID NOT NULL,
    document_id                 UUID NOT NULL,
    tenant_id                   UUID NOT NULL,
    added_at                    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (folder_id, document_id)
);

CREATE INDEX idx_doc_folders_tenant_parent ON document_folders (tenant_id, parent_folder_id);
CREATE INDEX idx_doc_folder_membership_doc ON document_folder_memberships (tenant_id, document_id);

ALTER TABLE document_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_folder_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_folders FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation ON document_folder_memberships FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 4. Notifications

### 4.1 Notification Templates

Platform-level master + tenant-level overrides.

```sql
notification_templates (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID,  -- NULL = platform default

    template_code               VARCHAR(100) NOT NULL,
    -- 'invoice_posted','payment_received','payslip_generated','leave_approved',
    -- 'bill_overdue','low_stock','trial_ending','subscription_renewed',
    -- 'statutory_return_due','cheque_bounced', etc.

    category                    VARCHAR(50) NOT NULL,
    -- 'transaction','approval','reminder','statutory','security','billing','system'

    -- Channels
    supported_channels          VARCHAR(30)[] NOT NULL DEFAULT ARRAY['in_app','email'],
    -- 'in_app','email','sms','whatsapp','push','webhook'

    -- Content per channel
    in_app_title_template       VARCHAR(200),
    in_app_body_template        TEXT,
    email_subject_template      VARCHAR(500),
    email_body_html_template    TEXT,
    email_body_text_template    TEXT,
    sms_body_template           VARCHAR(300),
    whatsapp_body_template      TEXT,
    webhook_payload_template    JSONB,

    -- Localization
    language                    VARCHAR(5) NOT NULL DEFAULT 'en-LK',

    -- Behavior
    priority                    VARCHAR(20) NOT NULL DEFAULT 'normal',
    -- 'low','normal','high','urgent'
    requires_acknowledgment     BOOLEAN NOT NULL DEFAULT FALSE,
    auto_dismiss_days           INTEGER,

    -- Variables available in template
    variables_json              JSONB,
    -- {"invoice_number": "string", "customer_name": "string", "amount_lkr": "decimal"}

    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    is_system                   BOOLEAN NOT NULL DEFAULT FALSE,  -- can't be deleted

    created_at, updated_at, deleted_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_notif_templates UNIQUE (tenant_id, template_code, language)
);

CREATE INDEX idx_notif_templates_tenant_code ON notification_templates (tenant_id, template_code) WHERE is_active = TRUE;
CREATE INDEX idx_notif_templates_platform ON notification_templates (template_code) WHERE tenant_id IS NULL;

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_nullable ON notification_templates
    FOR ALL USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant_id')::UUID
    );
```

### 4.2 Notifications

```sql
notifications (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    -- What
    template_code               VARCHAR(100) NOT NULL,
    category                    VARCHAR(50) NOT NULL,
    priority                    VARCHAR(20) NOT NULL DEFAULT 'normal',

    -- Who (recipient)
    recipient_user_id           UUID,         -- specific user
    recipient_role_id           UUID,         -- all users in role
    recipient_type              VARCHAR(20) NOT NULL DEFAULT 'user',
    -- 'user','role','tenant_owners','all_tenant_users'

    -- Content (rendered from template)
    title                       VARCHAR(300) NOT NULL,
    body                        TEXT,
    body_html                   TEXT,

    -- Link to relevant entity
    deep_link                   VARCHAR(500),  -- in-app URL
    related_entity_type         VARCHAR(50),
    related_entity_id           UUID,

    -- Channels to deliver via
    channels                    VARCHAR(30)[] NOT NULL,

    -- In-app state
    read_at                     TIMESTAMP WITH TIME ZONE,
    acknowledged_at             TIMESTAMP WITH TIME ZONE,
    dismissed_at                TIMESTAMP WITH TIME ZONE,
    action_taken                VARCHAR(100),

    -- Timing
    send_at                     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at                  TIMESTAMP WITH TIME ZONE,

    -- Aggregation (batching to avoid spam)
    batch_key                   VARCHAR(200),
    batched_count               INTEGER DEFAULT 1,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by                  UUID,
    created_by_type             VARCHAR(20),  -- 'user','system','integration','scheduled_job'

    -- Source data
    context_json                JSONB  -- variables used to render this
);

CREATE INDEX idx_notifications_tenant_user ON notifications (tenant_id, recipient_user_id, send_at DESC)
    WHERE recipient_user_id IS NOT NULL;
CREATE INDEX idx_notifications_tenant_unread ON notifications (tenant_id, recipient_user_id)
    WHERE read_at IS NULL AND recipient_user_id IS NOT NULL;
CREATE INDEX idx_notifications_send_queue ON notifications (send_at) WHERE send_at > NOW();
CREATE INDEX idx_notifications_expires ON notifications (expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.3 Notification Deliveries

Per-channel delivery tracking.

```sql
notification_deliveries (
    id                          UUID NOT NULL,
    tenant_id                   UUID NOT NULL,
    notification_id             UUID NOT NULL REFERENCES notifications(id),

    channel                     VARCHAR(30) NOT NULL,
    -- 'in_app','email','sms','whatsapp','push','webhook'

    -- Destination
    destination                 VARCHAR(500),  -- email, phone, push token, webhook URL

    -- Delivery attempt
    status                      VARCHAR(30) NOT NULL DEFAULT 'pending',
    -- 'pending','queued','sending','sent','delivered','failed','bounced','rejected'
    attempt_count               SMALLINT NOT NULL DEFAULT 0,
    max_attempts                SMALLINT NOT NULL DEFAULT 3,

    -- Timing
    queued_at                   TIMESTAMP WITH TIME ZONE,
    sent_at                     TIMESTAMP WITH TIME ZONE,
    delivered_at                TIMESTAMP WITH TIME ZONE,
    failed_at                   TIMESTAMP WITH TIME ZONE,
    next_retry_at               TIMESTAMP WITH TIME ZONE,

    -- Provider tracking
    provider                    VARCHAR(50),   -- 'ses','sendgrid','twilio','dialog','mobitel','meta'
    provider_message_id         VARCHAR(200),
    provider_response_json      JSONB,

    -- Failure
    error_code                  VARCHAR(50),
    error_message               TEXT,

    -- Metadata
    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, created_at)  -- partitioned monthly
);

-- Partitioned by created_at RANGE monthly (see Part 8)

CREATE INDEX idx_notif_deliveries_notification ON notification_deliveries (tenant_id, notification_id);
CREATE INDEX idx_notif_deliveries_retry ON notification_deliveries (next_retry_at)
    WHERE status IN ('pending','failed') AND next_retry_at IS NOT NULL;
CREATE INDEX idx_notif_deliveries_channel_status ON notification_deliveries (tenant_id, channel, status, created_at DESC);

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_deliveries FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 4.4 Notification Preferences

Two-level: tenant defaults + per-user overrides.

```sql
notification_preferences (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    user_id                     UUID,  -- NULL = tenant default

    event_category              VARCHAR(50) NOT NULL,
    -- 'transactions','approvals','reminders','statutory','security','billing',
    -- 'system','marketing','digest'

    -- Per-channel preference
    channel_enabled_in_app      BOOLEAN NOT NULL DEFAULT TRUE,
    channel_enabled_email       BOOLEAN NOT NULL DEFAULT TRUE,
    channel_enabled_sms         BOOLEAN NOT NULL DEFAULT FALSE,
    channel_enabled_whatsapp    BOOLEAN NOT NULL DEFAULT FALSE,
    channel_enabled_push        BOOLEAN NOT NULL DEFAULT FALSE,

    -- Delivery windows (do not disturb)
    quiet_hours_start           TIME,
    quiet_hours_end             TIME,
    timezone                    VARCHAR(50),
    queue_during_quiet_hours    BOOLEAN NOT NULL DEFAULT TRUE,

    -- Frequency throttling
    max_per_hour                INTEGER,
    batch_digest                BOOLEAN NOT NULL DEFAULT FALSE,
    digest_frequency            VARCHAR(20),  -- 'hourly','daily','weekly'
    digest_delivery_time        TIME,

    created_at, updated_at, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_notif_prefs UNIQUE (tenant_id, user_id, event_category)
);

CREATE INDEX idx_notif_prefs_tenant_user ON notification_preferences (tenant_id, user_id);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_preferences FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 5. Approval Workflow Templates

Referenced by `approval_instances` in Part 5.

### 5.1 Workflow Templates

```sql
approval_workflow_templates (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    name                        VARCHAR(200) NOT NULL,
    description                 TEXT,

    document_type               VARCHAR(50) NOT NULL,
    -- 'purchase_requisition','purchase_order','bill','payment','invoice',
    -- 'credit_note','journal_entry','role_change','discount_waiver',
    -- 'pricing_change','period_reopening','void_request','leave_application',
    -- 'expense_claim','loan_application','final_settlement'

    -- Trigger conditions
    trigger_conditions_json     JSONB,
    -- {"amount_lkr": {"gt": 100000}, "branch_id": {"in": [...]}}

    priority                    INTEGER NOT NULL DEFAULT 100,  -- higher = evaluated first

    -- Default timeouts
    default_sla_hours           INTEGER DEFAULT 48,
    auto_escalate_after_hours   INTEGER,
    auto_approve_after_hours    INTEGER,  -- rare; for low-risk items
    auto_reject_after_hours     INTEGER,

    -- Delegation
    allow_delegation            BOOLEAN NOT NULL DEFAULT TRUE,
    allow_self_approval         BOOLEAN NOT NULL DEFAULT FALSE,

    -- Notifications
    notify_initiator_on_step    BOOLEAN NOT NULL DEFAULT TRUE,
    notify_approver_on_assign   BOOLEAN NOT NULL DEFAULT TRUE,

    -- Scope
    applies_to_branches         UUID[],  -- NULL = all branches
    applies_to_departments      VARCHAR(100)[],

    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    is_system                   BOOLEAN NOT NULL DEFAULT FALSE,

    effective_from              DATE,
    effective_until             DATE,

    created_at, updated_at, deleted_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_awf_tenant_doc_type ON approval_workflow_templates (tenant_id, document_type, is_active, priority DESC);

ALTER TABLE approval_workflow_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_workflow_templates FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 5.2 Workflow Steps (Templates)

```sql
approval_workflow_steps (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    workflow_template_id        UUID NOT NULL REFERENCES approval_workflow_templates(id) ON DELETE CASCADE,

    step_number                 SMALLINT NOT NULL,
    step_label                  VARCHAR(100),

    -- Approver
    approver_type               VARCHAR(30) NOT NULL,
    -- 'user','role','reporting_manager','department_head','branch_manager','auto'
    approver_user_id            UUID,
    approver_role_id            UUID,
    approver_formula_json       JSONB,  -- for reporting_manager, department_head

    -- Parallel approval
    is_parallel                 BOOLEAN NOT NULL DEFAULT FALSE,
    parallel_logic              VARCHAR(20),  -- 'all','any','majority'
    parallel_approver_count     SMALLINT,

    -- Conditional
    condition_json              JSONB,  -- skip step if condition met
    skip_if_initiator_is_approver BOOLEAN NOT NULL DEFAULT TRUE,

    -- Timeouts
    sla_hours                   INTEGER,
    escalate_to_user_id         UUID,
    escalate_to_role_id         UUID,

    -- Notifications
    notify_on_step_start        BOOLEAN NOT NULL DEFAULT TRUE,
    notify_on_pending_reminder  BOOLEAN NOT NULL DEFAULT TRUE,
    reminder_after_hours        INTEGER DEFAULT 24,

    created_at, updated_at,

    CONSTRAINT uk_workflow_steps UNIQUE (workflow_template_id, step_number)
);

CREATE INDEX idx_workflow_steps_template ON approval_workflow_steps (tenant_id, workflow_template_id, step_number);

ALTER TABLE approval_workflow_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_workflow_steps FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 6. Integrations & Webhooks

### 6.1 Integration Connectors

Tenant's connections to external systems.

```sql
integration_connectors (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    name                        VARCHAR(200) NOT NULL,
    connector_type              VARCHAR(50) NOT NULL,
    -- 'biometric_zkteco','biometric_essl','pos_external','payment_gateway',
    -- 'ird_portal','epf_portal','etf_portal','bank_slips','whatsapp_api',
    -- 'email_ses','sms_dialog','sms_mobitel','ecommerce_woocommerce',
    -- 'ecommerce_shopify','accounting_sync','crm_sync','custom_webhook','api_client'

    provider_name               VARCHAR(100),  -- 'ZKTeco','PayHere','WooCommerce'

    -- Config (no secrets — those in secrets manager)
    config_json                 JSONB NOT NULL,
    -- Non-sensitive config: endpoint URL, field mappings, sync frequency

    -- Credentials reference (never stored directly)
    credentials_vault_key       VARCHAR(200),  -- reference to secrets manager

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'active',
    -- 'draft','active','paused','failed','disabled','revoked'

    -- Health
    last_sync_at                TIMESTAMP WITH TIME ZONE,
    last_sync_status            VARCHAR(20),  -- 'success','partial','failed'
    last_error                  TEXT,
    consecutive_failures        INTEGER NOT NULL DEFAULT 0,

    -- Scope
    allowed_actions             VARCHAR(30)[],  -- ['read','write','sync']
    allowed_entities            VARCHAR(50)[],

    -- Rate limits (self-imposed)
    rate_limit_per_hour         INTEGER,
    rate_limit_per_day          INTEGER,

    -- Activation
    activated_at                TIMESTAMP WITH TIME ZONE,
    activated_by                UUID,
    paused_at                   TIMESTAMP WITH TIME ZONE,
    paused_by                   UUID,
    pause_reason                TEXT,

    notes                       TEXT,
    created_at, updated_at, deleted_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_integrations_tenant_type ON integration_connectors (tenant_id, connector_type, status);
CREATE INDEX idx_integrations_unhealthy ON integration_connectors (tenant_id)
    WHERE consecutive_failures > 3;

ALTER TABLE integration_connectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_connectors FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 6.2 Integration Sync Log

```sql
integration_sync_log (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    connector_id                UUID NOT NULL REFERENCES integration_connectors(id),

    sync_type                   VARCHAR(50),  -- 'incoming','outgoing','bidirectional'
    direction                   VARCHAR(10) NOT NULL,  -- 'in','out'
    entity_type                 VARCHAR(50),

    started_at                  TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at                TIMESTAMP WITH TIME ZONE,
    duration_ms                 INTEGER,

    -- Counts
    records_processed           INTEGER DEFAULT 0,
    records_succeeded           INTEGER DEFAULT 0,
    records_failed              INTEGER DEFAULT 0,
    records_skipped             INTEGER DEFAULT 0,

    status                      VARCHAR(20) NOT NULL,
    -- 'running','success','partial','failed','cancelled'

    error_summary               TEXT,
    error_details_json          JSONB,
    payload_sample_json         JSONB,

    triggered_by                VARCHAR(30),  -- 'scheduled','manual','webhook','api'
    triggered_by_user_id        UUID,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_log_connector ON integration_sync_log (tenant_id, connector_id, started_at DESC);
CREATE INDEX idx_sync_log_failures ON integration_sync_log (tenant_id, status, started_at DESC) WHERE status IN ('failed','partial');

ALTER TABLE integration_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_sync_log FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 6.3 Webhook Endpoints

Outbound webhooks tenants subscribe to receive events.

```sql
webhook_endpoints (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    name                        VARCHAR(200) NOT NULL,
    url                         VARCHAR(500) NOT NULL,

    -- Auth
    auth_type                   VARCHAR(20),  -- 'none','bearer','basic','hmac_signature'
    auth_vault_key              VARCHAR(200),
    signing_secret_vault_key    VARCHAR(200),

    -- Subscribed events
    subscribed_events           VARCHAR(100)[] NOT NULL,
    -- ['invoice.posted','payment.received','bill.approved', ...]

    -- Behavior
    retry_strategy              VARCHAR(30) NOT NULL DEFAULT 'exponential',
    -- 'none','fixed','exponential','custom'
    max_retries                 SMALLINT NOT NULL DEFAULT 5,

    -- Headers
    custom_headers_json         JSONB,

    -- Status
    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','paused','failed','disabled'
    consecutive_failures        INTEGER NOT NULL DEFAULT 0,

    -- Filtering
    filter_conditions_json      JSONB,  -- optional payload-level filtering

    last_triggered_at           TIMESTAMP WITH TIME ZONE,
    last_success_at             TIMESTAMP WITH TIME ZONE,
    last_failure_at             TIMESTAMP WITH TIME ZONE,
    last_error                  TEXT,

    notes                       TEXT,
    created_at, updated_at, deleted_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_webhooks_tenant_status ON webhook_endpoints (tenant_id, status);
CREATE INDEX idx_webhooks_events ON webhook_endpoints USING GIN (subscribed_events);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_endpoints FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 6.4 Webhook Deliveries

```sql
webhook_deliveries (
    id                          UUID NOT NULL,
    tenant_id                   UUID NOT NULL,
    endpoint_id                 UUID NOT NULL REFERENCES webhook_endpoints(id),

    event_type                  VARCHAR(100) NOT NULL,
    event_id                    UUID,  -- correlation ID
    payload_json                JSONB NOT NULL,

    -- Delivery attempt
    attempt_number              SMALLINT NOT NULL DEFAULT 1,
    status                      VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending','sending','delivered','failed','abandoned'

    request_sent_at             TIMESTAMP WITH TIME ZONE,
    response_received_at        TIMESTAMP WITH TIME ZONE,
    response_status_code        INTEGER,
    response_body_snippet       TEXT,  -- first 1000 chars
    response_time_ms            INTEGER,

    error_message               TEXT,
    next_retry_at               TIMESTAMP WITH TIME ZONE,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, created_at)  -- partitioned monthly
);

-- Partitioned monthly

CREATE INDEX idx_webhook_deliveries_endpoint ON webhook_deliveries (tenant_id, endpoint_id, created_at DESC);
CREATE INDEX idx_webhook_deliveries_retry ON webhook_deliveries (next_retry_at)
    WHERE status IN ('pending','failed') AND next_retry_at IS NOT NULL;
CREATE INDEX idx_webhook_deliveries_failed ON webhook_deliveries (tenant_id, status, created_at DESC)
    WHERE status = 'failed';

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_deliveries FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### 6.5 API Keys (for external API clients)

```sql
api_keys (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL,

    name                        VARCHAR(200) NOT NULL,
    key_prefix                  VARCHAR(20) NOT NULL,  -- visible "sk_live_xyz..." prefix
    key_hash                    VARCHAR(255) NOT NULL UNIQUE,  -- full hashed

    -- Scoping
    scopes                      VARCHAR(100)[] NOT NULL,  -- ['read:invoices','write:customers']
    allowed_ips                 INET[],
    allowed_origins             VARCHAR(200)[],

    -- Usage limits
    rate_limit_per_minute       INTEGER DEFAULT 60,
    rate_limit_per_day          INTEGER,

    -- Lifecycle
    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','suspended','revoked','expired'

    expires_at                  TIMESTAMP WITH TIME ZONE,
    last_used_at                TIMESTAMP WITH TIME ZONE,
    revoked_at                  TIMESTAMP WITH TIME ZONE,
    revoked_by                  UUID,
    revoke_reason               TEXT,

    -- Tracking
    total_requests              BIGINT NOT NULL DEFAULT 0,
    last_ip_used                INET,

    notes                       TEXT,
    created_at, updated_at, created_by
);

CREATE INDEX idx_api_keys_tenant_status ON api_keys (tenant_id, status);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_keys FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 7. Subscription Billing (Plans, Versions, Add-ons, Coupons)

All platform-level (no tenant_id).

### 7.1 Plans

```sql
plans (
    id                          UUID PRIMARY KEY,

    code                        VARCHAR(30) NOT NULL UNIQUE,
    -- 'starter','growth','scale','enterprise'
    name                        VARCHAR(100) NOT NULL,
    tagline                     VARCHAR(200),
    description                 TEXT,

    sort_order                  SMALLINT NOT NULL DEFAULT 0,

    is_featured                 BOOLEAN NOT NULL DEFAULT FALSE,
    marketing_label             VARCHAR(30),  -- 'Most Popular', 'Best Value'

    is_public                   BOOLEAN NOT NULL DEFAULT TRUE,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,

    -- Enterprise flag
    requires_sales_contact      BOOLEAN NOT NULL DEFAULT FALSE,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

### 7.2 Plan Versions

Pricing changes create new versions; existing tenants grandfathered.

```sql
plan_versions (
    id                          UUID PRIMARY KEY,
    plan_id                     UUID NOT NULL REFERENCES plans(id),

    version_number              INTEGER NOT NULL,
    version_label               VARCHAR(30),  -- 'v1','v2','2026-Q2'

    -- Pricing
    monthly_rate_lkr            NUMERIC(15,2) NOT NULL,
    annual_rate_lkr             NUMERIC(15,2) NOT NULL,
    annual_discount_pct         NUMERIC(5,2),

    -- Limits (structure locked; values here)
    max_users                   INTEGER,
    max_branches                INTEGER,
    max_warehouses              INTEGER,
    max_invoices_per_month      INTEGER,
    max_grns_per_month          INTEGER,
    max_storage_gb              INTEGER,
    max_api_calls_per_day       INTEGER,

    -- Trial
    trial_days                  INTEGER DEFAULT 30,

    -- Feature flags (which features included)
    features_json               JSONB NOT NULL,
    -- {"payroll": true, "multi_branch": true, "manufacturing": false, ...}

    -- Status
    status                      VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft','published','grandfathered_only','sunset'
    effective_from              DATE,
    effective_until             DATE,
    sunset_at                   DATE,  -- when last grandfathered tenant must upgrade

    notes                       TEXT,
    created_at, updated_at, created_by,

    CONSTRAINT uk_plan_versions UNIQUE (plan_id, version_number)
);

CREATE INDEX idx_plan_versions_plan ON plan_versions (plan_id, status);
CREATE INDEX idx_plan_versions_current ON plan_versions (plan_id, effective_from DESC) WHERE status = 'published';
```

### 7.3 Add-ons

```sql
add_ons (
    id                          UUID PRIMARY KEY,

    code                        VARCHAR(30) NOT NULL UNIQUE,
    -- 'payroll_module','multi_branch','batch_tracking','quotations','manufacturing',
    -- 'estore','loyalty_program','extra_users','extra_storage','priority_support'
    name                        VARCHAR(100) NOT NULL,
    description                 TEXT,

    add_on_type                 VARCHAR(30) NOT NULL,
    -- 'feature_unlock','capacity_expansion','service'

    -- Pricing
    monthly_rate_lkr            NUMERIC(15,2) NOT NULL,
    annual_rate_lkr             NUMERIC(15,2),

    -- Capacity add-ons
    capacity_units              VARCHAR(30),  -- 'users','gb','branches','invoices'
    capacity_quantity_per_unit  INTEGER,  -- 1 add-on = how many extra units

    -- Feature keys unlocked (if feature_unlock type)
    unlocks_features            VARCHAR(100)[],

    -- Availability per plan
    available_for_plans         VARCHAR(30)[],  -- ['starter','growth']; empty = all

    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order                  SMALLINT DEFAULT 0,

    created_at, updated_at
);
```

### 7.4 Tenant Subscriptions Add-ons

```sql
tenant_addons (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),
    add_on_id                   UUID NOT NULL REFERENCES add_ons(id),

    quantity                    INTEGER NOT NULL DEFAULT 1,
    monthly_rate_lkr            NUMERIC(15,2) NOT NULL,

    activated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deactivated_at              TIMESTAMP WITH TIME ZONE,

    created_at, updated_at
);

CREATE INDEX idx_tenant_addons_tenant ON tenant_addons (tenant_id) WHERE deactivated_at IS NULL;
```

### 7.5 Coupons

```sql
coupons (
    id                          UUID PRIMARY KEY,

    code                        VARCHAR(30) NOT NULL UNIQUE,
    name                        VARCHAR(200),
    description                 TEXT,

    discount_type               VARCHAR(20) NOT NULL,
    -- 'percentage','fixed_amount','free_months','rate_lock'
    discount_value              NUMERIC(15,2) NOT NULL,
    applies_to                  VARCHAR(30) NOT NULL DEFAULT 'subscription',
    -- 'subscription','addons','both','migration'

    -- Applicability
    applicable_plans            VARCHAR(30)[],
    applicable_billing_cycles   VARCHAR(20)[],  -- ['monthly','annual']
    minimum_amount_lkr          NUMERIC(15,2),

    -- Validity
    valid_from                  TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_until                 TIMESTAMP WITH TIME ZONE,

    -- Limits
    max_redemptions_total       INTEGER,
    max_redemptions_per_tenant  INTEGER DEFAULT 1,
    redemption_count            INTEGER NOT NULL DEFAULT 0,

    -- Duration of discount (for %-off on subscription)
    duration                    VARCHAR(30) NOT NULL DEFAULT 'forever',
    -- 'once','repeating','forever'
    duration_months             INTEGER,

    -- Tenant eligibility
    new_tenants_only            BOOLEAN NOT NULL DEFAULT FALSE,
    existing_tenants_only       BOOLEAN NOT NULL DEFAULT FALSE,
    specific_tenant_ids         UUID[],

    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    is_public                   BOOLEAN NOT NULL DEFAULT TRUE,  -- false = referral/private codes

    campaign_tag                VARCHAR(100),  -- for tracking

    notes                       TEXT,
    created_at, updated_at, created_by
);

coupon_redemptions (
    id                          UUID PRIMARY KEY,
    coupon_id                   UUID NOT NULL REFERENCES coupons(id),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),

    redeemed_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    applied_to_subscription_id  UUID,
    discount_applied_lkr        NUMERIC(15,2),
    discount_period_start       DATE,
    discount_period_end         DATE,

    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','expired','revoked','completed'

    revoked_at                  TIMESTAMP WITH TIME ZONE,
    revoke_reason               TEXT
);

CREATE INDEX idx_coupons_code_active ON coupons (code) WHERE is_active = TRUE;
CREATE INDEX idx_coupon_redemptions_coupon ON coupon_redemptions (coupon_id, redeemed_at DESC);
CREATE INDEX idx_coupon_redemptions_tenant ON coupon_redemptions (tenant_id);
```

### 7.6 Invoices for Subscriptions (Platform-Issued to Tenants)

Separate from tenant-issued customer invoices (Part 5).

```sql
platform_invoices (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),

    invoice_number              VARCHAR(50) NOT NULL UNIQUE,
    invoice_date                DATE NOT NULL,
    due_date                    DATE NOT NULL,
    period_start                DATE NOT NULL,
    period_end                  DATE NOT NULL,

    -- Breakdown
    plan_amount_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,
    addons_amount_lkr           NUMERIC(15,2) NOT NULL DEFAULT 0,
    overage_amount_lkr          NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_amount_lkr         NUMERIC(15,2) NOT NULL DEFAULT 0,
    coupon_discount_lkr         NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_amount_lkr              NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_amount_lkr            NUMERIC(15,2) NOT NULL,

    currency                    CHAR(3) NOT NULL DEFAULT 'LKR',

    -- Payment
    amount_paid_lkr             NUMERIC(15,2) NOT NULL DEFAULT 0,
    amount_outstanding_lkr      NUMERIC(15,2) NOT NULL DEFAULT 0,

    status                      VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft','issued','paid','overdue','voided','written_off'

    pdf_url                     VARCHAR(500),

    notes                       TEXT,
    line_items_json             JSONB,  -- detailed line breakdown

    created_at, updated_at
);

platform_invoice_payments (
    id                          UUID PRIMARY KEY,
    platform_invoice_id         UUID NOT NULL REFERENCES platform_invoices(id),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),

    payment_date                DATE NOT NULL,
    amount_lkr                  NUMERIC(15,2) NOT NULL,
    payment_method              VARCHAR(30),  -- 'bank_transfer','credit_card','direct_debit'
    gateway_reference           VARCHAR(200),
    gateway_name                VARCHAR(50),

    status                      VARCHAR(20) NOT NULL DEFAULT 'completed',
    -- 'pending','completed','failed','refunded','disputed'

    failure_reason              TEXT,
    refund_reason               TEXT,

    created_at
);

-- Dunning (overdue payment tracking)
dunning_events (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),
    platform_invoice_id         UUID REFERENCES platform_invoices(id),

    event_type                  VARCHAR(30) NOT NULL,
    -- 'reminder_sent','final_notice','service_suspended','account_terminated',
    -- 'payment_received','escalation'

    days_overdue                INTEGER,
    action_taken                TEXT,
    notification_sent_via       VARCHAR(30),
    performed_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    performed_by                UUID  -- platform_user_id or 'system'
);

CREATE INDEX idx_platform_invoices_tenant ON platform_invoices (tenant_id, invoice_date DESC);
CREATE INDEX idx_platform_invoices_status ON platform_invoices (status, due_date);
CREATE INDEX idx_dunning_events_tenant ON dunning_events (tenant_id, performed_at DESC);
```

---

## 8. Feature Flags & Usage Enforcement

### 8.1 Feature Flags (Platform)

Already introduced in Part 2 — expanded here.

```sql
-- feature_flags defined in Part 2; referenced here
-- Core pattern:
-- feature_flags (id, flag_name, description, enabled_globally, rollout_percentage,
--   enabled_tenant_ids, disabled_tenant_ids, ...)
```

### 8.2 Tenant Feature Overrides

```sql
tenant_feature_overrides (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),
    feature_key                 VARCHAR(100) NOT NULL,

    is_enabled                  BOOLEAN NOT NULL,
    reason                      VARCHAR(500),
    -- 'paid_addon','legacy_grandfathered','beta_participant','support_override','trial_extended'

    effective_from              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    effective_until             TIMESTAMP WITH TIME ZONE,

    granted_by                  UUID,  -- platform_user_id
    notes                       TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_tenant_feature UNIQUE (tenant_id, feature_key, effective_from)
);

CREATE INDEX idx_tenant_feature_overrides ON tenant_feature_overrides (tenant_id, feature_key);
```

### 8.3 Usage Enforcement Counters

Runtime enforcement (hard-block users/storage, auto-bill invoices/GRNs).

```sql
usage_enforcement_counters (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),

    metric_key                  VARCHAR(50) NOT NULL,
    -- 'users_count','storage_mb','invoices_in_month','grns_in_month','api_calls_today'

    period_type                 VARCHAR(20) NOT NULL,  -- 'ongoing','monthly','daily'
    period_start                TIMESTAMP WITH TIME ZONE,
    period_end                  TIMESTAMP WITH TIME ZONE,

    current_usage               BIGINT NOT NULL DEFAULT 0,
    soft_limit                  BIGINT,   -- warning threshold
    hard_limit                  BIGINT,   -- block threshold (for users/storage)
    overage_allowed             BOOLEAN NOT NULL DEFAULT FALSE,  -- for invoices/GRNs
    overage_count               BIGINT NOT NULL DEFAULT 0,
    overage_cap                 BIGINT,   -- tenant-configurable max overage

    -- Alerts sent
    soft_limit_alerted_at       TIMESTAMP WITH TIME ZONE,
    hard_limit_alerted_at       TIMESTAMP WITH TIME ZONE,
    overage_cap_alerted_at      TIMESTAMP WITH TIME ZONE,

    last_updated_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_usage_counters UNIQUE (tenant_id, metric_key, period_start)
);

CREATE INDEX idx_usage_counters_tenant ON usage_enforcement_counters (tenant_id, metric_key);
CREATE INDEX idx_usage_counters_overage ON usage_enforcement_counters (tenant_id, metric_key)
    WHERE current_usage > soft_limit;
```

---

## 9. Scheduled Jobs

### 9.1 Scheduled Jobs

```sql
scheduled_jobs (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID,  -- NULL = platform job

    job_name                    VARCHAR(200) NOT NULL,
    job_type                    VARCHAR(50) NOT NULL,
    -- 'recurring_invoice_generation','period_lock_check','payroll_reminder',
    -- 'stale_cheque_detection','leave_accrual','statutory_return_reminder',
    -- 'subscription_renewal','feature_flag_rollout','data_export_cleanup',
    -- 'ocr_processing','webhook_retry','dunning','audit_log_retention',
    -- 'usage_counter_reset','tenant_health_score','email_digest'

    -- Schedule
    schedule_type               VARCHAR(20) NOT NULL,
    -- 'cron','interval','once','event_driven'
    cron_expression             VARCHAR(100),
    interval_seconds            INTEGER,
    run_once_at                 TIMESTAMP WITH TIME ZONE,

    timezone                    VARCHAR(50) DEFAULT 'Asia/Colombo',

    -- Config
    config_json                 JSONB,

    -- State
    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    -- 'active','paused','completed','failed','disabled'
    last_run_at                 TIMESTAMP WITH TIME ZONE,
    last_run_status             VARCHAR(20),
    next_run_at                 TIMESTAMP WITH TIME ZONE,
    consecutive_failures        INTEGER NOT NULL DEFAULT 0,

    -- Concurrency
    max_concurrency             INTEGER DEFAULT 1,
    currently_running_count     INTEGER NOT NULL DEFAULT 0,

    -- Retention
    retain_history_days         INTEGER DEFAULT 90,

    created_at, updated_at, created_by, updated_by, version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_scheduled_jobs_active ON scheduled_jobs (status, next_run_at) WHERE status = 'active';
CREATE INDEX idx_scheduled_jobs_tenant ON scheduled_jobs (tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_nullable ON scheduled_jobs
    FOR ALL USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant_id')::UUID
    );
```

### 9.2 Job Runs

```sql
job_runs (
    id                          UUID NOT NULL,
    tenant_id                   UUID,
    job_id                      UUID NOT NULL REFERENCES scheduled_jobs(id),

    started_at                  TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at                TIMESTAMP WITH TIME ZONE,
    duration_ms                 INTEGER,

    status                      VARCHAR(20) NOT NULL,
    -- 'running','succeeded','failed','timeout','cancelled'

    items_processed             INTEGER,
    items_succeeded             INTEGER,
    items_failed                INTEGER,

    result_summary              TEXT,
    error_message               TEXT,
    error_stack                 TEXT,
    output_json                 JSONB,

    triggered_by                VARCHAR(30),  -- 'scheduled','manual','webhook','api'
    triggered_by_user_id        UUID,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, created_at)  -- partitioned monthly
);

CREATE INDEX idx_job_runs_job ON job_runs (tenant_id, job_id, started_at DESC);
CREATE INDEX idx_job_runs_failed ON job_runs (status, started_at DESC) WHERE status IN ('failed','timeout');

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_nullable ON job_runs
    FOR ALL USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant_id')::UUID
    );
```

---

## 10. Support Console (Platform-Level)

### 10.1 Support Tickets

```sql
support_tickets (
    id                          UUID PRIMARY KEY,

    ticket_number               VARCHAR(50) NOT NULL UNIQUE,
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),
    reported_by_user_id         UUID,  -- from within tenant

    -- Categorization
    category                    VARCHAR(50) NOT NULL,
    -- 'billing','technical','feature_request','bug','how_to','migration',
    -- 'integration','compliance','security','other'
    subcategory                 VARCHAR(100),
    priority                    VARCHAR(20) NOT NULL DEFAULT 'normal',
    -- 'low','normal','high','urgent','critical'

    -- Content
    subject                     VARCHAR(500) NOT NULL,
    description                 TEXT NOT NULL,

    -- Assignment
    assigned_to_platform_user_id UUID,
    assigned_at                 TIMESTAMP WITH TIME ZONE,
    assignment_queue            VARCHAR(50),

    -- SLA
    sla_tier                    VARCHAR(20),  -- 'standard','priority','enterprise'
    sla_response_due_at         TIMESTAMP WITH TIME ZONE,
    sla_resolution_due_at       TIMESTAMP WITH TIME ZONE,
    first_response_at           TIMESTAMP WITH TIME ZONE,
    resolved_at                 TIMESTAMP WITH TIME ZONE,
    sla_breached                BOOLEAN NOT NULL DEFAULT FALSE,

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'open',
    -- 'new','open','in_progress','waiting_on_customer','waiting_on_engineering',
    -- 'resolved','closed','reopened','escalated'

    resolution_summary          TEXT,
    resolution_type             VARCHAR(30),
    -- 'fixed','workaround_provided','documentation','not_a_bug','duplicate',
    -- 'wont_fix','external_issue'

    -- Customer satisfaction
    csat_score                  SMALLINT,  -- 1-5
    csat_comment                TEXT,
    csat_submitted_at           TIMESTAMP WITH TIME ZONE,

    -- Context
    impersonation_required      BOOLEAN NOT NULL DEFAULT FALSE,
    impersonation_session_id    UUID,

    related_ticket_ids          UUID[],
    tags                        VARCHAR(100)[],

    created_at, updated_at
);

CREATE INDEX idx_support_tickets_tenant ON support_tickets (tenant_id, created_at DESC);
CREATE INDEX idx_support_tickets_status ON support_tickets (status, priority, created_at DESC);
CREATE INDEX idx_support_tickets_assignee ON support_tickets (assigned_to_platform_user_id, status)
    WHERE assigned_to_platform_user_id IS NOT NULL;
CREATE INDEX idx_support_tickets_sla ON support_tickets (sla_resolution_due_at)
    WHERE status NOT IN ('resolved','closed');
```

### 10.2 Support Ticket Messages

```sql
support_ticket_messages (
    id                          UUID PRIMARY KEY,
    ticket_id                   UUID NOT NULL REFERENCES support_tickets(id),

    message_type                VARCHAR(30) NOT NULL,
    -- 'customer_message','agent_reply','internal_note','system_event','status_change'

    from_user_id                UUID,       -- tenant user
    from_platform_user_id       UUID,       -- support staff
    from_name_snapshot          VARCHAR(200),
    from_type                   VARCHAR(20),  -- 'customer','support','system','integration'

    subject                     VARCHAR(500),
    body                        TEXT NOT NULL,
    body_format                 VARCHAR(20) DEFAULT 'text',  -- 'text','markdown','html'

    is_internal                 BOOLEAN NOT NULL DEFAULT FALSE,  -- not visible to customer
    attachments_json            JSONB,

    sent_via                    VARCHAR(20),  -- 'portal','email','chat','phone'

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_messages_ticket ON support_ticket_messages (ticket_id, created_at);
```

### 10.3 Impersonation Sessions (Platform-Level)

Critical audit table — tracks every super-admin tenant impersonation.

```sql
impersonation_sessions (
    id                          UUID PRIMARY KEY,

    platform_user_id            UUID NOT NULL REFERENCES platform_users(id),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),
    impersonated_user_id        UUID,  -- optional: specific tenant user to emulate

    -- Consent
    consent_ticket_id           UUID REFERENCES support_tickets(id),
    consent_granted_by_user_id  UUID,  -- tenant user who approved
    consent_method              VARCHAR(30),  -- 'email_otp','portal_approval','phone_verification'
    consent_granted_at          TIMESTAMP WITH TIME ZONE NOT NULL,
    consent_otp_id              UUID,

    -- Time bounds
    started_at                  TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at                  TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at                    TIMESTAMP WITH TIME ZONE,
    ended_reason                VARCHAR(50),
    -- 'completed','expired','revoked_by_tenant','revoked_by_platform','session_error'

    -- Scope
    allowed_actions             VARCHAR(100)[],  -- restricted list of actions permitted
    ip_restriction              INET,

    -- Tracking
    actions_performed_count     INTEGER NOT NULL DEFAULT 0,
    last_activity_at            TIMESTAMP WITH TIME ZONE,

    -- Transparency
    tenant_notified_at          TIMESTAMP WITH TIME ZONE,
    included_in_transparency_report_at TIMESTAMP WITH TIME ZONE,

    -- Logging (detail in audit_log with platform_user_id populated)

    notes                       TEXT,
    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_impersonation_platform_user ON impersonation_sessions (platform_user_id, started_at DESC);
CREATE INDEX idx_impersonation_tenant ON impersonation_sessions (tenant_id, started_at DESC);
CREATE INDEX idx_impersonation_active ON impersonation_sessions (platform_user_id) WHERE ended_at IS NULL;
```

### 10.4 Transparency Reports

Periodic reports sent to tenant owners documenting all platform access during period.

```sql
tenant_transparency_reports (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),

    report_period_start         DATE NOT NULL,
    report_period_end           DATE NOT NULL,
    report_type                 VARCHAR(30) NOT NULL DEFAULT 'quarterly',  -- 'quarterly','annual','on_demand'

    -- Contents
    impersonation_count         INTEGER NOT NULL DEFAULT 0,
    log_access_count            INTEGER NOT NULL DEFAULT 0,
    data_export_count           INTEGER NOT NULL DEFAULT 0,
    config_changes_count        INTEGER NOT NULL DEFAULT 0,
    total_platform_actions      INTEGER NOT NULL DEFAULT 0,

    details_json                JSONB,
    report_pdf_url              VARCHAR(500),

    generated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    generated_by                UUID,

    sent_at                     TIMESTAMP WITH TIME ZONE,
    sent_to_user_ids            UUID[],
    acknowledged_at             TIMESTAMP WITH TIME ZONE,
    acknowledged_by             UUID,

    UNIQUE (tenant_id, report_period_start, report_type)
);

CREATE INDEX idx_transparency_reports_tenant ON tenant_transparency_reports (tenant_id, report_period_start DESC);
```

---

## 11. Content Management (Platform-Level)

### 11.1 Landing Page Content

```sql
landing_page_content (
    id                          UUID PRIMARY KEY,

    section_key                 VARCHAR(100) NOT NULL,
    -- 'hero','features','testimonials','pricing','faq','footer','trust_bar','case_studies'
    language                    VARCHAR(5) NOT NULL DEFAULT 'en-LK',

    content_json                JSONB NOT NULL,
    display_order               SMALLINT DEFAULT 0,

    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    scheduled_activation_at     TIMESTAMP WITH TIME ZONE,
    scheduled_deactivation_at   TIMESTAMP WITH TIME ZONE,

    -- A/B testing
    variant_id                  VARCHAR(50),
    variant_split_percentage    NUMERIC(5,2),

    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by                  UUID,
    version                     INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_landing_content UNIQUE (section_key, language, variant_id)
);
```

### 11.2 Email Templates (Platform-Level Transactional Emails)

```sql
email_templates_platform (
    id                          UUID PRIMARY KEY,

    template_code               VARCHAR(100) NOT NULL,
    -- 'welcome','email_verification','password_reset','trial_ending','subscription_renewed',
    -- 'payment_failed','tenant_suspended','impersonation_consent','transparency_report'
    language                    VARCHAR(5) NOT NULL DEFAULT 'en-LK',

    subject_template            VARCHAR(500) NOT NULL,
    body_html_template          TEXT NOT NULL,
    body_text_template          TEXT,

    from_address                VARCHAR(200),
    from_name                   VARCHAR(200),
    reply_to_address            VARCHAR(200),

    variables_json              JSONB,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_email_templates_platform UNIQUE (template_code, language)
);
```

### 11.3 Help Center Articles

```sql
help_center_articles (
    id                          UUID PRIMARY KEY,

    slug                        VARCHAR(300) NOT NULL,
    language                    VARCHAR(5) NOT NULL DEFAULT 'en-LK',

    title                       VARCHAR(500) NOT NULL,
    summary                     TEXT,
    body_markdown               TEXT NOT NULL,
    body_html                   TEXT,  -- pre-rendered

    category                    VARCHAR(100),
    subcategory                 VARCHAR(100),
    tags                        VARCHAR(100)[],

    author_id                   UUID,  -- platform_user_id
    reviewer_id                 UUID,

    status                      VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft','review','published','archived','deprecated'

    is_featured                 BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order                  SMALLINT DEFAULT 0,

    -- Analytics
    view_count                  BIGINT NOT NULL DEFAULT 0,
    helpful_count               INTEGER NOT NULL DEFAULT 0,
    not_helpful_count           INTEGER NOT NULL DEFAULT 0,

    published_at                TIMESTAMP WITH TIME ZONE,
    archived_at                 TIMESTAMP WITH TIME ZONE,

    created_at, updated_at, version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uk_help_articles UNIQUE (slug, language)
);

CREATE INDEX idx_help_articles_status_lang ON help_center_articles (status, language, sort_order);
CREATE INDEX idx_help_articles_search ON help_center_articles USING GIN (to_tsvector('english', title || ' ' || coalesce(summary,'') || ' ' || body_markdown));
```

### 11.4 In-App Announcements

```sql
in_app_announcements (
    id                          UUID PRIMARY KEY,

    title                       VARCHAR(500) NOT NULL,
    body                        TEXT NOT NULL,
    body_format                 VARCHAR(20) DEFAULT 'markdown',
    language                    VARCHAR(5) NOT NULL DEFAULT 'en-LK',

    announcement_type           VARCHAR(30) NOT NULL,
    -- 'feature_launch','maintenance','security','pricing_change','tip','survey'
    severity                    VARCHAR(20) DEFAULT 'info',
    -- 'info','warning','critical'

    cta_label                   VARCHAR(100),
    cta_url                     VARCHAR(500),

    -- Targeting
    target_all_tenants          BOOLEAN NOT NULL DEFAULT TRUE,
    target_tenant_ids           UUID[],
    target_plan_codes           VARCHAR(30)[],
    target_user_role_codes      VARCHAR(30)[],

    -- Display
    display_style               VARCHAR(20) DEFAULT 'banner',  -- 'banner','modal','inline','toast'
    dismissible                 BOOLEAN NOT NULL DEFAULT TRUE,

    -- Schedule
    publish_at                  TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at                  TIMESTAMP WITH TIME ZONE,

    status                      VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft','scheduled','published','expired','cancelled'

    created_at, updated_at, created_by
);

CREATE INDEX idx_announcements_active ON in_app_announcements (status, publish_at)
    WHERE status = 'published';

-- Per-user dismissal tracking (so user doesn't see dismissed ones again)
user_announcement_dismissals (
    user_id                     UUID NOT NULL,
    announcement_id             UUID NOT NULL,
    tenant_id                   UUID NOT NULL,
    dismissed_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, announcement_id)
);
```

---

## 12. Migration Projects (Tenant Onboarding)

```sql
migration_projects (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),

    project_number              VARCHAR(50) NOT NULL UNIQUE,
    migration_type              VARCHAR(30) NOT NULL,
    -- 'self_serve','assisted','white_glove','parallel_run'
    source_system               VARCHAR(50),
    -- 'busy','tally','quickbooks','zoho','sage','excel','custom','fresh_start'

    -- Assignment
    assigned_csm_id             UUID,  -- platform_user_id (customer success manager)
    assigned_engineer_id        UUID,

    -- Schedule
    planned_start_date          DATE,
    planned_completion_date     DATE,
    actual_start_date           DATE,
    actual_completion_date      DATE,

    -- Scope
    scope_modules               VARCHAR(50)[],  -- ['accounting','inventory','payroll','sell','buy']
    records_to_migrate_json     JSONB,
    -- {"customers": 500, "suppliers": 200, "items": 3000, "opening_trial_balance": true}

    -- Parallel run
    parallel_run_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    parallel_run_start_date     DATE,
    parallel_run_end_date       DATE,
    go_live_date                DATE,

    -- Status
    status                      VARCHAR(30) NOT NULL DEFAULT 'planning',
    -- 'planning','discovery','mapping','importing','validation','parallel_run',
    -- 'go_live','stabilization','completed','stalled','cancelled'

    -- Checklist
    checklist_json              JSONB,
    -- {"kickoff": true, "data_dump_received": true, "mapping_approved": false, ...}

    -- Records
    records_imported_json       JSONB,
    import_errors_count         INTEGER DEFAULT 0,
    validation_issues_count     INTEGER DEFAULT 0,

    -- Field-mapping intelligence (platform learning)
    field_mappings_json         JSONB,
    learnings_saved_to_library  BOOLEAN DEFAULT FALSE,

    customer_rating             SMALLINT,  -- 1-5 post-migration survey
    customer_feedback           TEXT,

    notes                       TEXT,
    created_at, updated_at, created_by
);

CREATE INDEX idx_migration_projects_tenant ON migration_projects (tenant_id);
CREATE INDEX idx_migration_projects_status ON migration_projects (status);
CREATE INDEX idx_migration_projects_csm ON migration_projects (assigned_csm_id, status);
```

---

## 13. Regulatory Updates

Track govt regulation changes and rollout to tenants.

```sql
regulatory_updates (
    id                          UUID PRIMARY KEY,

    title                       VARCHAR(500) NOT NULL,
    description                 TEXT,
    update_type                 VARCHAR(30) NOT NULL,
    -- 'tax_rate_change','new_form','compliance_deadline','rule_change','clarification'

    affected_area               VARCHAR(50),  -- 'vat','sscl','paye','epf','etf','customs','labour_law'

    -- Source
    gazette_reference           VARCHAR(200),
    gazette_date                DATE,
    effective_date              DATE NOT NULL,
    announcement_date           DATE,

    -- Platform impact
    requires_code_change        BOOLEAN NOT NULL DEFAULT FALSE,
    requires_config_change      BOOLEAN NOT NULL DEFAULT FALSE,
    auto_apply_to_tenants       BOOLEAN NOT NULL DEFAULT FALSE,

    -- Rollout
    rollout_strategy            VARCHAR(30),  -- 'immediate','gradual','opt_in','manual'
    rollout_started_at          TIMESTAMP WITH TIME ZONE,
    rollout_completed_at        TIMESTAMP WITH TIME ZONE,
    tenants_updated_count       INTEGER DEFAULT 0,

    -- Customer communication
    customer_facing_summary     TEXT,
    announcement_sent_at        TIMESTAMP WITH TIME ZONE,
    help_article_id             UUID REFERENCES help_center_articles(id),

    status                      VARCHAR(20) NOT NULL DEFAULT 'monitoring',
    -- 'monitoring','analyzing','implementing','rolling_out','completed','cancelled'

    notes                       TEXT,
    created_at, updated_at
);

CREATE INDEX idx_regulatory_updates_effective ON regulatory_updates (effective_date DESC);
CREATE INDEX idx_regulatory_updates_status ON regulatory_updates (status);
```

---

## 14. Data Export / GDPR Support

```sql
data_export_requests (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),

    request_number              VARCHAR(50) NOT NULL UNIQUE,
    requested_by_user_id        UUID NOT NULL,
    request_reason              TEXT,

    export_type                 VARCHAR(30) NOT NULL,
    -- 'full_backup','specific_entities','date_range','compliance_audit','gdpr_subject_access'

    scope_json                  JSONB,
    format                      VARCHAR(20) NOT NULL,  -- 'csv','excel','json','sql_dump','pdf'

    status                      VARCHAR(20) NOT NULL DEFAULT 'queued',
    -- 'queued','processing','ready','downloaded','expired','failed','cancelled'

    started_at                  TIMESTAMP WITH TIME ZONE,
    completed_at                TIMESTAMP WITH TIME ZONE,
    download_url                VARCHAR(500),
    download_expires_at         TIMESTAMP WITH TIME ZONE,
    downloaded_at               TIMESTAMP WITH TIME ZONE,
    downloaded_count            INTEGER NOT NULL DEFAULT 0,

    file_size_bytes             BIGINT,
    record_count                BIGINT,

    error_message               TEXT,

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_data_exports_tenant ON data_export_requests (tenant_id, created_at DESC);
CREATE INDEX idx_data_exports_status ON data_export_requests (status);

ALTER TABLE data_export_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON data_export_requests FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

---

## 15. Next Parts

- **Part 8 — Performance & ERDs**: indexes detail, partitioning strategy, materialized views, Mermaid ERD diagrams, RLS policy examples, query patterns, capacity planning

---

*Document version: 1.0 · Part 7/8 · System · Scope: Sri Lanka only · Full system (not MVP)*

*Decisions locked in Round 7 (all recommended approaches adopted): comprehensive audit_log (monthly partitioned, immutable, 7-year default retention) capturing CRUD + business + financial + workflow + security + data + system actions with before/after JSONB, changed_fields array, sensitive flag; documents registry backed by S3 with OCR fields, virus scan, versioning, access_log for confidential docs + document_folders for organization; notifications with template (platform + tenant override) + multi-channel deliveries (in-app / email / SMS / WhatsApp / push / webhook) partitioned monthly + two-level preferences with quiet hours and digest; approval_workflow_templates + _steps as definitions referenced by approval_instances (Part 5) with parallel logic, conditional skips, SLA timeouts, escalation; integration_connectors with secrets vault references + sync_log + webhook_endpoints + webhook_deliveries (monthly partitioned) + api_keys with scoping; subscription billing as plans + effective-dated plan_versions with full features_json + add_ons + tenant_addons + coupons + coupon_redemptions + platform_invoices + platform_invoice_payments + dunning_events; tenant_feature_overrides + usage_enforcement_counters for runtime enforcement; scheduled_jobs + job_runs (monthly partitioned) for platform + tenant-specific; support_tickets with SLA tracking + ticket_messages (customer/agent/internal) + impersonation_sessions (platform-level with consent workflow, time bounds, scope restrictions) + tenant_transparency_reports (quarterly); platform CMS (landing_page_content with A/B variants, email_templates_platform, help_center_articles with full-text search, in_app_announcements with targeting and per-user dismissal); migration_projects with checklist JSON and field-mapping learning library; regulatory_updates with rollout strategy and tenant update tracking; data_export_requests with GDPR support including Subject Access Requests.*
