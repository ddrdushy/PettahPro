# Tenant Admin UX Design Spec — Multi-Tenant Accounting SaaS (Sri Lanka)

> Specification for the **Tenant Admin experience** — how the Business Owner and delegated admin roles interact with configuration, user management, integrations, audit, and subscription controls within their workspace. Companion document to the Layer 2 (Business Tenant) spec, which defined *what* admins can configure. This spec defines *how* they experience it. Target market: **Sri Lanka only**. Scope: **full system, not MVP**.

---

## 1. Scope & Foundational Principles

### 1.1 Who this spec serves
- **Business Owner** — full admin by default
- **Delegated admin roles** — created by Owner with granular scoped permissions (e.g. "Kandy Branch Manager" can edit Kandy-branch settings but not others)
- **Accountant / HR** — receive admin permissions *only if Owner explicitly grants*, not auto-assigned

### 1.2 UX Principles
- **Multi-role reality** — one user is frequently Owner + Accountant + HR simultaneously; the admin UX treats this as the norm, not an edge case
- **Easy Mode + Advanced Mode** on every complex screen (platform-level UX standard)
- **LLM-assist** where cognitive load is high (account classification, category suggestion, translation)
- **Multi-language** — EN / TA / SI per user preference
- **Progressive disclosure** — simple actions surface fast; complex configuration deserves dedicated space
- **Gentle for non-sysadmins** — SL shopkeeper may have never used admin software before; BUSY/Tally admin is notoriously cryptic
- **Safety-first on destructive actions** — typed confirmations, cooling-off periods, impact previews

### 1.3 Foundational decisions carried forward
- Multi-role assignment model (additive union + per-role scoping) from Layer 2
- Privacy-respecting audit trail (financial fields immutable, edit history visible)
- No WhatsApp / SMS invites yet (email OTP only; WhatsApp deferred)
- No live bank feeds (upload-based only)
- SL-only market

---

## 2. Admin Location & Homepage

### 2.1 Hybrid admin model
- **Frequent actions inline** — quick user invite, adjust a tax rate, tweak a template live inside the tenant workspace via contextual *"Settings"* gear icon
- **Deep admin work** — multi-role permission matrix, workflow designer, branch mapping, audit viewing happens in dedicated Admin console (separate section, distinct URL within the tenant)
- No explicit mode switch; Owner moves seamlessly between operations and admin

### 2.2 Admin homepage layout (hybrid)

**Top zone — Status tiles (attention-worthy)**:
- Setup completeness score (see 2.3)
- Items needing attention (*"3 users haven't logged in for 30 days"*, *"VAT rate was updated by platform on Feb 1 — review"*, *"Subscription renews in 12 days"*)
- Recent admin activity (last 5 configuration changes with who/when)

**Below — Menu grid**:
- Navigational cards grouped by section (Business / People / Financial / Operations / Documents / Integrations / Subscription / System)
- Each card shows section summary + count of sub-items

### 2.3 Setup completeness score

Visible progress bar on admin homepage. Encourages Owner to fill gaps.

