---
title: Profit & Loss
sidebar_position: 2
---

# Profit & Loss

## What it does

The Profit & Loss (P&L) report — also called the **income statement** — shows your income, your expenses, and the net result for a period. It tells you whether you made or lost money, and where the money came in and went out.

Unlike the balance sheet (which is a snapshot at a point in time), the P&L is **for a period** — usually a month, a quarter, or a year. Every income and expense entry posted within the date range contributes to the report; entries outside the range don't.

## How to read it

Open **Reports → Profit & Loss** and pick a date range.

The report is structured top to bottom:

1. **Income** — sales revenue plus other income (interest received, gains, etc.).
2. **Cost of goods sold (COGS)** — the cost of stock items you sold during the period.
3. **Gross profit** = Income − COGS.
4. **Expenses** — every operating expense category (salaries, rent, utilities, marketing, etc.).
5. **Operating profit** = Gross profit − Expenses.
6. **Other income / expenses** — non-operating items (interest paid, FX gain/loss, etc.).
7. **Net profit / (loss)** — the bottom line.

Each line is an account from your chart, showing the total movement during the period. Click any line to see the underlying transactions.

## Common tasks

### Run for a specific period

Pick a date range — last month, this quarter, this financial year, or a custom range. **This year-to-date** is the most common in routine reviews.

### Compare two periods

Turn on **Compare with previous period** (or pick a custom comparison range). The report adds columns for the prior period's value and the variance, both as an amount and as a percentage. Useful for "are sales actually growing?" type reviews.

### Group by category

If your items are organised by category (Food / Beverages / Services), turning on **Group by category** rolls sales up by category instead of by individual income account. Same for expenses by expense category. Useful for retail/wholesale businesses with hundreds of line items.

### Slice by cost centre

If you tag transactions with cost centres (per branch, per department, per project), pick a cost centre to filter the report to just that slice. Or pick **Compare by cost centre** to get a side-by-side P&L per branch on one screen.

### Show as percentage of revenue

Toggle **Common-size**. Each expense line gets recalculated as a percentage of total revenue, which is the standard way to look at margin pressure over time. "Salaries are 25% of revenue" is more useful than "salaries are 1.2 million".

### Export

PDF, Excel, and CSV available. The PDF is the polished version (with your logo and the configured letterhead) — what you'd attach to a board pack or send to your accountant.

## What it draws from

The P&L draws from every posted income and expense entry within the date range:

| Source | What it contributes |
|---|---|
| Posted invoices | Sales revenue (subtotal, not the VAT) |
| Posted bills | Expenses (or inventory + COGS at sale) |
| Posted payroll runs | Salaries, employer EPF, employer ETF |
| Posted journal entries | Whatever income or expense lines you posted |
| Stock counts | Stock variance (P&L expense or income) |

Asset, liability, and equity accounts don't appear on the P&L — they're balance-sheet accounts. The exception is COGS, which appears on the P&L because the cost of goods sold is an expense; the corresponding inventory reduction is a balance-sheet movement.

## FAQ

**The P&L shows a profit but my bank account hasn't gone up. Why?**
Profit and cash are different things. The P&L records when income is **earned** (invoice posted) and when expenses are **incurred** (bill posted) — not when the money actually moves. If your customers haven't paid and your suppliers have, you can be very profitable on paper while running short on cash. Use the **Cash flow** report for the cash story.

**My P&L doesn't include VAT — is that right?**
Yes. VAT is collected on behalf of Inland Revenue (you're a tax collector for them, not the recipient of the VAT). It's a balance-sheet liability, not income to you. The P&L correctly shows the pre-VAT subtotal as your revenue.

**I posted a bill for office supplies last month but it's showing on this month's P&L.**
Check the bill **date**, not the posting date. The P&L uses the document's effective date — if the bill is dated this month, it lands on this month's P&L regardless of when you keyed it in.

**The COGS number looks too high (or too low).**
COGS is calculated using the moving-average cost of each stock item at the time of sale. If your costs have changed dramatically (e.g. inflation, supply chain shifts), the moving average can lag. Run the **Inventory cost** report to see what costs are loaded for each item.

**Can I drill into "Other expenses" to see what's there?**
Yes — click the row and you get the GL filtered to that account for the period. Useful for catching a one-off that doesn't deserve its own account.

**My P&L year-to-date doesn't match the sum of my monthly P&Ls.**
It should — they're the same data summed differently. If you're seeing a difference, the most likely cause is a period close + late-posted transaction, where the late entry got posted with a date in a closed period (which shouldn't happen if period close is on). Contact support if you see this.

## Related

- [Trial balance](./trial-balance.md) — the underlying account balances.
- [Balance sheet](./balance-sheet.md) — what you own and owe at a point in time.
- [Cash flow](./cash-flow.md) — actual money in and out (vs. accrual P&L).
- [Budget vs. actual](./budget-vs-actual.md) — comparing P&L to your budget.
- [Trends](./trends.md) — period-over-period comparisons.
