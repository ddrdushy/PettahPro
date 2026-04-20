# Super Admin (Layer 1) Design Spec — Multi-Tenant Accounting SaaS (Sri Lanka)

> Specification for the Platform Owner / Super Admin experience — the landlord view of every tenant on the platform. First of three governance layers (Platform / Tenant / Tenant Users). Target market: **Sri Lanka only**. Scope: **full system, not MVP**. Built around a hard privacy principle — Super Admin operates the *platform*, not the *businesses*.

---

## 1. Scope & Foundational Principles

### 1.1 The privacy lock — non-negotiable

**Super Admin operates the platform, not the businesses.**

| Super Admin CAN see | Super Admin CANNOT see |
|---|---|
| Tenant exists | Their invoices, bills, transactions |
| Tenant's plan + billing status with us | Their P&L, revenue, customer list |
| When they signed up, last login | Their inventory, stock levels, supplier names |
| Number of users, transactions/month (count only) | Transaction values, customer/supplier identities |
| Storage used, API calls used (technical metrics) | Account balances, ledger contents |
| Owner's contact info (registration data) | Their staff salaries, payroll details |
| Country, industry vertical (chosen on signup) | Cheque records, payment details |
| Support tickets they've filed | Their reports, dashboards, business intelligence |

**Aggregate counts only, never values.** *"Tenant X processed 47 invoices this month"* is fine. *"Tenant X did LKR 8.2M in sales"* is a privacy breach.

This privacy stance is foundational to platform trust in the SL market. SL business owners are deeply wary of "the cloud people seeing my numbers." If word gets out that the platform owner can browse anyone's books, the entire market is lost.

### 1.2 Two architectural principles flowing from privacy

**Need-to-know by default**
Super Admin defaults to seeing the *minimum* needed to operate the platform. Anything more requires explicit justification and is logged.

**Tenant-controlled visibility**
Where Super Admin must see something that touches tenant data (impersonation, migration data review, support escalation), the tenant Owner must explicitly consent in-app. Email notification alone is not sufficient.

### 1.3 Other foundational decisions
- **Multi-Super-Admin from day one** with role separation (built-in, not retrofitted)
- **No live bank API integrations** (data ingestion via uploads only)
- **SL-only market** (multi-country-ready data model; no current activation)
- **Singapore AWS hosting** with data sovereignty placeholder for future SL localization mandate
- **Mandatory 2FA** for all Super Admins (Authenticator app, not SMS)

---

## 2. Super Admin Home Dashboard

### 2.1 Hybrid layout (Option C)
Top row of KPIs (always visible) + operational queues below (action-oriented).

### 2.2 Top-row KPIs
- Total tenants (active + trial + suspended split)
- Active tenants today (logins past 24h)
- MRR / ARR with trend arrow vs prior month
- Churn rate (current month, % + count)
- New signups today
- Support tickets open (with priority breakdown)
- System health indicator (green/amber/red)

### 2.3 Operational queues (action-oriented)
- Failed payments awaiting dunning action
- Tenants stuck mid-migration (>7 days no progress)
- Support tickets escalated to Owner attention
- Security alerts (unusual access patterns, brute-force attempts)
- Billing disputes flagged
- Tenant churn risk warnings (health score declining)
- Pending plan-version migrations (grandfathered tenants due renewal)

---

## 3. Tenant Directory

### 3.1 Privacy-respecting columns
- Tenant name + business name
- Status (Trial / Active / Suspended / Past-due / Churned / Terminated)
- Plan with us
- Signup date
- Last active timestamp
- **MRR contribution** (their subscription to us — our revenue, fair to display)
- Country
- Industry vertical (signup-declared, not derived from data)
- Owner contact (registration data only)
- # of users (count only)
- # of transactions this month (**count only — no values, no breakdown by type**)

### 3.2 Excluded columns (privacy-locked)
- Their business worth / revenue
- Transaction values
- Customer/supplier counts (could imply business size)
- Anything inferring operational scale beyond signup-declared industry

