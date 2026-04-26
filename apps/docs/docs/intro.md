---
slug: /
title: PettahPro documentation
sidebar_position: 1
---

# Welcome to PettahPro

PettahPro is a cloud accounting and business operations platform built for Sri Lankan small and medium businesses. It bundles the things you usually buy in five pieces — accounting, invoicing, inventory, payroll, customer portal — into one system, with the local statutory requirements (VAT, SSCL, EPF, ETF, PAYE, WHT) wired in from day one.

This site is the **product documentation**. If you're trying to figure out how to do something in the app, you should be able to find the answer here.

## Quick links

- **New here?** Start with [Getting started](./getting-started.md) — a 10-minute tour from signup to your first posted invoice.
- **Don't know what a term means?** The [glossary](./concepts/glossary.md) covers Sri Lankan tax acronyms (SSCL, EPF, ETF, PAYE, WHT) and accounting terms (DR/CR, AR/AP, FY).
- **Want to know how multi-tenant isolation works?** [Multi-tenant and RLS](./concepts/multi-tenant-and-rls.md).

## How the docs are organised

The sidebar mirrors the way the product is organised:

| Section | What it covers |
|---|---|
| **Concepts** | Cross-cutting ideas — tax codes, periods, tenancy, currencies. Read these once. |
| **Sell** | Customer-facing money in: invoices, quotations, sales orders, delivery notes, credit notes, recurring invoices, customer portal, POS. |
| **Buy** | Supplier-facing money out: bills, purchase orders, GRNs, supplier payments, debit notes, recurring bills, purchase requisitions. |
| **Inventory** | Items, stock counts, transfers, kits/bundles, batch + serial + expiry tracking. |
| **Accounting** | Chart of accounts, journal entries, period lock, cost centers, budgets, WHT, FX revaluation, petty cash, bank reconciliation, cheques, fixed assets, opening balance. |
| **HR & Payroll** | Employees, payroll runs, leave, staff loans, bonus runs, expense claims, attendance, final settlements. |
| **Reports** | Trial balance, P&L, balance sheet, GL, VAT return, cash flow, AR/AP aging, executive KPIs, trends, budget-vs-actual, three-way match. |
| **Settings** | Per-tenant configuration, branding, document templates, number series, notifications, approvals, roles, security, demo data. |
| **Platform admin** | The operator-side `/platform/*` console — tenant directory, impersonation, plans, add-ons, coupons, revenue, tenant health. |

## Page conventions

Every module page follows the same shape so you can scan a new one quickly:

1. **Overview** — one paragraph on what the module is and why it exists.
2. **Walkthrough** — the happy path, click by click.
3. **Common tasks** — short recipes for the things people actually need to do.
4. **Behind the scenes** — what posts where in the ledger, which tables get touched, what's enforced. Useful for accountants reviewing a system before they trust it.
5. **FAQ** — the questions that come up after the first week.
6. **Related modules** — links to the other features that connect in.

If you find a page that doesn't follow this shape, that's a bug — file an issue or open a PR. The docs live in the [PettahPro repo under `apps/docs/`](https://github.com/ddrdushy/PettahPro/tree/main/apps/docs).

:::note Sri Lanka first

PettahPro is built specifically for Sri Lankan businesses. That shows up in the docs as:

- **VAT 18%, SSCL 2.5%, WHT 5%/10%, EPF 8%/12%, ETF 3%, PAYE** as defaults — these are wired in, not configured.
- **LKR** as the ledger currency. Multi-currency is supported on documents but the ledger stays in LKR per Inland Revenue requirements.
- **Local payment methods** — Cheques, LankaQR, FriMi, Genie are first-class methods on customer payments.

If you're outside Sri Lanka, much of this still works, but the statutory defaults will need to be replaced.

:::
