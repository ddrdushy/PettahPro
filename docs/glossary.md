# PettahPro — Glossary

> Sri Lankan accounting, tax, business, and legal terminology used throughout the PettahPro specifications. Essential reference for team members not deeply familiar with SL business context.

---

## Table of Contents

1. [Tax terms](#1-tax-terms)
2. [Payroll and labour terms](#2-payroll-and-labour-terms)
3. [Banking and payment terms](#3-banking-and-payment-terms)
4. [Business entity and registration](#4-business-entity-and-registration)
5. [Accounting concepts](#5-accounting-concepts)
6. [Commerce and trade terms](#6-commerce-and-trade-terms)
7. [Geographic and cultural](#7-geographic-and-cultural)
8. [PettahPro-specific terms](#8-pettahpro-specific-terms)
9. [Technical terms in the codebase](#9-technical-terms-in-the-codebase)

---

## 1. Tax terms

### VAT — Value Added Tax
Sri Lanka's main consumption tax, administered by the IRD (Inland Revenue Department). Standard rate historically around 15-18%. Applied to most goods and services. Registered businesses above a turnover threshold must register for VAT, collect VAT from customers, and remit to IRD monthly or quarterly. Returns submitted via IRD's online portal. Invoice must clearly show VAT breakdown. In PettahPro, VAT handling is built-in, not bolted on.

### WHT — Withholding Tax
Tax withheld at source by a payer on payments made to a recipient. Common on professional fees (5%), rent (10%), interest, and certain business-to-business services. The payer deducts and remits to IRD; the recipient receives a certificate and claims credit against their income tax. PettahPro auto-applies WHT based on supplier type configuration.

### SSCL — Social Security Contribution Levy
A levy on certain goods and services, added separately from VAT. Rate around 2.5%. Applied at various points in the supply chain depending on product type. PettahPro supports SSCL calculation and reporting.

### Stamp Duty
Tax on specific documents (leases, mortgages, loan agreements, share transfers). Low rate but mandatory. Relevant for certain business transactions PettahPro may need to reference.

### IRD — Inland Revenue Department
Sri Lanka's tax authority. All VAT, WHT, income tax, and related filings go through IRD. IRD's online portal is where tenants submit returns prepared by PettahPro.

### TIN — Tax Identification Number
Each business registered with IRD gets a TIN. Required on invoices, tax returns, and statutory correspondence.

### PAYE — Pay As You Earn
Income tax deducted from employee salaries by the employer, remitted monthly to IRD via form T-10. Slabs change annually in the national budget. PettahPro payroll auto-calculates PAYE per current slab rates.

### Tax holiday / Strategic Development Project exemptions
Some businesses (BOI-registered, export-oriented, etc.) have tax exemptions. PettahPro must respect configuration flags for exempt entities.

---

## 2. Payroll and labour terms

### EPF — Employees' Provident Fund
Mandatory retirement savings scheme. Employer contributes 12% of employee's gross earnings; employee contributes 8%. Administered by the Central Bank. Monthly submission via EPF C-form. PettahPro auto-prepares C-forms and disbursement files.

### ETF — Employees' Trust Fund
Secondary statutory fund, employer-only contribution of 3% of gross earnings. Administered by ETF Board. Submission via ETF R-form monthly. PettahPro auto-prepares.

### Gratuity
Statutory end-of-service benefit. Per SL Gratuity Act, employees with 5+ years of service receive half month's basic wage × years of service upon termination (resignation, retirement, death). PettahPro accrues gratuity monthly and auto-calculates in final settlements.

### BRA — Budget Relief Allowance
Statutory allowance added to basic salary, set by national budget. Typically LKR 2,500-5,000/month. Changes annually. PettahPro handles BRA as a separate component.

### COLA — Cost of Living Allowance
Similar to BRA but tracking inflation. Also statutory.

### Basic salary
The contracted monthly salary before allowances. Used as the base for EPF, ETF, gratuity calculations.

### Gross earnings (for EPF/ETF)
Basic + BRA + COLA + fixed allowances. Statutory contributions calculated on gross.

### Take-home pay / Net salary
Gross earnings minus deductions (EPF employee 8%, PAYE, loans, advances). What the employee actually receives.

### LOP — Loss of Pay
Unpaid leave that reduces salary proportionally.

### Final settlement
Calculation performed when an employee exits. Includes: pro-rated salary, unused leave encashment, gratuity, EPF/ETF balances, notice pay, any outstanding loans. PettahPro has a dedicated final settlement module.

### Salary slip / Payslip
Monthly document given to employee showing earnings, deductions, net pay, YTD figures. PettahPro generates PDF, password-protected with last 4 of NIC.

### Labour Department
SL government body enforcing labour laws. Relevant for contract compliance, wage boards, minimum wage.

### Wages Board
Industry-specific wage council setting minimum wages for certain industries (e.g., garment workers, shop employees). PettahPro doesn't enforce Wages Board rates but tenants must ensure compliance.

### Notice period
Contractual period between resignation and exit. Typically 1 month for staff, 3 months for management. Pay in lieu of notice calculated in final settlement.

---

## 3. Banking and payment terms

### Cheque
Still widely used in SL business. Written promise to pay drawn on a bank account. PettahPro has first-class cheque lifecycle support due to their prevalence.

### Bounced cheque
A cheque that fails to clear due to insufficient funds, closed account, or other reasons. Per SL Bounced Cheques Act, bounced cheques carry legal consequences for the drawer. PettahPro tracks bounce events and legal actions.

### LankaQR
National QR code standard for merchant payments. Unified across banks. Any bank's app can scan any merchant's LankaQR code. PettahPro supports LankaQR in POS.

### PayHere
SL-based payment gateway (like Stripe). Popular for online payments. Supports cards, bank transfer, FriMi.

### FriMi
Digital wallet from Nations Trust Bank. Popular for P2P and small merchant payments.

### Genie
Digital wallet from Dialog. Similar positioning.

### iPay
Mobile payment platform.

### SLIPS — Sri Lanka Interbank Payment System
Batch disbursement system used by banks for salary payments, supplier payments. PettahPro exports SLIPS batch files for payroll disbursement.

### CEFT — Common Electronic Fund Transfer
Real-time interbank transfer system in SL. Fast transfers between banks.

### RTGS — Real-Time Gross Settlement
For large-value transfers (typically LKR 5M+). Same-day settlement.

### Commercial Bank, HNB, Sampath, BOC, People's, NDB, NSB
Major SL commercial banks. PettahPro supports each bank's disbursement file format for payroll.

### DFCC, Seylan, Union, Pan Asia, Cargills
Other commercial banks in SL.

### NFC — National Finance Company
One of the finance companies (non-bank lenders).

### Central Bank of Sri Lanka (CBSL)
Regulator for banking and finance. Not directly touched by PettahPro but sets rules that affect FX, interest rates.

---

## 4. Business entity and registration

### Sole proprietorship
Single-owner unincorporated business. Owner personally liable. Most Pettah wholesale shops are sole proprietorships.

### Partnership
Two or more partners. Partnership deed governs. Joint liability.

### (Pvt) Ltd — Private Limited Company
Incorporated under Companies Act. Limited liability. Most common structure for SL SMEs growing beyond sole-prop.

### PLC — Public Listed Company
Listed on Colombo Stock Exchange. PettahPro doesn't target PLCs.

### BOI — Board of Investment
Promotes foreign and export-oriented investment. BOI-registered companies get tax incentives. Some PettahPro tenants may be BOI-registered.

### Registrar of Companies
SL government body registering companies. Assigns company registration numbers.

### NIC — National Identity Card
SL citizens' ID number. Format: 199812345678 (new 12-digit) or 851234567V (old 10-character with V suffix). Essential for employee records and payslip passwords.

### Business Registration
Registration of a trading business with the local authority. Separate from company incorporation.

---

## 5. Accounting concepts

### Chart of Accounts (COA)
Hierarchical list of all accounts used by a business. Assets, Liabilities, Equity, Income, Expenses. PettahPro ships with SL-appropriate COA templates by industry.

### General Ledger (GL)
The master accounting record where all transactions post as journal entries.

### Journal entry
Double-entry record of a transaction — debit to one account, credit to another (or many). Always balances to zero.

### Posting
The act of finalizing a journal entry or transaction, making it part of the official ledger. Posted entries are immutable in PettahPro (can only be voided with a reversing entry).

### Period close
Monthly or annual process of finalizing accounts, preparing reports, and locking transactions. PettahPro has a dedicated period-close workflow.

### Trial balance
Report listing all account balances at a point in time. Debit total must equal credit total.

### P&L — Profit and Loss (Income Statement)
Report of revenue minus expenses over a period.

### Balance Sheet
Snapshot of assets, liabilities, and equity at a point in time.

### Cash flow statement
Report of cash movements (operating, investing, financing).

### Accruals
Expenses incurred but not yet paid, or revenue earned but not yet received. PettahPro handles accruals in period-end adjustments.

### Depreciation
Systematic allocation of a fixed asset's cost over its useful life.

### AR — Accounts Receivable
Money customers owe to the business.

### AP — Accounts Payable
Money the business owes to suppliers.

### Aging
Bucketing of AR or AP by how old the receivable/payable is. PettahPro uses four buckets: 0-30 days, 30-60, 60-90, and 90+ (matches the `customer_ar_summary` materialized view).

### Perpetual inventory
Stock tracked in real-time with each movement. PettahPro uses perpetual inventory (vs periodic).

### COGS — Cost of Goods Sold
Cost of inventory sold in a period. In perpetual inventory, COGS posts automatically with each sale.

### Valuation methods
FIFO (First In First Out), weighted average, LIFO (not allowed in SL). PettahPro supports FIFO and weighted average.

### Reorder point
Stock level at which a reorder is triggered.

### Petty Cash
Small cash float held at a branch or with a designated custodian for minor expenses (stationery, taxi, tea). PettahPro tracks floats, vouchers, replenishments, and custodian advance balances; ledger is immutable post-posting.

### Landed Cost
True cost of an imported or transferred item, including freight, insurance, duty, clearing, and handling — apportioned over the units received. PettahPro allocates landed cost at GRN time so inventory valuation reflects full landed cost, not just supplier price.

### Tag / Dimensional Accounting
Tenant-defined tags (project, department, cost center, campaign) attached to journal lines for slicing reports beyond the COA hierarchy. Configured via `tag_master`; applied on journal_entries and journal_lines.

### Fixed Assets
Long-lived tangible assets (buildings, vehicles, machinery, IT equipment). PettahPro maintains an asset register with categories, useful life, salvage value, location, custodian, and disposal events.

### Book vs Tax depreciation
Two parallel depreciation schedules on each fixed asset: **Book** (for financial reporting, typically SLM over useful life) and **Tax** (for IRD filings, per SL capital allowance rates — may use WDV or SOYD). PettahPro posts book depreciation monthly and computes tax depreciation separately at year-end.

### Bank Reconciliation
Matching bank statement entries against recorded receipts, payments, and journal entries to identify timing differences, missing transactions, and bank charges. v1 uses uploaded statements (CSV/PDF); live bank feeds are Phase 2.

### Bad Debt Relief (VAT)
Per SL VAT Act, VAT originally paid on a sale can be reclaimed if the receivable becomes uncollectible (typically >12 months overdue and formally written off). PettahPro tracks write-offs, prepares the relief claim, and reverses the relief if the debt is later recovered.

### Recurring Journal
Template that generates a journal entry on a schedule (monthly rent accrual, insurance amortization, depreciation run). Supports auto-post or draft-for-review modes.

### Standing Order
A bank instruction to make a fixed recurring payment (rent, subscription) on a schedule. PettahPro models these as recurring payments with expected cash outflow for forecasting.

---

## 6. Commerce and trade terms

### Wholesale
Selling to retailers or other businesses (B2B). Pettah is SL's wholesale heart.

### Retail
Selling to end consumers.

### Distributor
Intermediate layer — buys wholesale, sells to retailers.

### Consignment
Goods placed with a retailer to sell; ownership stays with supplier until sold.

### On account / credit sale
Invoice issued with payment terms (e.g., Net 30). Customer pays later. Very common in SL B2B.

### Credit limit
Maximum amount a business extends to a customer on credit.

### Credit hold
Status where a customer can't make new credit purchases until existing balance clears or limit increased.

### Aging customer
Customer with overdue invoices beyond normal payment terms.

### Trade discount
Discount offered in the trade (e.g., 10% off list price for wholesale buyers).

### Volume break
Quantity-based pricing (e.g., 1-9 units at LKR 100, 10+ at LKR 90).

### GRN — Goods Received Note
Document confirming receipt of goods against a Purchase Order.

### 3-way matching
Process of matching PO, GRN, and Bill before paying a supplier. PettahPro enforces this.

### Inter-branch transfer
Moving stock between a business's own branches.

### Proforma Invoice
Non-binding preliminary invoice issued before goods/services are delivered — used for quotations, import documentation, or advance payment requests. Does not post to AR or inventory and is not a tax invoice.

### Delivery Note (DN)
Document accompanying goods shipped to a customer, listing items and quantities. May or may not show prices. In SL B2B practice, the signed DN is the proof of delivery that supports the invoice.

### Credit Note
Document reducing a customer's receivable — issued for sales returns, price adjustments, or post-sale discounts. Reverses revenue, VAT output, and (for returns) restores inventory. Linked to the originating invoice.

### Debit Note
Document increasing a customer's receivable (or a supplier's payable from the buyer's side) — issued for under-billing, additional charges, or post-sale price increases. In SL practice, buyers also issue debit notes to suppliers for goods returned.

### Recurring Invoice
Customer-side template that auto-generates sales invoices on a schedule (subscriptions, rent, retainers). Supports fixed-amount and variable (usage/meter-read) modes.

### Recurring Purchase
Supplier-side template that auto-generates purchase orders, bills, or expense claims on a schedule (utilities, SaaS, cleaning contracts). Auto-post is restricted to fixed-amount mode; variable amounts require review.

### Consignment sale
Sale of consignment stock. Revenue recognized when the retailer sells to the end customer, not on transfer to the retailer. PettahPro tracks consigned stock separately from owned stock.

### Stock adjustment
Manual correction to on-hand quantity (damage, shrinkage, count variance). Posts to an inventory-adjustment expense/income account with a mandatory reason code.

### Stock transfer
Movement of stock between warehouses or branches. In-transit stock is tracked as a separate state until received at destination.

### Stock count (cycle count / physical count)
Periodic counting of on-hand stock to reconcile system quantity against physical. Variances post as stock adjustments. PettahPro supports rolling cycle counts and full year-end counts with count sheets and blind-count mode.

---

## 7. Geographic and cultural

### Pettah
Colombo's traditional wholesale district. Dense commercial area with thousands of wholesale shops — textiles, electronics, plastics, etc. The heart of SL's wholesale trade. The brand name "PettahPro" claims this territory.

### Colombo
SL's commercial capital. District 1-15 contain the business core. Many PettahPro tenants are based here.

### Kandy
Central hill capital, second-largest city. Significant retail and services market.

### Galle
Southern coastal city. Tourism-heavy economy.

### Jaffna
Northern capital, Tamil-majority. Distinct commercial culture.

### Negombo
West coast, strong wholesale/retail and seafood trade.

### Kurunegala, Anuradhapura, Ratnapura, Batticaloa, Trincomalee
Other regional commercial centers PettahPro targets.

### SLT — Sri Lanka Telecom
National telco. One of several SL connectivity providers.

### Dialog, Mobitel, Hutch, Airtel
Mobile carriers. Relevant for WhatsApp integration and SMS notifications.

### SLST — Sri Lanka Standard Time
Time zone: UTC+5:30.

### Avurudu (Sinhala/Tamil New Year)
Major cultural holiday in April. Business slows; bonuses typically paid. PettahPro supports Avurudu bonus as a payroll component.

### Vesak
Buddhist religious holiday in May. Public holiday.

### Poya days
Monthly full-moon days. Public holidays. PettahPro calendar respects these.

### Tamil, Sinhala, English
SL's three main languages. All three have some presence in SL business. PettahPro supports all three in customer-facing documents.

---

## 8. PettahPro-specific terms

### Tenant
A business subscribed to PettahPro. One tenant = one business.

### Layer 1 / Layer 2 / Layer 3
Governance layers. Layer 1 = Super Admin (PettahPro platform team). Layer 2 = Tenant owner/admin. Layer 3 = Tenant users (cashier, accountant, etc.).

### Super Admin
The platform operator's role. Has platform-level access (tenant metadata, system health, support) but cannot see tenant business data without consent.

### Tenant owner / Business owner
The person who signed up the business. Has full control within their tenant.

### Easy mode / Advanced mode
UX toggle on forms. Easy mode shows essentials; Advanced mode shows everything including accounting-specific fields.

### Minimal-entry principle
UX philosophy: photo/scan/barcode first, manual entry as fallback.

### Parallel run
Migration strategy where BUSY/Tally and PettahPro run side-by-side for 30 days to validate that books match before cutover.

### Assisted migration
Paid migration tier where PettahPro team handles the BUSY/Tally data extraction and import.

### Activation
First posted invoice (or bill, or payroll run). The trial metric that indicates product-market fit.

### Impersonation
Super Admin temporarily acting as a tenant user, with explicit consent. Time-bounded, audit-logged, included in transparency reports.

### Transparency report
Quarterly report sent to tenant owners listing all Super Admin access to their tenant during the quarter.

### Period lock
Soft-close of a fiscal period. Owner override possible but audit-logged.

### Approval workflow
Configurable multi-step approval for transactions (PO, bill, payment, leave) above thresholds or meeting conditions.

### Feature flag
Toggle to enable/disable features per tenant or globally. Used for phased rollout and enterprise customization.

---

## 9. Technical terms in the codebase

### RLS — Row-Level Security
Postgres feature that filters query results based on session context. Used to enforce tenant isolation at the database layer.

### UUID v7
Time-ordered UUID variant. Used for all primary keys in PettahPro. Benefits: sortable by creation time, index-friendly.

### Soft delete
Mark-as-deleted (via `deleted_at` timestamp) without physically removing the row. Used for audit-sensitive entities.

### Hard delete
Physical row deletion. Used for ephemeral data (session records, temp uploads).

### Audit log
Immutable table recording every state-changing action: who, what, when, before-value, after-value, reason.

### Materialized view
Pre-computed query result stored as a table. Used for dashboards and aging reports to avoid re-computation on every load.

### Hash partitioning
Splitting a table by hash of `tenant_id` to distribute load. PettahPro uses 16 hash buckets on high-volume tables.

### Range partitioning
Splitting a table by date range (monthly partitions) for time-series data.

### OCR — Optical Character Recognition
Extracting text from images. PettahPro uses Tesseract + OTR for v1, Chandra deferred to Phase 2.

### BullMQ
Redis-based job queue used for async work (OCR processing, email sending, report generation).

### Qdrant
Vector database for semantic search. Planned for Phase 2.

### PgBouncer
Postgres connection pooler. PettahPro uses transaction mode for RLS compatibility.

### ISR — Incremental Static Regeneration
Next.js feature that re-renders static pages on demand. Used for landing page CMS updates.

### WCAG 2.1 AA
Web accessibility standard. PettahPro's target compliance level.

### Lucide Icons
Icon library used throughout PettahPro. Open source, MIT licensed.

### Inter
Typography used throughout PettahPro. Google Fonts, open source.

---

*Document version: 1.0 · Glossary · Scope: Sri Lanka only · PettahPro terminology reference*
