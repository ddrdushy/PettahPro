# PettahPro

> *Accounting for how Sri Lanka actually does business.*

**PettahPro** is a cloud accounting and business-operations platform for Sri Lankan SMEs — a modern, mobile-friendly, AI-assisted replacement for BUSY Accounting Software and Tally, purpose-built for the Sri Lankan tax regime, banking rails, and business culture.

This repository holds the complete product specification (**23 specs**, ~24,200 lines, 206 database tables) and the working codebase scaffold (pnpm monorepo with Next.js web, Fastify API, BullMQ worker, Postgres with RLS, PgBouncer, Redis, MinIO — all running via `docker compose up`).

**Building?** See [SETUP.md](SETUP.md) for dev environment instructions.

---

## Table of contents

- [At a glance](#at-a-glance)
- [What PettahPro is](#what-pettahpro-is)
- [Tech stack](#tech-stack)
- [Specification index](#specification-index)
- [Reading orders](#reading-orders)
- [Key architectural decisions](#key-architectural-decisions)
- [What's in · What's not](#whats-in--whats-not)
- [Working with this repo](#working-with-this-repo)
- [Ownership](#ownership)

---

## At a glance

| Attribute | Value |
|---|---|
| Market | Sri Lanka only |
| Audience | SL SMEs · 5-100 employees · LKR 10M-500M revenue |
| Primary industries | Wholesale, retail, pharmacy, restaurant, services, light manufacturing |
| Core wedge | 30-day assisted parallel-run migration from BUSY / Tally |
| Price point | Matches BUSY year-one cost at Growth tier; wins on 3-year TCO |
| Differentiation | Cloud + mobile + AI-assisted + WhatsApp-ready + SL-native compliance |
| Brand | Charcoal `#1A1A1A` + Mint `#7FB89A` on off-white `#FAFAF9` · Inter + Noto Sans Tamil/Sinhala |

---

## What PettahPro is

A full business operating system for a Sri Lankan SME, covering:

- **Accounting core** — COA, journals, fiscal periods, tax returns, period close, multi-currency, fixed assets, bank reconciliation, budgets, bad-debt relief.
- **Sell** — quotations, orders, invoices, POS (online; offline mode planned), receipts, credit notes, recurring invoices, commission schemes.
- **Buy** — requisitions, POs, GRNs, bills, 3-way matching, payments, recurring purchases, petty cash. (Supplier portal spec'd, not yet built.)
- **Inventory** — items, warehouses, stock ledger, perpetual valuation (FIFO / weighted average), stock counts, transfers, adjustments, landed cost.
- **Payroll** — employees, salary structures, monthly runs, payslips, EPF / ETF / PAYE, leave, loans, final settlement, attendance devices, commission earnings.
- **Compliance** — VAT, SSCL, WHT, PAYE, EPF, ETF, Stamp Duty, 9-state cheque lifecycle per SL Bounced Cheques Act, auto-prepared statutory filings, regulatory auto-updates.
- **Platform** — three-layer governance (Super Admin · Tenant Owner · Tenant User), RLS multi-tenancy, audit log, workflows, integrations, subscription billing.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js · Inter typography · Lucide icons |
| Backend | Node.js + Postgres with Row-Level Security |
| Async / jobs | Redis + BullMQ |
| Search | Postgres trigram + GIN (v1) · Qdrant (Phase 2) |
| Storage | S3-compatible (MinIO in dev, AWS S3 in prod) |
| OCR | Planned for Phase 2 (Tesseract + OTR + OpenCV CPU-only baseline; Chandra OCR later) — not yet implemented |
| Hosting | AWS Singapore (ap-southeast-1) |
| Connection pooling | PgBouncer (transaction mode — required for RLS) |
| Encryption | Row-level via `pgcrypto` |
| DR | Cross-region Postgres read replica |

**Architecture style:** modular monolith (not microservices) organized by bounded context — accounting, sell, buy, inventory, payroll, identity, billing. Hexagonal (ports & adapters) per module. Domain events in-process, synchronous for posting-critical effects, async via BullMQ for side effects. Outbox pattern for external integrations.

---

## Specification index

### Product specs

| Spec | Purpose |
|---|---|
| [Landing Page Design](docs/landing-page-design-spec.md) | Public marketing surface |
| [Business Tenant (Layer 2)](docs/business-tenant-layer2-spec.md) | Per-tenant owner's workspace |
| [Super Admin (Layer 1)](docs/super-admin-layer1-spec.md) | Platform operator's governance surface |
| [Tenant Admin UX](docs/tenant-admin-ux-spec.md) | Tenant admin's daily management UX |
| [Accounting Module](docs/accounting-module-spec.md) | COA, journals, period close, tax returns |
| [Sell Module](docs/sell-module-spec.md) | Quotations, orders, invoices, receipts, POS |
| [Buy Module](docs/buy-module-spec.md) | Requisitions, POs, GRNs, bills, payments, 3-way matching |
| [Inventory Module](docs/inventory-module-spec.md) | Items, warehouses, movements, valuation |
| [Payroll Module](docs/payroll-module-spec.md) | Employees, salary, runs, statutory, leave, loans |
| [Pricing Plan Architecture](docs/pricing-plan-architecture-spec.md) | Subscription tiers, add-ons, coupons, billing |

### Data model (~10,500 lines of SQL DDL, 206 tables)

| Part | Purpose |
|---|---|
| [01 · Foundation](docs/data-model-01-foundation.md) | Multi-tenancy, RLS, UUID v7, soft delete, audit columns |
| [02 · Identity](docs/data-model-02-identity.md) | Platform users, tenants, users, roles, sessions, MFA |
| [03 · Operations](docs/data-model-03-operations.md) | Branches, warehouses, customers, suppliers, items, stock ledger, pricing |
| [04 · Accounting](docs/data-model-04-accounting.md) | COA, journal entries/lines, tax codes, fiscal periods, FX, fixed assets, budgets, bank rec |
| [05 · Transactions](docs/data-model-05-transactions.md) | Sell/buy documents, 3-way matching, cheques, approvals, numbering, petty cash |
| [06 · Payroll](docs/data-model-06-payroll.md) | Employees, salary structures, runs, payslips, statutory, leave, loans, commissions, attendance |
| [07 · System](docs/data-model-07-system.md) | Audit log, documents, notifications, workflows, integrations, billing |
| [08 · Performance](docs/data-model-08-performance.md) | Partitioning, materialized views, indexes, RLS templates, ERDs |

### UI / UX

| Spec | Purpose |
|---|---|
| [Brand Kit](docs/brand-kit.md) | Positioning, voice, logo, colors, typography |
| [UI System](docs/ui-system.md) | Design tokens, component library, layout, accessibility |
| [UX Patterns](docs/ux-patterns.md) | IA, navigation, interaction patterns, microcopy, journeys |

### Meta

| Spec | Purpose |
|---|---|
| [Project Overview](docs/00-project-overview.md) | Master index · reading guide · architectural decisions |
| [Glossary](docs/glossary.md) | SL accounting, tax, banking, business terminology |

---

## Reading orders

### New engineer
1. [Project Overview](docs/00-project-overview.md)
2. [Glossary](docs/glossary.md) — essential for SL terminology
3. [Brand Kit](docs/brand-kit.md)
4. [Data Model 01 · Foundation](docs/data-model-01-foundation.md)
5. [Data Model 02 · Identity](docs/data-model-02-identity.md)
6. The data model part relevant to your module
7. [UI System](docs/ui-system.md)
8. The product spec for your module

### New designer
1. [Project Overview](docs/00-project-overview.md)
2. [Brand Kit](docs/brand-kit.md)
3. [UI System](docs/ui-system.md)
4. [UX Patterns](docs/ux-patterns.md)
5. [Landing Page Design](docs/landing-page-design-spec.md)
6. [Tenant Admin UX](docs/tenant-admin-ux-spec.md)

### New PM
1. [Project Overview](docs/00-project-overview.md)
2. [Business Tenant (Layer 2)](docs/business-tenant-layer2-spec.md)
3. [Super Admin (Layer 1)](docs/super-admin-layer1-spec.md)
4. [Pricing Plan Architecture](docs/pricing-plan-architecture-spec.md)
5. [UX Patterns § 5](docs/ux-patterns.md)
6. The product spec for modules you own

### New accountant / CA advisor
1. [Project Overview](docs/00-project-overview.md)
2. [Glossary](docs/glossary.md)
3. [Accounting Module](docs/accounting-module-spec.md)
4. [Sell Module](docs/sell-module-spec.md) and [Buy Module](docs/buy-module-spec.md)
5. [Payroll Module](docs/payroll-module-spec.md)
6. Data model parts [04](docs/data-model-04-accounting.md), [05](docs/data-model-05-transactions.md), [06](docs/data-model-06-payroll.md)

### Investor / stakeholder
1. [Project Overview](docs/00-project-overview.md)
2. [Brand Kit § 1-2](docs/brand-kit.md) — positioning, voice
3. [Pricing Plan Architecture](docs/pricing-plan-architecture-spec.md)
4. [Landing Page Design](docs/landing-page-design-spec.md)
5. Skim [UX Patterns § 5](docs/ux-patterns.md) for differentiation

---

## Key architectural decisions

| Area | Decision |
|---|---|
| Multi-tenancy | Shared schema + `tenant_id` + Row-Level Security · defense-in-depth across 6 layers |
| Identity | 3 governance layers · multi-role users · consent-gated impersonation with quarterly transparency reports |
| Primary keys | UUID v7 (time-ordered, index-friendly) |
| Deletion | Hybrid — soft for transactional, hard for ephemeral |
| Partitioning | Two-level: hash by `tenant_id` × range by date on high-volume tables |
| Materialized views | Dashboards, aging reports |
| UX | Minimal-entry first (photo / scan / barcode) · Easy / Advanced toggle · real SL data (offline POS planned for Phase 2) |
| Compliance | SL-native: VAT, WHT, EPF, ETF, PAYE, SSCL, Stamp Duty, 9-state cheque lifecycle, auto-prepared filings, regulatory auto-updates |

---

## What's in · What's not

### Explicitly deferred to Phase 2
WhatsApp API integration · voice entry · OCR (Tesseract baseline + Chandra later) · live bank feeds · MICR cheque reading · e-Invoicing (IRD) · native mobile apps · offline POS · dark mode · e-store integration · supplier portal (spec'd, plan-flagged, no app surface yet).

### Not planned
Outside Sri Lanka · Enterprise ERP (>100 employees) · personal finance · cryptocurrency · white-label.

---

## Working with this repo

### When specs conflict
1. Newer document version wins (check footer)
2. Brand Kit overrides older product specs for brand decisions
3. UI System overrides older UI references
4. UX Patterns overrides older UX patterns
5. Data Model is canonical for database structure

### When specs don't cover something
Check the glossary · check adjacent specs · escalate to the product owner · document the decision.

### Versioning
All specs are markdown in Git. Each spec header includes document version and scope note.

---

## Ownership

| | |
|---|---|
| **Product owner / founder** | Dushy |
| **Primary market** | Sri Lanka |
| **Business base** | Kuala Lumpur, Malaysia / Sri Lanka |
| **Hosting region** | AWS Singapore (ap-southeast-1) |

---

*Document version: 1.0 · PettahPro master README · Scope: Sri Lanka only*