### 3.3 Filters
- Status, plan, industry, signup date range, MRR bucket, last-active window, churn risk score, country/region

### 3.4 Per-tenant row actions
- Open tenant detail view
- Impersonate (consent-gated, see Section 5)
- Suspend / Reactivate
- Adjust subscription (credit, extend trial, change plan)
- Trigger data export (for support coordination)
- Send notification

### 3.5 Bulk actions
- Send broadcast message to filtered set (in-app banner / email)
- Bulk plan update (e.g. price change rollout)
- Bulk export (metadata only)

---

## 4. Tenant Detail View

Tabs in tenant detail (privacy-respecting):

### 4.1 Overview
Business name, signup date, plan, status, contacts. **No "company size" or "estimated revenue"** inferences.

### 4.2 Activity log
Login timestamps, milestones (e.g. *"first invoice posted"* — date only, not the invoice itself). No transaction-level activity.

### 4.3 Billing
Their subscription with us — our invoices to them, payment history, dunning status. Fully ours, no privacy issue.

### 4.4 Users
Count + role assignments + last-login dates per user. **User names anonymized as "Owner #1", "Accountant #1"** unless support contact required for active ticket.

### 4.5 Configuration snapshot
**REMOVED entirely.** Exposes business setup. If support needs to see configuration, that goes through impersonation with explicit ticket reference and tenant consent.

### 4.6 Usage stats
Counts only vs plan limits — invoices count, GRNs count, payslips count, storage MB used, API calls used. No values.

### 4.7 Support history
Tickets they filed, resolution times, satisfaction scores. Stays — they shared this voluntarily.

### 4.8 Migration status
For tenants currently migrating: source platform name, % complete, parallel-run health, assigned technician. High-level status only, no data being migrated.

### 4.9 Audit log
Every Super-Admin action taken on this tenant. Always visible — accountability.

### 4.10 Risk flags
**Re-scoped to platform abuse** — login from suspicious IP, account-sharing, ToS violations. NOT business-pattern analysis.

---

## 5. Impersonation — Log-First Support Model

### 5.1 The principle
Impersonation is the most privacy-invasive action we can take. It should be rare and tightly controlled.

### 5.2 Three-tier support escalation

**Tier 1 — Logs are usually enough (~80% of issues)**
- Tenant files support ticket
- Support team reviews:
    - Application error logs (technical, no business data)
    - User action logs (e.g. *"User clicked Save Invoice at 14:23, system returned 500 error"*)
    - Tenant audit log (their internal log, accessible to support with ticket reference)
- Most issues solved without ever seeing their data

**Tier 2 — Tenant shares context themselves**
- Tenant uploads screenshot, exports, or specific data via support ticket
- They control what we see
- Helps with: *"I can't figure out why this VAT calculation is wrong"* → tenant sends invoice screenshot

**Tier 3 — Impersonation (last resort, heavily controlled)**
- Only if Tier 1 + Tier 2 fail
- **Requires explicit tenant consent** — Owner must approve via in-app prompt before session starts (not just email — *consent-gated*)
- Time-bounded (default 30 min, max 2 hours)
- **Read-only by default**; write requires re-consent
- Visible banner during impersonation: *"You are viewing as Super Admin (impersonating Owner) — Ticket #1234"*
- Every action during impersonation logged in *both* tenant audit log AND Super Admin audit log
- Owner can terminate session anytime
- **Quarterly impersonation report** auto-emailed to Owner: *"In Q3, our support team accessed your account 2 times for tickets #1234 and #1567"*

---

## 6. Tenant Lifecycle States

### 6.1 States
- **Trial** — signed up, not yet paid
- **Trial-extending** — trial extended manually by Super Admin
- **Active** — paying customer
- **Past-due** — payment failed, in dunning sequence
- **Suspended** — access blocked due to non-payment or policy violation; data retained
- **Churned** — confirmed cancelled, data retained for 90 days
- **Terminated** — data deleted

