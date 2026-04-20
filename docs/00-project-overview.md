# PettahPro — Project Overview

> Master index for the complete PettahPro specification set. Start here. This document explains what PettahPro is, catalogues all specifications, and recommends a reading order for different audiences.

---

## 1. What is PettahPro?

**PettahPro** is a cloud accounting and business operations platform for Sri Lankan SMEs, designed as a modern replacement for BUSY Accounting Software and Tally.

### 1.1 Positioning

| Attribute | Value |
|---|---|
| Market | Sri Lanka only (not global, not regional) |
| Audience | SL SMEs with 5-100 employees, LKR 10M-500M revenue |
| Primary industries | Wholesale/distribution, retail, pharmacy, restaurant, services, small manufacturing |
| Core wedge | 30-day assisted migration from BUSY/Tally with parallel-run |
| Price point | Matches BUSY year-one cost at Growth tier; value wins over 3 years |
| Differentiation | Cloud + mobile + AI-assisted + WhatsApp-ready + SL-native compliance |

### 1.2 Brand

| Element | Value |
|---|---|
| Name | PettahPro (one word, CamelCase) |
| Tagline | *"Accounting for how Sri Lanka actually does business"* |
| Palette | Charcoal `#1A1A1A` + Mint `#7FB89A` on off-white `#FAFAF9` |
| Typography | Inter 400/500 + Noto Sans Tamil/Sinhala fallbacks |
| Design philosophy | Flat, generous whitespace, 0.5px borders, 8-point grid |

See `brand-kit.md` for complete brand specification.

### 1.3 Technical stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, Inter typography, Lucide icons |
| Backend | Node.js + Postgres with Row-Level Security |
| Async / jobs | Redis + BullMQ |
| Search | Postgres trigram + GIN; Qdrant in Phase 2 |
| Storage | S3-compatible (AWS S3 ap-southeast-1) |
| OCR | Tesseract + OTR + OpenCV (CPU-only); Chandra OCR deferred to Phase 2 |
| Hosting | AWS Singapore region (ap-southeast-1) |
| Infrastructure | Row-level encryption via pgcrypto, cross-region DR replica, PgBouncer transaction mode |


---

## 2. Specification catalogue

**23 specifications** across 4 workstreams. Total: ~24,200 lines, ~115,000 words.

### 2.1 Product specs (10 files)

These describe what the product does from a user perspective.

| File | Purpose |
|---|---|
| `landing-page-design-spec.md` | Public-facing landing page architecture |
| `business-tenant-layer2-spec.md` | Per-tenant business owner's configuration and workspace |
| `super-admin-layer1-spec.md` | Platform operator's governance surface |
| `tenant-admin-ux-spec.md` | Tenant admin's daily management UX |
| `accounting-module-spec.md` | Accounting core — COA, journals, period close, tax returns |
| `sell-module-spec.md` | Sales workflow — quotations, orders, invoices, receipts, POS |
| `buy-module-spec.md` | Procurement — requisitions, POs, GRNs, bills, payments, 3-way matching |
| `inventory-module-spec.md` | Stock management — items, warehouses, movements, valuation |
| `payroll-module-spec.md` | Payroll — employees, salary, runs, statutory, leave, loans |
| `pricing-plan-architecture-spec.md` | Subscription plans, tiers, add-ons, coupons, billing |

### 2.2 Data model specs (8 files)

These describe the complete database architecture.

| File | Purpose |
|---|---|
| `data-model-01-foundation.md` | Multi-tenancy pattern, RLS, UUID v7, soft delete, audit columns |
| `data-model-02-identity.md` | Platform users, tenants, users, roles, sessions, MFA |
| `data-model-03-operations.md` | Branches, warehouses, customers, suppliers, items, stock ledger, pricing |
| `data-model-04-accounting.md` | COA, journal entries/lines, tax codes, fiscal periods, FX |
| `data-model-05-transactions.md` | Sell/buy documents, 3-way matching, cheques, approvals, numbering |
| `data-model-06-payroll.md` | Employees, salary structures, runs, payslips, statutory, leave, loans |
| `data-model-07-system.md` | Audit log, documents, notifications, workflows, integrations, billing |
| `data-model-08-performance.md` | Partitioning, materialized views, indexes, RLS templates, ERDs |

**Total**: 206 tables, ~10,500 lines of SQL DDL.

### 2.3 UI/UX specs (3 files)

These describe the design system and user experience.

| File | Purpose |
|---|---|
| `brand-kit.md` | Complete brand identity — positioning, voice, logo, colors, typography |
| `ui-system.md` | Design tokens, component library, layout patterns, accessibility |
| `ux-patterns.md` | IA, navigation, interaction patterns, microcopy, screen-by-journey specs |

### 2.4 Meta documents

| File | Purpose |
|---|---|
| `00-project-overview.md` | This document — index and reading guide |
| `glossary.md` | SL accounting and business terminology |


---

## 3. Reading orders by audience

Different team members should read different slices.

### 3.1 For a new engineer joining

1. `00-project-overview.md` (this file)
2. `glossary.md` — essential for SL terminology
3. `brand-kit.md` — understand what we're building
4. `data-model-01-foundation.md` — understand multi-tenancy pattern
5. `data-model-02-identity.md` — understand access control
6. Then the data model part relevant to their module
7. `ui-system.md` — design system reference
8. The product spec for their module

### 3.2 For a new designer joining

1. `00-project-overview.md` (this file)
2. `brand-kit.md` — complete brand identity
3. `ui-system.md` — design tokens and components
4. `ux-patterns.md` — interaction patterns and screen specs
5. `landing-page-design-spec.md` — marketing surface
6. `tenant-admin-ux-spec.md` — internal UX patterns

