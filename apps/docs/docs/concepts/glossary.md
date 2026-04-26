---
title: Glossary
sidebar_position: 1
---

# Glossary

Terms used across PettahPro. The Sri Lankan tax acronyms are unavoidable if you're running books here — even the bookkeeping terms have one or two local quirks worth flagging.

## Sri Lankan tax & statutory

### VAT — Value Added Tax

Levied at **18%** on most taxable supplies (some categories are exempt or zero-rated). Registered persons issue **tax invoices** with VAT charged separately, and file the **VAT return** monthly or quarterly depending on turnover. PettahPro books VAT to **2100 VAT payable** on every taxable invoice and reverses it on credit notes.

### SSCL — Social Security Contribution Levy

A **2.5%** levy on turnover for businesses above the threshold, introduced October 2022. SSCL is **not** input-creditable — it sits on top of VAT as a real cost. PettahPro applies it as a separate line via the SSCL tax code where applicable.

### EPF — Employees' Provident Fund

Mandatory retirement fund. Contributions: **employee 8%**, **employer 12%**, totalling 20% of gross. Remitted monthly to the Central Bank's EPF department, with the schedule (Form C) filed alongside.

### ETF — Employees' Trust Fund

Employer-only contribution at **3%** of gross, on top of EPF. Remitted monthly to the ETF Board.

### PAYE — Pay As You Earn

Income tax deducted at source by the employer from employee salary. Brackets and exempt threshold are set in `payroll_settings.payeBrackets` and update with each annual budget. Remitted monthly to Inland Revenue.

### WHT — Withholding Tax

Income tax withheld at source on certain payments — typically **5%** on professional services and **10%** on rent and director fees. The payer files and remits; the recipient claims credit on their own return. PettahPro tracks WHT on supplier bills and produces the **Form WHT-T** at year-end.

### TIN — Taxpayer Identification Number

Issued by Inland Revenue. Required on every tax invoice for VAT-registered persons.

### BR / BRA — Business Registration / Business Registration Act

The certificate that registers a sole-proprietor or partnership with the Divisional Secretariat. Companies use the **Companies Act** number instead.

### Inland Revenue Department (IRD)

The tax authority. Returns are filed via the IRD e-Services portal. PettahPro produces the data; you file it.

## Accounting

### DR / CR — Debit / Credit

Every journal has at least one debit and one credit, equal in total. Convention:
- Assets and expenses go up on the **debit** side.
- Liabilities, equity, and income go up on the **credit** side.

If a journal isn't balanced, PettahPro refuses to post it.

### AR — Accounts Receivable

Money customers owe you. Booked when you post an invoice (`DR 1100 AR`); cleared when payment lands (`CR 1100 AR`). The **AR aging** report buckets unpaid invoices by days overdue.

### AP — Accounts Payable

Money you owe suppliers. Mirror of AR, on **2000 AP**. Booked when you post a bill; cleared when you pay.

### COGS — Cost of Goods Sold

The cost side of stock-tracked sales. When you sell a product, PettahPro books `DR 5000 COGS / CR 1200 Inventory` at the item's buy price, so gross margin shows up correctly on the P&L.

### GL — General Ledger

The complete list of journal lines for a period, by account. PettahPro's `/app/reports/gl` lets you drill from any account total back to the source documents.

### Trial balance

The list of every account's debit and credit totals. Should always balance. The report at `/app/reports/trial-balance` is the first thing an auditor opens.

### P&L — Profit & Loss

Income minus expenses for a period. Also called the **income statement**.

### Balance sheet

Assets = Liabilities + Equity, at a point in time. The **opening balance** module is what you use to load these into a fresh PettahPro tenant from your previous system.

### FY — Financial Year

Sri Lanka's standard FY runs **1 April → 31 March**. PettahPro's period structure follows this by default but is configurable per tenant.

### Period lock

A closed accounting period. Once locked, journals cannot post into it without unlock. Used to freeze a month or year after reconciliation. See [Period lock](../accounting/period-lock).

### Cost center

An optional dimension on each journal line — used to slice the P&L by department, branch, or project without creating separate accounts. Reports under `/app/reports/cost-centers`.

## Inventory

### SKU

Stock-keeping unit. PettahPro's **item code** is the SKU.

### GRN — Goods Received Note

The document that records stock arriving from a supplier. Books `DR 1200 Inventory / CR 2200 GRN clearing`; the bill clears the GRN clearing account when posted. See [GRNs](../buy/grns).

### Bundle / Kit

A virtual SKU made of components. Selling a bundle explodes into per-component stock issues at invoice post.

### Batch / Lot

A group of stock units sharing an expiry date or supplier batch number. Used for pharma, food, anything with a shelf life.

### Serial

A unique unit identifier — phone IMEIs, appliance serials. Each serial has a status (in stock / sold / returned).

## Documents & flow

### Quotation → Sales order → Delivery note → Invoice

The full sell-side document chain. Most SMEs skip the middle two and go straight from quote to invoice; PettahPro supports either.

### Credit note

The reverse of an invoice. Issued for returns, allowances, or correction of an error after the original invoice has been sent. Reduces AR and reverses the original VAT.

### Debit note

Supplier-side credit note — what you send a supplier when returning goods or claiming a credit against a bill.

### Proforma invoice

A non-posting "what-the-invoice-will-look-like" document, often required for advance payment or import paperwork. Doesn't touch the ledger.

### Three-way match

Reconciling **PO ↔ GRN ↔ bill**. The report at `/app/reports/three-way-match` flags bills that don't match a GRN or PO.

## Local payments

### LankaQR

Sri Lanka's national QR-code payment standard. PettahPro accepts LankaQR as a customer payment method.

### FriMi, Genie

Mobile wallet payment apps. First-class payment methods on the customer payment screen.

### Cheque

Still everywhere in SL business. PettahPro tracks cheque number, bank, and clearance date — and posts the bank entry only when the cheque clears, not when it's deposited.

## Platform

### Tenant

One company's data inside PettahPro. Every row in every table carries a `tenant_id`. Postgres **row-level security** ensures one tenant's session can never see another tenant's rows. See [Multi-tenant and RLS](./multi-tenant-and-rls).

### Realm

A login surface. PettahPro has three: **tenant** (`/app/*` — your staff), **portal** (`/portal/*` — your customers), **platform** (`/platform/*` — PettahPro operators).

### Plan / Add-on

What controls what your tenant can do. The plan caps users, transactions, modules; add-ons unlock specific features (e.g. multi-warehouse, payroll). Set on `/platform/tenants/<id>/plan`.