### 6.2 State transitions
- Trial → Active: first successful payment
- Active → Past-due: payment fails on auto-renewal
- Past-due → Suspended: after N failed retries (typical 14–21 days)
- Suspended → Active: payment recovered
- Suspended → Churned: explicit cancellation OR no payment after grace period (60 days)
- Churned → Terminated: 90-day grace OR tenant request
- Reverse path: any state can return to Active with manual Super Admin action

### 6.3 Grace periods (configurable)
- Trial: 14–30 days default
- Past-due retry window: 14–21 days
- Churned data retention: 90 days
- Final deletion grace: 90 days (per Layer 2 exit ramps)

---

## 7. Subscription Plan Management

### 7.1 Plan attributes
- Plan name + description
- Monthly price (LKR)
- Annual price (LKR with discount %)
- **Module access** — which modules unlock at this plan (e.g. Starter = Sell + Buy + Inventory; Growth adds Payroll; Scale adds Manufacturing + E-store + API access)
- **Usage limits** — max users, max invoices/month, max GRNs/month, max payslips/month, max storage GB, max API calls/month
- **Feature toggles** (boolean) — multi-branch yes/no, custom report builder yes/no, supplier portal yes/no, etc.
- **Support tier** — email / email+chat / email+chat+phone / dedicated CSM
- **Trial duration** (days) per plan

### 7.2 Plan operations
- Create / edit / archive (archive ≠ delete; old tenants on archived plans grandfathered)
- **Plan versioning** — when Starter pricing changes from LKR 2K to LKR 2.5K, existing Starter tenants stay on old version until manual migration or renewal
- **Custom Enterprise plans** — bespoke per-tenant pricing and limits, created on-demand

---

## 8. Promotions & Coupons

### 8.1 Coupon engine
- **Code types**: % off / LKR off / first N months free / extended trial
- **Eligibility rules**: new signups only / specific plan / specific industry / specific country
- **Validity window**: start/end dates
- **Usage limits**: total uses / uses per tenant
- **Tracking**: code performance (signups attributed, revenue impact)

---

## 9. Billing Operations

### 9.1 Day-to-day actions
- **Failed payment dashboard** — who failed, why, retry attempts, dunning stage
- **Manual retry** — kick off retry for stuck tenant
- **Apply credit** — give tenant credit (compensation, goodwill); auto-applied to next invoice
- **Issue refund** — partial or full, reason captured
- **Extend trial** — give tenant N more days
- **Override pricing** — one-off discount for specific tenant for N months (e.g. 50% off 3 months retention deal)
- **Pause subscription** — for seasonal tenants
- **Reactivate** — bring suspended/cancelled tenant back

All actions logged + reason required + Super Admin audit trail.

---

## 10. Dunning Workflow

### 10.1 Configurable per plan
- Retry attempts (typical 3-4)
- Retry intervals (e.g. day 1, 3, 7, 14)
- Email cadence per retry
- In-app banner shown to tenant Owner
- Grace period before suspension (typical 14-21 days)
- Recovery action: tenant updates card → all retries cancelled, subscription resumes

### 10.2 Super Admin overrides
- Pause dunning for specific tenant (active negotiation)
- Skip retries → straight to suspension (suspected fraud)
- Manual recovery (tenant paid via bank transfer, mark as paid)

---

## 11. Revenue Analytics

### 11.1 Core metrics
- **MRR / ARR** — current value, growth trend, by plan, by industry
- **Churn rate** — monthly churn count + % + churned MRR, by plan
- **Trial conversion rate** — trial signups → paid %
- **LTV / CAC** ratio (when CAC data wired)
- **Revenue by plan** — MRR distribution across Starter/Growth/Scale
- **Revenue by industry** — which verticals are biggest
- **New signups** — daily/weekly/monthly trend
- **Cohort retention** — e.g. Jan-2026 signups: how many active 6 months later
- **Failed payment trend** — rising vs stable
- **Geographic breakdown** — by city/region within SL (Pettah / Kandy / Galle / Jaffna / Negombo etc.)

