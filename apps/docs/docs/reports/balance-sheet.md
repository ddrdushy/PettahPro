---
title: Balance sheet
sidebar_position: 3
---

# Balance sheet

## What it does

The balance sheet is a snapshot of your business **at a single point in time** — what you own (assets), what you owe (liabilities), and what's left for the owners (equity). It's the report that answers "if everything stopped today, where would we stand?"

The fundamental rule the balance sheet enforces: **Assets = Liabilities + Equity**. Everything you own had to come from somewhere — either you borrowed it (liability) or the owners put it in / earned it (equity). PettahPro's balance sheet always balances; if it doesn't, something is wrong with your books.

## How to read it

Open **Reports → Balance sheet** and pick a date.

The report has three sections:

### Assets

What you own. Sub-grouped:

- **Current assets** — things you'd convert to cash within 12 months: cash, bank accounts, accounts receivable, inventory, prepayments.
- **Non-current assets** — things you'll hold long term: fixed assets (equipment, vehicles, property), intangible assets, long-term investments.

### Liabilities

What you owe. Sub-grouped:

- **Current liabilities** — debts due within 12 months: accounts payable, VAT payable, EPF/ETF/PAYE payable, salaries payable, short-term loans.
- **Non-current liabilities** — long-term debts: bank loans beyond 12 months, lease obligations.

### Equity

What's left for the owners:

- **Owner's equity / share capital** — what the owners put in.
- **Retained earnings** — accumulated profit (or loss) that hasn't been distributed.
- **Current year's profit** — the running net result of this year's P&L.

The total of (Liabilities + Equity) at the bottom should equal the total of Assets at the bottom. PettahPro shows the totals and confirms with a tick if they balance, or a flag if they don't.

## Common tasks

### Run as at a past date

Pick a past date in the **As at** field. The balance sheet recalculates as it would have looked then — useful for year-end statements, comparing how the business has changed, or producing an audit version of a prior year.

### Compare two dates

Turn on **Compare with**. The report adds columns for the comparison balance and the variance. Lets you see how each line moved between the two dates — what's grown (good or bad), what's shrunk.

### Group by sub-category

The default already groups assets/liabilities into current vs non-current. Turn off **Group** to see all accounts in one flat list, or pick a different grouping (by department, by branch).

### Show in summary form

For board packs and shareholder reports, you usually want a one-page summary version, not the full account-level detail. Turn on **Summary** to roll up to the section level (Total current assets, Total non-current assets, etc.).

### Export

PDF, Excel, and CSV. The PDF is the formatted version with your logo and letterhead — what you'd send to a bank when applying for a loan, or to your accountant for review.

### Drill into an account

Click any account row to open the **General ledger** filtered to that account, ending on the report's date. Useful for "why has AR gone up so much?" — drill in and see the unpaid invoices.

## What it draws from

Every balance-sheet account in your chart, with its balance as at the chosen date:

| Section | Comes from |
|---|---|
| Cash and bank | All payment activity (in and out) |
| Accounts receivable | Posted invoices minus collected payments |
| Inventory | GRNs minus COGS on sales |
| Fixed assets | Purchases recorded as fixed asset, minus depreciation |
| Accounts payable | Posted bills minus paid amounts |
| VAT payable / receivable | VAT collected (output) minus VAT paid (input) |
| EPF/ETF/PAYE payable | Payroll runs not yet remitted |
| Equity | Owner contributions, drawings, prior years' profit |
| Current year's profit | Year-to-date net result from the P&L |

The "current year's profit" is the running tally of this year's P&L — it's automatically reset to zero when you do the year-end close, with the prior year's profit transferred to Retained earnings.

## FAQ

**My balance sheet doesn't balance — what now?**
Same answer as the trial balance: don't post anything else, contact PettahPro support. The balance-sheet identity (A = L + E) is a fundamental invariant; when it breaks, there's a serious data issue.

**The current year's profit doesn't match my P&L.**
It should — they're computed from the same data. Most common cause of a mismatch is the date range: the balance sheet's "current year" runs from FY start to the as-at date; if your P&L is filtered to a different range, you'll naturally see a different number.

**Why is "Stock variance" on my balance sheet? I thought it was a P&L item.**
Stock variance is on the P&L. What you might be seeing on the balance sheet is **Inventory** — a balance-sheet asset. The two are different: Inventory is what you currently hold (BS); Stock variance is the cumulative effect of count-time adjustments (P&L). Close cousins, different reports.

**My retained earnings looks wrong.**
Retained earnings is "every prior year's profit + every owner contribution − every owner drawing". If it looks wrong, it's almost always an opening-balance issue from when you first set up PettahPro. Run the **Equity statement** (or just the GL filtered to equity accounts) to see every entry that's contributed.

**Can I run a balance sheet for one branch?**
Yes — pick a cost centre filter. The report will show the balance sheet sliced to just that cost centre. Useful when you want a per-branch view, but be aware: many balance-sheet items (bank, AP, VAT) don't naturally tag to a cost centre, so the per-branch view has limits.

**Is my AR balance the same as what's on AR aging?**
It should be. AR aging buckets the same balance by overdue days. If they differ, you've got an integrity issue and should contact support.

## Related

- [Trial balance](./trial-balance.md) — the underlying account balances.
- [Profit & Loss](./profit-loss.md) — income and expenses (different shape, related data).
- [Cash flow](./cash-flow.md) — money movement during a period.
- [Aging](./aging.md) — drilldown of AR and AP by overdue bucket.
- [Period close](../accounting/period-lock.md) — typically a balance sheet is run at close.