**10-item scoring (10% each)**:
- Business profile complete (logo, address, VAT#)
- Branches added
- At least 1 warehouse configured
- Tax codes reviewed
- At least 1 user invited
- Approval workflows configured
- Integrations connected (at least 1 payment gateway)
- Chart of Accounts reviewed
- Invoice template customized
- First transaction posted

**Behavior**:
- Incomplete items are clickable → direct link to relevant setting screen
- Dismissible once 100% or user clicks *"I'm done"*
- Re-appears if critical setup gap emerges later (e.g. subscription upgraded but no admin for a new module)

### 2.4 Navigation structure (left sidebar)

Sticky left sidebar, 8 sections:

**Business**
- Business profile
- Branches & Warehouses
- Fiscal year & period locks
- Industry template

**People**
- Users
- Roles & Permissions
- Labour (attendance-only workers)

**Financial**
- Chart of Accounts
- Tax codes (VAT, SSCL, WHT, stamp duty)
- Payment terms
- Number series
- Approval workflows
- Opening balances (during onboarding window)

**Operations**
- Price lists
- Discount rules
- Payment methods
- Cheque books
- Petty cash floats
- Customer credit limit rules

**Documents**
- Invoice templates
- Quotation / PO / GRN templates
- Email templates (invoice, receipt, statement, reminder)
- SMS templates (Phase 2 marker visible)

**Integrations**
- Payment gateways (PayHere / FriMi / Genie / iPay / LankaQR)
- Bank file formats
- Attendance devices
- Biometric device registry

**Subscription**
- Current plan
- Billing history
- Payment method
- Upgrade / downgrade

**System**
- Audit log
- Notification preferences
- Data export
- Danger zone (pause / cancel / account deletion)

### 2.5 Admin access permissions
- **Owner** — full admin by default
- **Accountant** — no admin access by default; Owner explicitly grants financial admin permissions if desired
- **HR** — no admin access by default; Owner explicitly grants people-admin permissions if desired
- **Everyone else** — no admin access
- **Custom roles** — Owner creates scoped admin roles (e.g. *"Branch Manager – Kandy"* edits Kandy branch settings only)

This is stricter than most systems (auto-grant is more common) but safer for SL SME reality where Owner preferring tight control is the norm.

---

## 3. User Management

### 3.1 Users list view

**Columns**:
- Name
- Email / phone
- **Roles** shown as chips (e.g. *"Accountant · Cashier (Pettah) · HR"*)
- Branch scope summary (*"All branches"* or *"Pettah + Kandy"*)
- Last login
- Status (Active / Invited-pending / Suspended / Removed)
- Actions (Edit / Suspend / Remove / Reset password / Resend invite)

**Filters**: by role, by branch access, by status, by last-login age

**Bulk actions**:
- Bulk invite (paste emails, assign same role set)
- Bulk suspend
- Bulk role assignment (add role to N users)
- Export user list (CSV for audit)

**Search**: fuzzy match on name / email / phone

**Quick-add**: "+ Invite user" button prominent, opens invite flow

### 3.2 Invite user flow

**Steps**:
1. **Enter identity** — name + email (required). Phone optional (captured for contact, not invitation delivery).
2. **Assign roles** — tick one or more from preset + custom list
3. **Scope each role** — optionally scope to branches/warehouses per-role
4. **Send invite** — email OTP link; user sets password on first login
5. **Pending state** — auto-resend at 3 / 7 / 14 days; expire after 30 days

**WhatsApp invite deferred** — ships later when WhatsApp Business API integration is active.

**Bulk invite**: paste list of emails (one per line or CSV) + common role set + common scope.

**Invite tracking**:
- Who invited them + when
- When accepted
- First login timestamp

### 3.3 Role assignment UI

**User detail page** — chip-based visualization:

```
Ayesha Perera
owner@ayeshatextile.lk · +94 77 123 4567

Roles assigned:
┌──────────────────────────────────────┐
│ [Owner]       Scope: All branches    │
│ [Accountant]  Scope: All branches    │
│ [HR]          Scope: All branches    │
└──────────────────────────────────────┘
                      [+ Add another role]

[ See effective permissions ▸ ]
```

**For scoped roles**:

```
Nimal Silva
nimal.silva@ayeshatextile.lk

Roles assigned:
┌───────────────────────────────────────────────┐
│ [Cashier]       Scope: Pettah branch only     │
│ [Sales]         Scope: All branches           │
│ [Stock Keeper]  Scope: Pettah + Kandy whses   │
└───────────────────────────────────────────────┘
                      [+ Add another role]

[ See effective permissions ▸ ]
```

**Key UX elements**:
- Each role is a chip showing role name + scope summary
- Click chip → edit scope inline
- "+ Add another role" → dropdown of presets + custom roles
- **"See effective permissions"** panel expandable — shows resolved union grouped by module with source-role attribution (*"Can post invoices — granted by Cashier role"*)
- Remove role by clicking X on chip; warn if it's the only role

### 3.4 Roles & Permissions library

**Library list**:
- Name
- Type (Preset / Custom)
- Based on (for custom: *"cloned from Cashier"*)
- # of users assigned
- Last modified

**Preset roles** (from Layer 2 lock): Owner / Accountant / Cashier / Sales / Stock Keeper / Labour / HR / View-only

**Create custom role**:
1. Start blank OR clone existing (recommended)
2. Name + description
3. **Permission matrix** grouped by module, checkbox per granular action

**Permission matrix structure (example)**:

```
Module: Sell
  ☐ View invoices              ☐ Create invoice
  ☐ Edit draft invoice         ☐ Post invoice
  ☐ Void invoice               ☐ Apply discount (max X%)
  ☐ Create credit note         ☐ View profit margin per line
  ☐ Approve invoices >LKR X    ☐ Configure invoice template

Module: Inventory
  ☐ View stock on hand         ☐ Create GRN
  ☐ Create transfer            ☐ Approve transfer
  ☐ Stock adjustment           ☐ Approve adjustment
  ☐ Physical count             ☐ Configure reorder rules

... all modules

Module: Admin
  ☐ Invite users               ☐ Assign roles
  ☐ Edit Chart of Accounts     ☐ Edit tax codes
  ☐ Configure workflows        ☐ View audit log
  ☐ View subscription          ☐ Cancel subscription
```

**Easy Mode**: template-driven (*"Branch Manager"*, *"Junior Accountant"*, *"Inventory Supervisor"*) with sensible defaults; Owner tweaks differences.

**Advanced Mode**: full granular permission matrix.

### 3.5 Role change safety features

- **Audit trail** — every assignment / removal / scope change logged with who / when / from-value → to-value / optional reason
- **Impact preview before save** — *"This change will remove invoice-posting access for 12 users. Continue?"*
- **Cannot remove own Owner role** — at least one Owner always required
- **Cannot delete a role with active users** — must reassign users first
- **Dry-run preview** — show a user's permissions if a role change were applied, without saving
- **Privilege escalation warning** — granting sensitive permissions (cancel subscription, view all salaries) shows confirmation dialog
- **Scheduled role changes** — *"Promote Priya from Accountant to Owner effective Mar 1"*

---

## 4. Chart of Accounts Editor

### 4.1 View modes
**Tree view** (default)
- Hierarchical expand/collapse per account group
- Drag-drop to reorganize (with audit log + impact warnings)
- Color-coded by type (Assets / Liabilities / Equity / Income / Expense)
- Live balance per account (Advanced mode only — hidden in Easy mode for non-accountants)

**List view**
- Flat table with search + filter + sort
- Columns: Code, Name, Type, Parent, Status, Current balance, Actions
- Quick-edit inline for name / parent / code

### 4.2 Per-account actions
- Edit (name, code, parent, tax code default, narration)
- Merge into another account (irreversible; entries re-parented with confirmation)
- Deactivate (only if zero transactions in current + prior FY — from Accounting spec)
- View ledger (transaction list for this account)

### 4.3 Add new account
- **Minimum fields**: Name + Type + Parent
- **Optional**: code (auto-generated if blank with configurable pattern), opening balance, default tax code, narration
- **LLM-assist**: suggest parent based on name (*"You typed 'Office Supplies' — suggest parent: Expenses > Operating Expenses"*)

### 4.4 System-required accounts
- Displayed with 🔒 lock icon
- Cannot be deleted; rename allowed; code editable
- Tooltip: *"System account — required for tax/statutory reporting"*

### 4.5 Bulk operations
- Import COA via CSV / Excel (with LLM-assisted field mapping)
- Export COA for auditor review
- **Migration mode** — during onboarding, auto-map old COA (from BUSY / Tally export) to our structure

### 4.6 Search
Fuzzy match on code or name, instant results.

---

## 5. Tax Setup

### 5.1 Registration status section
- VAT registered? (yes/no) + VAT registration number
- SSCL applicable? (yes/no)
- WHT deductor? (yes/no)
- Stamp duty applicable?

### 5.2 Tax codes section (pre-populated with SL defaults)
- VAT 18%
- VAT 0% (zero-rated exports)
- VAT Exempt
- SSCL 2.5%
- WHT rates per payment category (rent 10%, professional services 5%, etc.)
- Stamp duty rates

### 5.3 Per tax code
- Name + rate
- Applies to (Sales / Purchases / Both)
- GL account mapping (Input VAT / Output VAT / etc.)
- Active / inactive toggle
- Effective dates (historical rates preserved when govt changes)

### 5.4 Custom tax codes
For unusual cases (product-specific duties, tourist-zone rates).

### 5.5 Rate change handling (from Super Admin push)
- Banner when platform pushes change: *"VAT rate changing from 18% to 15% effective Apr 1 — affects X upcoming invoices. Review ▸"*
- Tenant acknowledges
- Old rate preserved for historical transactions
- Tenant-level override allowed (rare — special industry concession)

### 5.6 Compound tax display
Visual showing how VAT + SSCL combine (SSCL on value, VAT on new total).

---

## 6. Branches & Warehouses

### 6.1 Branches screen
- List with: name, code, address, phone, tax branch registration (if separate), status
- Add / edit / deactivate
- **Per-branch config**: number series prefix, default warehouse, allowed tender methods (Pettah: cash + card + cheque; Galle: cash + cheque only), allowed payment gateways

### 6.2 Warehouses screen
- List with: name, code, address, type (main / godown / retail backroom / cold storage), linked branch(es), status
- Add / edit / deactivate
- **Per-warehouse config**: default valuation method (inherits from item category unless overridden), allowed operations (receive only / dispatch only / both)

### 6.3 Branch ↔ Warehouse mapping
**Matrix view** — branches as rows, warehouses as columns, checkboxes mark access.

**Per-cell flags**: Read / Write / Transfer permission.

**Visual templates** (one-click apply):
- **Tied** — auto-create 1:1 mapping (each branch → its own warehouse)
- **Central** — one warehouse serves all
- **Mixed** — manual configuration

**Preview**: *"With this mapping, Pettah branch can sell from Kandy warehouse"*

Save triggers audit log + notification to affected users.

### 6.4 Transfer rules
- Tenant sets default: auto-approve transfers under LKR X; require Owner approval above
- Ties into Inventory's 2-step dispatch/receive workflow

---

## 7. Approval Workflows Designer

### 7.1 Workflow list
**Default workflows shipped** (tenant enables/tweaks):
- Invoice approval (>LKR threshold → Owner)
- PO approval (>LKR threshold → Owner; new supplier first PO → Owner)
- Payroll run approval (always → Owner)
- Journal entry approval (>LKR threshold → Owner)
- Period reopening (always → Owner, no threshold override)
- Discount approval (>% threshold → Owner)
- Stock adjustment approval (>qty or >LKR threshold → Accountant)
- Write-off approval (>LKR threshold → Owner)
- Large cheque issuance (>LKR threshold → Owner)
- User role change (any → Owner)

Each workflow shows: trigger condition, threshold, approver, current state.

### 7.2 Workflow editor fields
- **Trigger** — event that kicks this off
- **Condition** — when approval required (amount, new supplier, specific customer, branch scope)
- **Approver** — specific user / any user with role X / multi-step chain
- **Escalation** — if not actioned within Y hours → escalate to Owner
- **Self-approval behavior** — skip if approver = actor? OR require different approver?
- **Notifications** — email + in-app to approver, reminder after N hours

### 7.3 Multi-step workflows
- Some approvals need a chain (e.g. PO → Manager → Owner for very high amounts)
- Visual builder with drag nodes representing approval steps
- Branching conditions (*"if total > LKR 500K, also require Finance sign-off"*)

### 7.4 Easy Mode templates
- *"Standard approvals"*, *"Strict controls"*, *"Relaxed"*
- Owner picks closest template, tweaks thresholds
- Preview before apply

### 7.5 Advanced Mode
Full workflow builder for complex scenarios.

---

## 8. Number Series Management

### 8.1 Series list
**Columns**:
- Document type (Invoice / Quote / SO / DN / Credit Note / PO / GRN / Bill / Debit Note / Journal / Receipt / Payment / Cheque / Payroll)
- Branch (or "All")
- Prefix format
- Current counter
- Reset frequency (annual / monthly / never)
- Last used number
- Actions (edit / preview next 5 / reset counter)

### 8.2 Editor
- **Prefix template** with variable insertion: `{{branch}}-{{doctype}}-{{YYYY}}-{{seq:6}}`
- **Live preview**: *"Next invoice number will be: PETTAH-INV-2026-000047"*
- **Mid-year change warning**: *"Changing prefix mid-year may cause audit confusion. Continue?"*
- **Gap handling** — configurable:
    - Allow gaps (voided numbers retained, audit-defensible)
    - No-gap (renumber on void)

### 8.3 Reset counter
Rare but sometimes needed (accountant consolidates series). Owner can reset with reason logged.

---

## 9. Integrations Hub

### 9.1 Card-grid layout grouped by category

**Payment gateways**: PayHere / FriMi / Genie / iPay / LankaQR
- Per card: logo, status (Connected / Not connected / Error), Configure/Connect button

**Bank file formats**: Commercial Bank / HNB / Sampath / BOC / People's / NDB / NSB + SLIPS batch
- Per card: status, configuration (account mapping for bulk payment file generation)

**Attendance & Biometric**: ZKTeco / eSSL / Generic CSV
- Per card: device registry, saved mappings, last import timestamp

**Email & SMS outbound**:
- Email provider — platform-managed default OR tenant's own SMTP (SendGrid, Mailgun, etc.)
- SMS gateway — SL providers (Text.lk, Dialog SMS, Mobitel API) — Phase 2 flag visible
- Per card: sender identity, verification status, daily send quota

**Deferred / Phase 2 visible (greyed out)**:
- WhatsApp Business API
- Courier APIs (Pronto / Domex / Aramex SL / Pick Me Flash)
- E-commerce channel sync (Shopify / WooCommerce / Daraz)
- Live CBSL exchange rate feed

### 9.2 Per-integration config
- Connection credentials (API keys / tokens — encrypted in DB)
- Mapping configuration (e.g. GL account for PayHere payouts)
- Test connection button
- Disable / reconnect actions
- Usage stats (transactions processed this month, errors last 30 days)

### 9.3 Security
- API keys masked after save (last 4 chars visible for identification)
- Rotate keys action
- Audit log on every integration change

---

## 10. Notification Preferences

### 10.1 Two-level model

**Tenant-level defaults** (set by Owner):
- Which events trigger notifications for all users by default
- Channels enabled at tenant level (email, in-app, SMS when available, WhatsApp Phase 2)
- Quiet hours (no notifications 10 PM – 6 AM SLST for non-critical)

**Per-user overrides** (each user configures own):
- Opt in/out of specific event categories
- Choose preferred channel per category

### 10.2 Event categories

| Category | Typical subscribers | Default cadence |
|---|---|---|
| Approvals needed (invoices, POs, payroll, journals, discounts) | Owner, Accountant | In-app + email (instant) |
| Payment received (from customer) | Owner, Accountant, Sales (for their customers) | In-app (instant) |
| Payment reminder due (to customer) | Owner, Accountant | Daily digest |
| Cheque returned / bounced | Owner, Accountant | In-app + email (instant) |
| Post-dated cheque maturing | Cashier, Accountant | Daily digest, day before |
| Low stock alert | Owner, Stock Keeper | Daily digest |
| Expiry alert (batch nearing expiry) | Owner, Stock Keeper | Weekly digest |
| Approval overdue (my pending approval >24h) | Approver | Email reminder |
| Customer over credit limit (attempted invoice) | Owner, Sales | Instant |
| Failed migration job | Owner | Instant |
| System maintenance notice | Everyone | In-app banner |
| Statutory filing deadline (VAT, EPF, PAYE) | Owner, Accountant | 7 / 3 / 1 days before |
| Subscription renewal / payment | Owner | 7 days before |
| New user invited | Owner | Instant |
| Role change on my account | Affected user | Instant |

### 10.3 Digest controls
- Daily digest time (tenant-configurable; default 8 AM SLST)
- Weekly digest day/time
- Urgent items bypass digest even if digest mode enabled

---

## 11. Audit Log Viewer

### 11.1 Main audit log screen
**Timeline view** — most recent first.

**Per-entry**:
- Timestamp
- User (with role context at time of action)
- Action + module + object (*"Invoice INV-2026-0047 voided"*)
- IP address
- Before/after values (for edits)

**Filters**: user, date range, module, action type, object type, IP, specific record.

**Search**: fuzzy match on object reference or narration.

**Export**: CSV / PDF for auditor.

### 11.2 Deep-link from transactions
Every invoice / bill / journal / etc. has *"View audit trail"* action → filtered view for that record only.

### 11.3 Special audit views
- **Admin changes log** — role changes, COA edits, tax code changes, workflow changes, integration changes
- **Login audit** — all logins with IP, device, location, success/failure
- **Impersonation audit** — every Super Admin impersonation (from Layer 1 consent-gated flow — tenant sees their side immediately)
- **Failed permission attempts** — user tried something they don't have permission for (security monitoring)
- **Data export audit** — every export request (who, when, scope)

### 11.4 Retention
- Audit log retained for entire tenant lifetime (never purged while active)
- Immutable — even Owner cannot edit/delete

### 11.5 Compliance export
Dedicated *"Audit period export"* — tenant generates ZIP for external auditor covering specific date range with all changes + supporting evidence.

---

## 12. Subscription Management (Tenant's View)

### 12.1 Overview section
- Current plan name + next renewal date
- What's included (feature list)
- Usage vs limits (users, invoices/month, storage — bars showing % used)
- Next invoice amount + date
- **Billing history** — our invoices to them (downloadable PDFs)
- Payment method on file (last 4 chars of card) + Update button

### 12.2 Plan change actions
- **Upgrade** — instant, prorated charge for rest of cycle
- **Downgrade** — takes effect on next renewal (not instant — prevents accidental data access loss)
- **Plan comparison** — side-by-side feature matrix
- **Contact sales** — for custom Enterprise plans

### 12.3 Pause / cancel
- **Pause subscription** — for seasonal tenants (keep data, stop billing). Only on certain plans.
- **Cancel subscription** — explicit flow with data retention info, export prompt, confirmation + reason capture (feedback loop to Super Admin's churn analytics)
- **Both require Owner-role user** — no delegation

### 12.4 Data export reminder
On cancel flow, prominently remind to export: *"Your data will be retained for 90 days after cancellation. Export now?"*

### 12.5 Payment failure transparency
- Top banner: *"Last payment failed. Update card to avoid suspension."*
- Grace period countdown visible
- Dunning transparency — tenant sees exactly where they are in retry sequence

---

## 13. Danger Zone

### 13.1 Layout
- Visually distinct (red accents, warning icons)
- Separated from normal admin to prevent accidents
- Each action requires typing confirmation text (e.g. *"DELETE MY ACCOUNT"*)

### 13.2 Actions

**Data export & delete**:
- Export all data (ZIP download)
- Delete specific historical data (rare — e.g. GDPR right-to-erasure for a specific customer record)

**Account state**:
- Pause subscription
- Cancel subscription
- **Close tenant permanently** — irreversible deletion after grace period

**Bulk destructive**:
- Bulk-delete draft transactions
- Clear all test data (only during onboarding trial)
- Reset tenant to fresh state (only during trial)

**Rarely-used**:
- Regenerate API keys (invalidates existing integrations)
- Force-logout all users
- Revoke all active sessions

### 13.3 Safeguards
- Typed confirmation required
- Owner role only
- All actions logged in audit trail
- Email notification to Owner's backup email (if set)
- **24-hour cooling-off period** on permanent deletion — *"Request queued; will execute tomorrow unless cancelled"*

---

## 14. Data Model — Tenant Admin UX Entities (Overview)

Most admin data is defined in other specs (Layer 2, Accounting, Inventory, etc.). This spec adds primarily:

```
Tenant
  ├── SetupCompletenessState (1:1 — tracks 10-item progress, dismissal state)
  ├── AdminActivityTile (1:n — attention-worthy items surfaced to admin homepage)
  ├── UserInviteToken (1:n — invite-pending state with expiry)
  ├── UserRoleAssignment (n:n — already in Layer 2, visible here)
  ├── PermissionMatrixOverride (1:n — for custom roles modifying preset)
  ├── WorkflowTemplate (1:n — shipped defaults + tenant customizations)
  ├── WorkflowStepNode (1:n — for multi-step chains)
  ├── NumberSeriesConfig (already in Inventory)
  ├── IntegrationConnection (1:n per category)
  │     ├── IntegrationCredentialStore (encrypted)
  │     └── IntegrationUsageLog (1:n)
  ├── NotificationPreferenceTenant (1:1 defaults)
  │     └── NotificationPreferenceUser (1:1 per user override)
  ├── NotificationDigestSchedule (1:n per user)
  ├── AuditLogEntry (1:n immutable)
  │     └── AuditLogExportSession (1:n compliance exports)
  ├── SubscriptionState (1:1 — current plan snapshot per tenant)
  ├── SubscriptionChangeRequest (1:n — upgrade/downgrade/pause/cancel)
  └── DangerZoneActionRequest (1:n with 24h cooling-off tracking)
```

All tenant-scoped via Postgres Row-Level Security.

---

## 15. SL-Specific Bakes

- **LKR-only currency** in all admin screens (pricing, thresholds, quotas)
- **EN / TA / SI** language toggle throughout admin UI
- **VAT / SSCL / WHT / PAYE** tax codes pre-loaded with SL defaults
- **SL bank file formats** pre-registered integration options
- **SL payment gateways** (PayHere / FriMi / Genie / iPay / LankaQR) prominent in integrations hub
- **Phone format** `+94 XX XXX XXXX` auto-format throughout
- **SL holiday calendar** affects digest delivery timing
- **SLST timezone** for all scheduling (digests, reminders, cooling-off)
- **Statutory filing deadlines** (VAT, EPF, PAYE, ETF) surface as notification categories with SL-specific dates

---

## 16. Deferred to Later Phases

- WhatsApp-based user invitations
- SMS-based OTP (currently email OTP only)
- WhatsApp / SMS notification channels for users
- Live CBSL exchange rate feed integration card
- Real-time bank API integrations
- Mobile-native admin app (responsive web sufficient)
- In-app video tutorials per admin screen
- AI-suggested workflow optimization
- Natural-language configuration (*"Make all invoices above 100K need owner approval"* parsed into workflow rules)
- Pre-built admin templates per SL industry (Textile / Pharmacy / Grocery / etc.) — currently uses signup-time industry template for COA only; broader template marketplace deferred

---

## 17. Next Steps

Candidate follow-ups:
1. **Migration flow IA** — BUSY / Tally / QuickBooks / Excel onboarding screens
2. **Pricing plan architecture** — Starter / Growth / Scale tier definitions + LKR pricing
3. **Data model deep dive** — full ERD with RLS policies
4. **Module-by-module UX mockups** — getting from specs to actual screen designs

---

*Document version: 1.0 · Module: Tenant Admin UX · Scope: Sri Lanka only · Full system (not MVP) · Owner: Automation Practice · Prepared for multi-tenant accounting SaaS (BUSY replacement)*

*Decisions consolidated across 4 rounds covering: hybrid admin model (inline + dedicated console), status-tile + menu-grid homepage, 10-item setup completeness score, 8-section sidebar navigation, Owner-only-by-default admin access with configurable delegation, full user list + invite flow (email OTP, WhatsApp deferred), chip-based multi-role assignment UI with effective-permissions panel, preset + custom roles with full granular permission matrix in Easy/Advanced modes, comprehensive role-change safety features, tree/list COA editor with LLM-assist and system-account locks, full tax setup with SL defaults and rate-change transparency, branches-warehouses matrix mapping with templates, approval workflow designer with multi-step chains and templates, number series management with live preview, integrations hub with per-card config and Phase-2 markers, two-level notification preferences with digest controls, comprehensive audit log viewer with special views and immutable retention, tenant-facing subscription management, danger zone with 24-hour cooling-off on permanent actions.*
