---
title: Getting started
sidebar_position: 2
---

# Getting started

The fastest way to learn PettahPro is to walk through one full sales cycle: customer → item → invoice → payment. By the end of this page (about 10 minutes) you'll have done it once, and your dashboard will start showing real numbers.

## Before you start

You need:

- A **PettahPro account**. If you signed up via the website you already have one.
- An **Owner** or **Admin** role on the account. The first person to sign up is the Owner — that's you.
- A **web browser**. PettahPro is web-only at the moment; there's no desktop or mobile app yet.

If you'd rather poke around with sample data first, head to **Settings → Demo data** and click the load button. It loads a realistic month of customers, items, invoices, and bills so you can see what the dashboards look like with content. The same screen has a one-click button to clear it again.

## Step 1 — Land on the dashboard

Sign in. The dashboard is the first thing you see, and it shows your books at a glance:

- **Cash position** — how much you've got across your bank and cash accounts.
- **AR outstanding** — what your customers owe you.
- **AP outstanding** — what you owe your suppliers.
- **Revenue this month** — sales totals from invoices you've posted.

For a brand-new account, every card reads zero. That's fine — the dashboard also shows a **Get started** checklist with the steps below, and ticks each one off as you complete it.

## Step 2 — Review your chart of accounts

PettahPro starts you off with a standard Sri Lankan chart of accounts. Most people want to glance through it before posting their first transaction.

Open **Accounting → Chart of accounts**. You'll see five sections:

- **Assets** — your cash, bank accounts, money customers owe you, inventory, fixed assets.
- **Liabilities** — money you owe (suppliers, VAT, EPF/ETF/PAYE, salaries).
- **Equity** — owner's equity, retained earnings.
- **Income** — sales revenue, other income.
- **Expenses** — cost of goods sold, salaries, rent, utilities.

You can:

- **Rename** anything (e.g. change "Bank — primary" to "Sampath current account").
- **Hide** accounts you won't use (a hospitality business probably doesn't need "Inventory").
- **Add custom accounts** anywhere you need to.

For the standard accounts, you can rename and hide but not change their accounting type — modules rely on knowing what each one is. Custom accounts you add yourself have no such restriction.

## Step 3 — Add your first customer

Go to **Sell → Customers** → **+ New customer**.

You only need to fill in:

- **Name** — exactly what you want to appear on the invoice.

These are useful but optional:

- **Email** — needed if you want to email invoices and statements from PettahPro.
- **Payment terms (days)** — how long the customer has to pay. 30 days is typical for B2B.
- **Credit limit** — if set, you'll be warned when posting an invoice that would push them over the limit.
- **TIN / VAT no / BR no** — Sri Lankan tax identifiers; they print on the invoice if you fill them in.

Save. The customer is now selectable on every customer-facing screen — invoices, quotations, statements, and the customer portal.

## Step 4 — Add your first item

Go to **Inventory → Items** → **+ New item**.

PettahPro has three kinds of items:

- **Product** — a physical thing with stock and a unit cost. Tracked through inventory.
- **Service** — billable work, no stock involved (consulting hours, installation, etc.).
- **Bundle** — a package made of other items (e.g. "Welcome kit = pen + notebook + bag"). Selling a bundle automatically reduces stock on each component.

Fill in:

- **Name** — what appears on the invoice.
- **Item type** — product / service / bundle.
- **Sell price** — the default unit price (you can override it on individual invoices).
- **Tax code** — usually `VAT18` if you're VAT-registered.

Save. The item now shows up when you search on an invoice line.

## Step 5 — Post your first invoice

Go to **Sell → Invoices → + New invoice**.

1. Pick the customer you just created.
2. Click **+ Add line**, search for the item, set the quantity. Unit price and tax fill in from the item record.
3. Add more lines if you need to.
4. Click **Save as draft** to keep it editable, or **Post** to commit it to your books.

When you post, PettahPro automatically:

- Adds the total (including VAT) to **Accounts receivable** — that's now what the customer owes you.
- Records the sale (excluding VAT) under **Sales revenue**.
- Records the VAT separately under **VAT payable** (you'll remit this to Inland Revenue when you file).

If the item is stock-tracked, it also reduces inventory and records the cost of the goods sold so your gross margin shows correctly on the P&L.

The invoice is now visible on your dashboard's "Recent invoices" panel and on the **AR aging report**.

## Step 6 — Record the payment

When the customer pays, go to **Sell → Payments → + New payment**:

1. Pick the customer.
2. Pick the **method** — cash, cheque, bank transfer, LankaQR, FriMi, Genie, etc.
3. Pick the **bank or cash account** the money landed in.
4. Enter the **amount**.
5. **Allocate** it against the invoice you posted (or pick "auto-allocate" to apply against the oldest open invoices first).
6. Save.

PettahPro adds the amount to your bank balance and reduces what the customer owes by the same amount. The invoice flips to **paid** (or **partially paid** if it was only a deposit), the AR aging report updates, and your cash position on the dashboard goes up.

## What's next

You've now done a full sales cycle. The most common follow-ups:

- **Customise your invoice PDF** — upload a logo on **Settings → Branding**. You can also clone the default invoice template and edit the layout.
- **Email the invoice** — the **Send** button on the invoice detail page emails the PDF to the customer.
- **Add suppliers and bills** — the buying side mirrors the selling side. Same shape, just supplier-facing.
- **Set up payroll** — the [Payroll](./hr/payroll.md) module is the next biggest piece of the system.

If anything looked confusing, it's probably worth a doc fix — every page on this site has an **Edit this page** link in the footer.