---

## 12. Platform-Level Configuration

### 12.1 Tax rules (with SL defaults pre-loaded)
- VAT rate (currently 18%) — central; govt change → update once → applies platform-wide
- SSCL rate (currently 2.5%)
- WHT rates per payment type (rent, professional services, contracts, etc.)
- Stamp duty rates
- PAYE slabs (with tenant override allowed)
- Effective dates per change (historical periods retain their rates)

### 12.2 Industry templates (seed data on tenant signup)
- Per industry: starter Chart of Accounts, default tax codes, sample invoice templates, default expense categories, default item categories
- Add new templates (e.g. *"Gem & Jewellery"*) over time
- Edit existing templates
- Changes affect new signups only; existing tenants on that industry not retroactively touched

### 12.3 Default tenant settings (pre-loaded)
- Default trial duration
- Default storage quota
- Default API rate limits
- Default invoice template
- Default email templates (welcome, billing, dunning, etc.)

### 12.4 Country settings (currently SL-only, multi-country-ready)
- Currency, date format, phone format, tax terminology
- Toggleable for additional countries later

### 12.5 System-wide constants
- Backup frequency, retention period
- Maintenance windows
- Feature flags (gradual rollout — enable feature for 10% of tenants first)

---

## 13. Landing Page CMS

### 13.1 Landing page sections (per Landing Page spec Section 4)
- Announcement bar (text, link, dates)
- Hero (headline, subhead, CTAs, image)
- Customer logos
- Stats counters
- Feature blocks
- Migration sources & tiers
- Pricing plans display
- Industry cards
- Testimonials
- Trust badges
- Payment gateway logos
- FAQ
- Footer links
- Translations (EN/TA/SI)

### 13.2 CMS workflow
- WYSIWYG editor or structured forms per object
- **Preview before publish** — staging URL before live
- **Scheduled publishing** — schedule a hero update for Avurudu launch date
- **Version history** — every published version saved, rollback supported
- **Multi-language editing** — toggle between EN/TA/SI tabs

### 13.3 Beyond landing page
- **Email templates library** — welcome, dunning, payment receipt, broadcast, etc. — same WYSIWYG + variable insertion + preview
- **Help center articles** — markdown editor with category structure
- **In-app announcements** — banner shown to tenants (*"New feature: Cheque module is live!"*) with targeting (all / specific plan / country / industry)
- **Changelog** — public release notes with auto-generated category structure

---

## 14. Support Operations Console

### 14.1 Ticket inbox
- Native or integration with Zendesk / Intercom / Freshdesk
- Tickets via in-app help button or email
- Auto-categorization (billing / bug / how-to / feature request / migration)
- Priority levels (critical / high / normal / low) with SLA tracking
- Assignment to support agents
- Internal notes (not visible to tenant)
- Public response thread

### 14.2 Per-ticket context (privacy-respecting)
- Tenant identity + plan + tenure (us-side metadata)
- Last 50 application errors for this tenant (technical logs, no business data)
- Recent platform-side events (login failures, payment retries, plan changes)
- This tenant's previous tickets + resolutions
- **NO direct view of tenant's business data** unless impersonation explicitly authorized (Section 5)

### 14.3 Knowledge base authoring
- Build/edit help articles (shared interface with public help center)
- Internal-only articles for support team (troubleshooting playbooks)

### 14.4 Bulk communication
- Broadcast email to filtered tenant set
- In-app banner targeting same filters
- SMS broadcast (Phase 2)

### 14.5 Tenant health monitoring
- Health score per tenant (login frequency, transaction count trend, support volume)
- At-risk tenants flagged for proactive Customer Success outreach
- Platform-side observability — not business intelligence

