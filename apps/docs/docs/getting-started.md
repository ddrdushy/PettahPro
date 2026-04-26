---
title: Getting started
sidebar_position: 2
---

# Getting started

The fastest way to learn PettahPro is to walk through one full sales cycle: customer → item → invoice → payment. By the end of this page (about 10 minutes) you'll have done it once, and the dashboards will start showing real numbers.

## Before you start

You need:

- A **PettahPro tenant**. If you signed up via the marketing site you already have one. If you're testing locally, create one through `pnpm dev` and the signup form at `http://localhost:3000/signup`.
- An **Owner** or **Admin** role on the tenant. The first user created at signup is the Owner — that's you.
- A **browser**. PettahPro is web-only; there's no desktop or mobile app yet.

If you'd rather poke around with sample data first, see [Demo data](./settings/overview.md) — there's a one-click button on Settings → Demo data that loads a realistic month of customers, items, invoices, and bills. You can clear it with the same one click.

## Step 1 — Land on the dashboard

Sign in. The dashboard at `/app` shows your books at a glance:

- **Cash position** — bank + cash balances across every account.
- **AR outstanding** — what customers owe you.
- **AP outstanding** — what you owe suppliers.
- **Revenue this month** — totals from posted invoices.

For a brand-new tenant, every card reads zero. That's expected. The dashboard also shows a **Get started** checklist with the steps below — it ticks each one off as you complete it.

## Step 2 — Review your chart of accounts

PettahPro seeds a Sri-Lanka-typical chart of accounts at signup. You'll usually want to look it over before posting your first transaction.

Visit `/app/coa`. Five sections:

- **Assets** (1000 series) — Cash, bank accounts, AR, inventory, fixed assets.
- **Liabilities** (2000 series) — AP, VAT payable, EPF/ETF/PAYE payable, salaries payable.
- **Equity** (3000 series) — Owner's equity, retained earnings.
- **Income** (4000 series) — Sales revenue, other income.
- **Expenses** (5000–6000 series) — COGS, salaries, rent, utilities.

You can:

- **Rename** anything ("Bank — primary" → "Sampath current account").
- **Deactivate** accounts you won't use (a hospitality business might not need "Inventory").
- **Add custom accounts** in any section.

What you **can't** do on system accounts is change the **code** or **type**. Modules look these up by code — 1010 must always be a bank account. Custom accounts have no such restriction.

## Step 3 — Add your first customer

Visit `/app/customers` → **+ New customer**.

Required:

- **Name** — what you'd write on an invoice.

Useful:

- **Email** — needed to send invoices and statements.
- **Payment terms (days)** — 30 is typical for B2B.
- **Credit limit** — soft block at invoice post if exceeded.
- **TIN / VAT no / BR no** — Sri Lankan tax identifiers; appear on the printed invoice if filled.

Save. The customer is now usable on invoices, quotations, recurring templates, statements, and the customer portal.

## Step 4 — Add your first item

Visit `/app/items` → **+ New item**.

PettahPro distinguishes three item types:

- **Product** — physical thing with stock and a unit cost. Tracked through the inventory ledger.
- **Service** — billable activity, no stock. Defaults to no-inventory-tracking.
- **Bundle** — a virtual SKU made up of components (e.g. "Welcome kit = pen + notebook + bag"). Selling a bundle explodes into per-component stock issues at invoice post.

Required:

- **Name** — appears on invoices.
- **Item type** — product / service / bundle.
- **Sell price** — default unit price on invoices (overridable per line).
- **Tax code** — usually `VAT18` for VAT-registered businesses.

Save. The item now shows up in the invoice line picker.

## Step 5 — Post your first invoice

Visit `/app/invoices/new`.

1. Pick the customer you just created.
2. Click **+ Add line**, pick the item, set the quantity. Unit price and tax code auto-fill from the item record.
3. Add more lines if needed.
4. Click **Save as draft** to keep it editable, or **Post** to commit it to the ledger.

Posting books the journal:

```
DR  1100 Accounts receivable      [total]
    CR  4000 Sales revenue        [subtotal]
    CR  2100 VAT payable          [tax]
```

If the item is stock-tracked, posting also relieves stock and books COGS:

```
DR  5000 Cost of goods sold       [item.buy_price × qty]
    CR  1200 Inventory            [same]
```

The invoice now shows on the dashboard's "Recent invoices" panel and on `/app/reports/ar-aging`.

## Step 6 — Record the payment

When the customer pays, visit `/app/payments/new`:

1. Pick the customer.
2. Pick the **method** — cash / cheque / bank transfer / LankaQR / FriMi / Genie / etc.
3. Pick the **bank or cash account** the money landed in.
4. Set the **amount**.
5. **Allocate** the payment against the invoice you posted (or pick "auto-allocate" to apply against the oldest open invoices).
6. Save.

Posting books:

```
DR  1010 Bank — primary           [amount]
    CR  1100 Accounts receivable  [amount]
```

Your invoice flips to **paid** (or **partially paid**), AR aging updates, cash position on the dashboard goes up.

## What's next

You've now done the full sales cycle. Common follow-ups:

- **Customise your invoice PDF** — upload a logo on Settings → Branding, optionally clone the [Classic invoice template](./settings/overview.md) and edit it.
- **Send the invoice** — the email-with-PDF flow is on the invoice detail page.
- **Add suppliers and bills** — same shape as customers and invoices, supplier-side. See [Buy](./settings/overview.md).
- **Set up payroll** — the [Payroll](./hr/payroll.md) module is the next biggest one.

If anything looked confusing, it's probably worth a doc fix — every page on this site has an **Edit this page** link in the footer.
