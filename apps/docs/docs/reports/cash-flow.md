---
title: Cash flow
sidebar_position: 6
---

# Cash flow

## What it does

The cash flow report shows the actual money in and out of your bank and cash accounts during a period. Unlike the P&L (which records income when invoiced and expenses when billed, regardless of payment), cash flow shows only the **money that actually moved**. It's the truer answer to "how much cash did the business generate this month?"

A profitable business can have a cash crunch (customers haven't paid yet, suppliers want their money). A break-even business can be cash-rich (customers prepay, you delay paying suppliers). The cash flow report tells you which situation you're in.

## How to read it

Open **Reports → Cash flow** and pick a date range.

The report has three sections in the standard accounting format:

### 1. Operating activities

Cash from your normal trading:

- **Cash received from customers** — payments from customers during the period.
- **Cash paid to suppliers** — supplier payments out.
- **Cash paid to employees** — payroll disbursements.
- **Cash paid for VAT, EPF, ETF, PAYE** — statutory remittances.
- **Other operating cash** — bank charges, interest, other income.

= **Net cash from operations**.

### 2. Investing activities

Cash for buying or selling long-term assets:

- **Purchase of equipment / vehicles / property**.
- **Sale of equipment / vehicles / property**.

= **Net cash from investing**.

### 3. Financing activities

Cash from owners or lenders:

- **Owner's contributions**.
- **Owner's drawings**.
- **Loans received**.
- **Loan repayments**.

= **Net cash from financing**.

### Net change in cash

Operating + Investing + Financing = the period's overall cash movement.

The report also shows **Opening cash** at the start of the period and **Closing cash** at the end, which should match your bank/cash balances on those dates.

## Common tasks

### See where the cash actually came from this month

Run for the current month. Most healthy SMEs see most of their cash in the operating section, mostly from "Cash received from customers". If your operating cash is negative even though the P&L shows a profit, customers aren't paying — go look at AR aging.

### Compare cash vs. profit

Run cash flow alongside P&L for the same period. If P&L shows 500k profit but cash flow shows 200k, then 300k of profit is sitting in unpaid AR (or in inventory, or in fixed assets bought during the period). Useful for understanding why the bank balance doesn't move the way the P&L suggests.

### Forecast next month's cash position

Cash flow is historical, not predictive. For forecasting, use the **Cash flow forecast** report (in **Reports → Cash flow forecast**), which projects future cash based on AR due dates, AP due dates, scheduled payroll, and recurring items.

### Drill into a line

Click any line — e.g. "Cash received from customers" — to see the underlying customer payments. From there you can click any individual payment to see what invoices it cleared.

### Run year-to-date

Date range = FY start to today. The most useful single-screen view of "how the business is generating cash this year".

### Export for the bank

Banks reviewing a loan application usually want a 12-month or 24-month cash flow history. Export to PDF for the formal version.

## What it draws from

The cash flow report is built from your bank and cash account movements:

| Section | Comes from |
|---|---|
| Operating — receipts | Posted customer payments (incoming) |
| Operating — payments | Posted supplier payments + payroll disbursements + statutory remittances |
| Investing | Bank/cash transactions tagged to fixed-asset accounts |
| Financing | Bank/cash transactions tagged to equity or loan accounts |

The classification (operating vs. investing vs. financing) is automatic based on the offsetting account on each transaction. If a payment goes from Bank → AP, it's operating. If a payment goes from Bank → Fixed assets, it's investing. If a payment goes from Bank → Bank loan, it's financing.

## FAQ

**The cash flow shows different numbers than my bank statement.**
The cash flow uses your PettahPro bank balance, which should match the statement after reconciliation. If they don't match, you've got unreconciled items — run **Bank reconciliation** first.

**Why is cash flow + last period's closing cash ≠ this period's closing cash?**
It should — that's the integrity check. If they don't match, an opening cash balance got entered wrong, or there's an unreconciled item. Run **Bank reconciliation** to chase the difference.

**Where do drafts appear?**
They don't. Drafts haven't moved any money. Cash flow only shows posted transactions.

**Can I see cash flow per branch?**
Yes — pick a cost-centre filter. The report will show cash flow for transactions tagged to that cost centre. (Bank movements aren't always cost-centre tagged, so the per-branch view has limits.)

**The "Cash paid to employees" line looks low.**
Check whether you're disbursing payroll inside PettahPro or outside. If your payroll runs are approved in PettahPro but disbursed via a separate banking portal without a corresponding payment in PettahPro, the salaries will show as a liability that never decreases — and won't appear on the cash flow. Fix by recording the salary disbursements as PettahPro payments.

**What's the difference between cash flow and bank reconciliation?**
Cash flow tells you the **shape** of money moving — operating, investing, financing. Bank reconciliation tells you whether your records **match the bank statement** transaction by transaction. Different jobs, related data.

## Related

- [Profit & Loss](./profit-loss.md) — accrual income and expenses (vs. cash flow which is cash basis).
- [Balance sheet](./balance-sheet.md) — the cash position is on the balance sheet at the as-at date.
- **Cash flow forecast** — the forward-looking version.
- [Aging](./aging.md) — AR aging shows what's still uncollected.
- **Bank reconciliation** — match books to bank statement.