---

## 15. Infrastructure Monitoring

### 15.1 Real-time dashboard
- API uptime + response times per endpoint
- Database health (connections, query times, slow queries)
- Background job queue depth (BullMQ status — payroll runs, OCR jobs, report generation)
- Storage usage (S3 buckets per region)
- Error rates by service (auth / billing / OCR / accounting / etc.)
- Integration health (PayHere / Tesseract / SMS gateway status)

### 15.2 Alerts & incidents
- Configurable alert thresholds
- PagerDuty integration (on-call team)
- Incident timeline with notes during outage
- Post-incident reports (RCA documentation)

### 15.3 Maintenance modes
- Scheduled maintenance windows (with advance notice via in-app banner + email)
- Read-only mode (tenants view but can't write)
- Full maintenance mode (no login)

### 15.4 Audit & security
- Failed login attempts dashboard
- Unusual access patterns (login from new country, etc.)
- Super Admin action audit log (every action, immutable)
- Tenant data export requests log

---

## 16. Migration Operations

### 16.1 Job queue
- Active migrations: tenant, source platform, started date, % complete, current stage, technician assigned
- Stage breakdown: Source data uploaded → Field mapping → Validation → Trial run → Parallel-run active → Cutover complete
- Stuck/blocked migrations flagged
- Average migration time per source platform

### 16.2 Field mapping learning database (competitive moat)
- Every resolved field mapping saved (e.g. *"BUSY's 'Trade Receivables' → our 'Accounts Receivable'"*)
- Future migrations auto-suggest based on prior mappings
- This database compounds in value over time

### 16.3 Technician assignment
- For Assisted/White-glove tier customers, assign migration specialist
- Workload visibility — who's free, who's overloaded
- Customer contact log per migration

### 16.4 Parallel-run health monitoring (UiPath bot side)
- Bot status per tenant (running healthy / disconnected / errored)
- Sync queue depth (transactions waiting to sync from source to cloud)
- Reconciliation discrepancies flagged

### 16.5 Migration revenue tracking
- MRR from Assisted tier vs White-glove
- Conversion rate: migration leads → paying tenants

---

## 17. Multi-Super-Admin (Role-Based)

### 17.1 Sub-roles within Super Admin
| Role | Access |
|---|---|
| **Platform Owner** | Everything, including managing other Super Admins |
| **Finance Admin** | Billing ops, refunds, credits, plan management. Cannot impersonate or change platform code. |
| **Support Admin** | Support tickets, view tenant metadata, request impersonation (still consent-gated). Cannot change billing or plans. |
| **Marketing Admin** | Landing CMS, email templates, in-app announcements, coupons. Cannot see financial data or tenant lists. |
| **DevOps Admin** | Infrastructure monitoring, maintenance modes. Cannot see tenant data or billing. |
| **Custom roles** | Owner creates with granular permissions |

### 17.2 Common rules
- All actions logged in immutable Super Admin audit log regardless of sub-role
- Owner can revoke access instantly
- 2FA mandatory for all Super Admins

---

## 18. Data Sovereignty & Exports

### 18.1 Tenant-initiated export (Layer 2)
- Owner clicks "Export my data" → ZIP with CSVs + linked PDFs
- Self-service, no Super Admin involvement

### 18.2 Super Admin coordination role
- **Bulk export coordinator** — for large tenants (>1GB), trigger backend job + send link to Owner
- **Court-ordered exports** — fulfill within legal timeframe; every request logged
- **Account deletion** — execute final deletion after grace period; confirmation required

### 18.3 Data residency
- Hosting in Singapore AWS (locked); SL Data Protection Act currently allows
- **Geographic data flag** per tenant — placeholder for future SL data localization mandate
- Migration tooling ready to move tenants to SL-hosted infra if law changes

### 18.4 Audit
- Every export logged: who triggered, when, scope, delivery method, downloaded by IP

---

## 19. Security & Compliance

### 19.1 Super Admin authentication
- **Mandatory 2FA** (Authenticator app — not SMS, due to interception risk)
- Strong password policy
- Session timeout (default 30 min idle)
- Force logout on suspicious activity

### 19.2 Access controls
- IP allowlist optional per Super Admin
- Geographic restrictions (e.g. block logins outside SL/SG region)
- Audit log of all Super Admin logins (when, where from)

### 19.3 Compliance roadmap
- **SOC 2** — when revenue/scale justifies or enterprise customers demand
- **GDPR** — for EU-resident customers (rare in SL, but supported)
- **SL Data Protection Act 2022** — registration as data controller, breach notification within 72 hours
- **PCI-DSS** — never directly handle card data; offload entirely to PayHere / Stripe / similar

### 19.4 Security incident response
- Breach detection (automated + manual)
- Incident notification workflow per legal timeframe
- Forensics tooling (immutable audit logs)
- Post-incident reports

### 19.5 Vulnerability management
- Annual pen test (when scale justifies)
- Continuous vulnerability scanning (OWASP Top 10, dependency scanning)
- Bug bounty program (Phase 2)

---

## 20. Regulatory Update Workflow

### 20.1 Tax/regulatory change push
When SL govt changes a tax rule (e.g. VAT 18% → 15%, new WHT rate):

- **Draft** the change in admin (new rate, effective date)
- **Preview impact** — how many tenants affected, transactions in upcoming period
- **Schedule publish** — set effective date
- **Test on sandbox tenant** before production rollout
- **Gradual rollout** option — publish to 10% of tenants first, monitor, then full
- **Tenant notification** — auto-email to all tenant Owners
- **Historical preservation** — old transactions retain the rate they were posted at
- **Override per tenant** — rare but possible (some tenants on special tax arrangements)

---

## 21. Mobile / Responsive

### 21.1 Mobile scope
- Critical alerts (system down, payment fraud detected) need mobile access
- Tenant directory + ticket inbox useful on the go
- **Mobile-responsive web for read + critical actions; desktop required for complex configuration**
- No native admin app

### 21.2 Desktop-only operations
- CMS editing (WYSIWYG)
- Plan creation/editing
- Complex regulatory updates
- Bulk operations
- Custom report building

---

## 22. Data Model — Super Admin Entities (Overview)

```
Platform
  ├── SuperAdminUser (1:n)
  │     ├── SuperAdminRole (n:n — Platform Owner / Finance / Support / Marketing / DevOps / Custom)
  │     ├── SuperAdmin2FAConfig (1:1)
  │     └── SuperAdminAuditLog (1:n — every action immutable)
  ├── Tenant (1:n — external link to Layer 2 tenant_id)
  │     ├── TenantSubscription (1:n — current + history)
  │     ├── TenantBillingHistory (1:n — invoices, payments, credits)
  │     ├── TenantHealthScore (1:n daily snapshots)
  │     ├── TenantLifecycleEvent (1:n — state transitions)
  │     └── TenantUsageMetrics (1:n — counts only, no values)
  ├── Plan (1:n — versioned)
  │     ├── PlanVersion (1:n)
  │     └── PlanModuleAccess (n:n)
  ├── Coupon (1:n)
  │     └── CouponRedemption (1:n usage tracking)
  ├── DunningRule (1:n per plan)
  ├── ImpersonationSession (1:n — consent-gated, time-bounded)
  │     └── ImpersonationLog (1:n actions during session)
  ├── SupportTicket (1:n)
  │     └── TicketContext (technical logs, NO business data)
  ├── PlatformConfig
  │     ├── TaxRate (1:n historical with effective dates)
  │     ├── IndustryTemplate (1:n)
  │     ├── DefaultSettings (1:1)
  │     └── FeatureFlag (1:n)
  ├── LandingPageContent (1:n CMS objects)
  │     └── ContentVersion (1:n with publish history)
  ├── EmailTemplate (1:n)
  ├── HelpCenterArticle (1:n)
  ├── InAppAnnouncement (1:n with targeting rules)
  ├── MigrationJob (1:n)
  │     ├── MigrationStage (1:n stage transitions)
  │     ├── FieldMappingLearned (1:n competitive-moat database)
  │     └── ParallelRunHealthCheck (1:n bot status snapshots)
  ├── InfrastructureAlert (1:n)
  ├── SecurityIncident (1:n)
  ├── DataExportRequest (1:n with audit trail)
  └── RegulatoryUpdate (1:n with rollout tracking)
```

---

## 23. SL-Specific Bakes

- **VAT 18%** as platform default; updated centrally on govt change
- **SSCL 2.5%** baked in
- **WHT rates** per payment type, current SL schedule pre-loaded
- **PAYE slabs** current SL schedule pre-loaded
- **EPF 8%/12%, ETF 3%** statutory minimums
- **Fiscal year April–March** as default (configurable per tenant)
- **Industry templates** for SL verticals: Textile Wholesale, Pharmacy, Grocery, Clinic, Salon, Restaurant, General SME (plus future: Gem & Jewellery, Hardware, IT Services)
- **Hosting in Singapore AWS** with SL Data Protection Act compliance
- **Bank file format support** for major SL banks pre-loaded (Commercial, HNB, Sampath, BOC, People's, NDB, NSB)
- **Payment gateway integrations** — PayHere, FriMi, Genie, iPay, LankaQR
- **Tamil + Sinhala** language support with proper script rendering
- **SL holiday calendar** — Poya days, Avurudu, Christmas, Vesak, etc.

---

## 24. Deferred to Later Phases

- Native mobile app for Super Admin (responsive web sufficient)
- SOC 2 / ISO 27001 certification (when scale justifies)
- Bug bounty program
- Direct govt portal API filing (when SL govt opens reliable APIs)
- SMS broadcast in support (Phase 2)
- Live bank API integrations (when SL banks open reliable APIs)
- Multi-country activation (data model ready; activation deferred)
- AI-suggested support responses
- Real-time tenant health prediction with ML

---

## 25. Next Steps

Pass A (Super Admin / Layer 1) complete. Next:

1. **Tenant Admin (Layer 2 dashboard UX)** — admin's homepage, navigation, configuration screens, audit views, user management UX, integration setup
2. **Migration flow IA** — BUSY/Tally/QuickBooks/Excel onboarding screens
3. **Pricing plan architecture** — Starter / Growth / Scale tier definitions + LKR pricing
4. **Data model deep dive** — full ERD with RLS policies

---

*Document version: 1.0 · Layer: 1 (Super Admin / Platform Owner) · Scope: Sri Lanka only · Full system (not MVP) · Owner: Automation Practice · Prepared for multi-tenant accounting SaaS (BUSY replacement)*

*Decisions consolidated across 4 rounds covering: privacy-first principle (Super Admin operates platform, not businesses), hybrid dashboard layout, privacy-respecting tenant directory and detail view, log-first three-tier support model with consent-gated impersonation, full tenant lifecycle states, full plan management with versioning + grandfathering, full coupon/promotion engine, full billing operations with audit, configurable dunning workflow, full revenue analytics, platform-level configuration with SL defaults pre-loaded, full landing page CMS plus email templates and help center, full support operations console with privacy-safe context, infrastructure monitoring with PagerDuty integration and maintenance modes, full migration operations with field-mapping learning database as competitive moat, multi-Super-Admin with 5 sub-roles built from day one, data sovereignty with future SL-localization readiness, full security & compliance roadmap (2FA mandatory, SOC 2/GDPR/SL DPA roadmap, PCI-DSS via offload), regulatory update push workflow with gradual rollout, mobile-responsive for read + critical actions only.*
