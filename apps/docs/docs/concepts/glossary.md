---
title: Glossary
sidebar_position: 1
---

# Glossary

The terms used across PettahPro. The Sri Lankan tax acronyms are unavoidable if you're running books here, and a few of the bookkeeping terms have local quirks worth flagging.

## Sri Lankan tax & statutory

### VAT — Value Added Tax

A **18%** tax charged on most goods and services. If your business turnover is over the threshold you need to register for VAT, charge it on every sale, and file a VAT return monthly or quarterly. PettahPro keeps VAT separate from your sales income on every invoice so you can see what you've collected and what you owe Inland Revenue.

### SSCL — Social Security Contribution Levy

A **2.5%** levy on turnover, introduced in October 2022. Unlike VAT, you can't claim it back as input — it's a real cost on top of the sale. PettahPro applies it as a separate line where it's relevant.

### EPF — Employees' Provident Fund

The mandatory retirement fund. Each month, **8%** is deducted from the employee's salary and the **employer adds another 12%** — so a total of 20% of gross pay goes into the EPF account. PettahPro calculates this for every payroll run and produces the file you upload to the EPF e-portal.

### ETF — Employees' Trust Fund

An employer-only contribution at **3%** of gross salary, on top of EPF. Also calculated and remitted monthly.

### PAYE — Pay As You Earn

Income tax that you (the employer) deduct from your employee's salary and pay to Inland Revenue on their behalf. The brackets and exemption threshold change with each annual budget — PettahPro updates them when the budget changes them, so you don't have to.

### WHT — Withholding Tax

Tax that you withhold when paying for certain things — typically **5%** on professional services and **10%** on rent and director fees. The recipient claims credit for it on their own tax return. PettahPro tracks WHT on supplier bills and produces the year-end summary you need to file.

### TIN — Taxpayer Identification Number

Your Inland Revenue ID. You need to print it on every tax invoice if you're VAT-registered.

### BR / BRA — Business Registration

The certificate that registers a sole proprietor or partnership with the local Divisional Secretariat. Companies use the **Companies Act** number instead.

### IRD — Inland Revenue Department

The tax authority. You file VAT returns, PAYE summaries, and income tax through their e-Services portal. PettahPro produces the data; you submit it.

## Accounting terms

### DR / CR — Debit / Credit

Every transaction in your books has at least one debit and one credit, and they always balance. The convention:
- Asset and expense accounts go **up** when debited.
- Liability, equity, and income accounts go **up** when credited.

If the two sides don't balance, PettahPro won't let you save.

### AR — Accounts Receivable

Money your customers owe you. Goes up when you post an invoice; comes down when the customer pays. The **AR aging** report tells you who's overdue and by how long.

### AP — Accounts Payable

Money you owe your suppliers. The mirror image of AR. Goes up when you post a bill; comes down when you pay it.

### COGS — Cost of Goods Sold

The cost side of stock-tracked sales. When you sell a product, PettahPro records what that item cost you to buy, so your gross margin shows up properly on the P&L.

### General ledger (GL)

The complete, chronological list of every transaction by account. The GL report lets you click any total and drill back to the original document — useful when an auditor asks "where did this number come from?"

### Trial balance

The snapshot list of every account's debit and credit totals as of a chosen date. Always balances. Usually the first thing an auditor opens.

### P&L — Profit & Loss

Income minus expenses for a period. Also called the **income statement**. Tells you whether you made or lost money in the period.

### Balance sheet

A snapshot of what you own (assets), what you owe (liabilities), and what's left for the owners (equity), at a point in time. The **opening balance** module is what you use to load these from your previous system when you switch to PettahPro.

### FY — Financial Year

Sri Lanka's standard financial year runs **1 April → 31 March**. PettahPro defaults to this but you can change it for your business.

### Period lock

A closed accounting period. Once you close a month or year, no further transactions can post into it without unlocking it first. Used to "freeze" a period after you've reconciled everything.

### Cost centre

An optional tag you can put on each transaction line — used to slice your P&L by department, branch, or project without having to create separate accounts for each.

## Inventory terms

### SKU

Stock-keeping unit. PettahPro's **item code** is your SKU.

### GRN — Goods Received Note

The document that records stock arriving from a supplier. Increases your inventory; the supplier's bill clears it later when it's posted.

### Bundle / Kit

A package made of other items. Selling a bundle automatically reduces stock on each of the component items.

### Batch / Lot

A group of stock units that share an expiry date or supplier batch number. Used for things like medicines, food, or anything with a shelf life.

### Serial

A unique identifier on a single unit — phone IMEIs, appliance serial numbers, etc. PettahPro tracks each serial through its full life: in stock → sold → returned.

## Documents & flow

### Quotation → Sales order → Delivery note → Invoice

The full set of selling documents you might use for a single transaction. Most small businesses skip the middle two and go straight from quotation to invoice — that works fine in PettahPro.

### Credit note

The reverse of an invoice. You send one to a customer when they return goods, when you've over-charged them, or when you need to correct an error after the original invoice has gone out. It reduces what they owe you and reverses the VAT on the original.

### Debit note

The supplier-side equivalent — you send one to your supplier when you're returning goods or claiming a credit against a bill they've already sent.

### Proforma invoice

A "what the invoice will look like" document — useful for getting an advance payment, or for import paperwork. It doesn't post to your books; it's a quote in invoice format.

### Three-way match

Reconciling a purchase order, the GRN that records the stock arriving, and the bill from the supplier. PettahPro's report flags any bill that doesn't match a GRN or a PO — useful for catching duplicate billing.

## Local payment methods

### LankaQR

Sri Lanka's national QR-code payment standard. PettahPro accepts LankaQR as a payment method on customer payments.

### FriMi, Genie

Mobile wallet apps. Both are first-class methods on the customer payment screen.

### Cheque

Still widely used in Sri Lankan business. PettahPro tracks the cheque number, the bank, and the clearance date — and only counts the money in your bank when the cheque actually clears, not when it's deposited.