### 3.3 For a new PM joining

1. `00-project-overview.md` (this file)
2. `business-tenant-layer2-spec.md` — what tenants experience
3. `super-admin-layer1-spec.md` — what the platform team controls
4. `pricing-plan-architecture-spec.md` — commercial model
5. `ux-patterns.md` (section 5 — PettahPro-specific UX decisions)
6. The product spec for modules they own

### 3.4 For a new accountant / CA advisor

1. `00-project-overview.md` (this file)
2. `glossary.md`
3. `accounting-module-spec.md`
4. `sell-module-spec.md` and `buy-module-spec.md`
5. `payroll-module-spec.md`
6. Relevant data model parts (04, 05, 06)

### 3.5 For an investor / stakeholder

1. `00-project-overview.md` (this file)
2. `brand-kit.md` sections 1-2 (positioning, voice)
3. `pricing-plan-architecture-spec.md` (commercial model)
4. `landing-page-design-spec.md` (market narrative)
5. Skim `ux-patterns.md` section 5 for differentiation


---

## 4. Key architectural decisions

Locked-in decisions that all specs reflect.

### 4.1 Multi-tenancy

- **Pattern**: Shared schema + tenant_id column + Row-Level Security (Option C)
- **Defense in depth**: 6 layers — application filter + ORM scoping + RLS + connection-level + audit + automated security tests

### 4.2 Identity and access

- **Three governance layers**:
  - Layer 1: Super Admin (Platform Owner, PettahPro team)
  - Layer 2: Tenant owner / business administrator
  - Layer 3: Tenant users (accountants, cashiers, sales, HR, etc.)
- **Multi-role users**: additive union with per-role scoping
- **Privacy lock**: Super Admin sees platform operations + tenant metadata only. Never tenant business data. Consent-gated impersonation with quarterly transparency reports.

### 4.3 Data integrity

- **Primary keys**: UUID v7 (time-ordered, index-friendly)
- **Deletion**: Hybrid — soft for transactional/audit-significant, hard for ephemeral
- **Audit columns**: Standardized on all tables

### 4.4 Performance

- **Partitioning**: Two-level (hash by `tenant_id` × range by date) on high-volume tables
- **Materialized views**: For dashboards and aging reports
- **Read replicas**: Added in Phase 2

### 4.5 UX principles

- **Minimal-entry first**: Photo/scan/barcode is primary input method; manual entry is fallback
- **Easy/Advanced toggle**: Forms have two modes
- **Multi-role awareness**: UI reflects that users wear many hats
- **Offline-first POS**: Retail continues working without internet
- **Real SL data**: Example data uses realistic SL names, places, figures

### 4.6 Compliance

- **SL-native**: VAT, WHT, EPF, ETF, PAYE, SSCL, Stamp Duty built in
- **Cheque lifecycle**: 9-state model per SL Bounced Cheques Act
- **Statutory filings**: Auto-prepared
- **Regulatory updates**: Auto-roll to tenants when SL tax regulations change

---

## 5. What's NOT in these specs

### 5.1 Explicitly deferred to Phase 2

- **WhatsApp API integration** — sharing via WhatsApp is supported via web links in v1
- **Voice entry**
- **Chandra OCR** — deferred due to GPU cost + license constraints
- **Live bank feeds** — v1 uses bank statement upload
- **MICR cheque reading**
- **e-Invoicing (IRD)** — when IRD mandates it
- **Native mobile apps (iOS/Android)** — v1 is responsive web
- **Dark mode**
- **E-store integration** — WooCommerce/Shopify

Note: **Supplier portal** is built (Scale+ tier) but disabled by default; tenants opt in. Not deferred.

### 5.2 Not planned

- **Outside Sri Lanka** — this product is SL-only
- **Enterprise ERP replacement** — we don't target businesses >100 employees or >LKR 500M revenue
- **Personal finance** — we're B2B only
- **Cryptocurrency accounting**
- **White-label for resellers**

---

## 6. Next workstreams

### 6.1 High priority

1. **Migration flow IA** — the in-product experience of migrating from BUSY/Tally
2. **API specification** — OpenAPI 3.0 spec derived from data model

### 6.2 Medium priority

3. **Testing strategy** — QA plan covering unit, integration, E2E, load, and security tests
4. **Deployment & DevOps** — Infrastructure-as-code (Terraform), CI/CD, monitoring
5. **Rollout plan** — Phased launch, pilot tenant program, feedback loops

### 6.3 Later

6. **Industry-specific landing pages** — SEO-optimized variants
7. **Blog + content strategy** — editorial calendar
8. **Sales enablement** — pitch deck, case studies, ROI calculator
9. **Accountant partnership program**
10. **Post-launch roadmap** — Phase 2 prioritization

---

## 7. Working with this specification set

### 7.1 When specs conflict

If two specs contradict each other:
- Newer document version takes precedence (check footer version)
- Brand kit overrides older product specs for brand decisions
- UI system overrides older UI references
- UX patterns overrides older UX patterns
- Data model is canonical for database structure

### 7.2 When specs don't cover something

- Check the glossary for terminology
- Check adjacent specs
- Escalate to the product owner
- Document the new decision

### 7.3 Version control

All specs are markdown in Git. Each spec header includes document version and scope note.

---

## 8. Glossary

See `glossary.md` for SL-specific accounting, tax, and business terminology.

---

## 9. Contact and ownership

- **Product owner / founder**: Dushy
- **Primary market**: Sri Lanka
- **Business base**: Malaysia (Kuala Lumpur) / Sri Lanka
- **Hosting region**: AWS Singapore (ap-southeast-1)

---

*Document version: 1.0 · Project Overview · Scope: Sri Lanka only · PettahPro master index*
