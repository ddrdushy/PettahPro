---
title: Trial balance
sidebar_position: 1
---

# Trial balance

## What it does

The trial balance is the snapshot list of every account in your books with its debit total, credit total, and net balance, as at a chosen date. It's the first report most accountants and auditors open — because if it doesn't balance (debits = credits), something is fundamentally wrong, and if it does balance you've got a sound starting point for everything else.

In PettahPro, the trial balance is updated continuously — every time you post any document (invoice, bill, payment, payroll, journal), the affected accounts move in real time. There's no "running" the trial balance overnight; it's already current.

## How to read it

Open **Reports → Trial balance** and pick a date. By default the report shows balances **as at today**, but you can pick any past date to see what your books looked like then.

The report has six columns:

- **Code** — the account code from your chart of accounts.
- **Account name** — what the account is called.
- **Section** — Assets / Liabilities / Equity / Income / Expenses.
- **Debit total** — sum of all debits to this account up to the chosen date.
- **Credit total** — sum of all credits.
- **Balance** — Debit total − Credit total. Positive means the account is in debit; negative (often shown in brackets) means credit.

The bottom row shows the grand totals. **Total debits must equal total credits** — that's the test. If they don't match, you've got a serious data issue and need to call PettahPro support.

The expected sign of the balance tells you whether things are sensible:

| Section | Normal balance |
|---|---|
| Assets | Debit (positive) |
| Liabilities | Credit (negative) |
| Equity | Credit (negative) |
| Income | Credit (negative) |
| Expenses | Debit (positive) |

If an account is on the "wrong" side of zero, that's a flag worth investigating — sometimes it's a real situation (a customer who's overpaid, putting AR into credit), sometimes it's a data error.

## Common tasks

### Run a trial balance for a closed period

Set the **As at** date to the last day of the period you want. The report will show what the books looked like at the close of that day. Useful when an auditor wants the trial balance as at year-end.

### Drill into a specific account

Click any row to open the **General ledger** filtered to that account, with the same date range. From there, click any line to see the source transaction that posted it.

### Compare two dates

Set **Compare with** to a second date. The report adds two more columns — the comparison balance and the variance. Useful for "what changed between January and June?" reviews.

### Filter by section or account

The filter bar lets you narrow to a single section (just expenses, just liabilities) or a specific account. Useful when reviewing one part of the books without scrolling past everything else.

### Export

Click **Export** in the top right. CSV, Excel, and PDF are all available. The exported version freezes the trial balance at that date — useful for sharing with auditors or attaching to closing documentation.

### Show inactive accounts

By default, accounts with zero balance and zero activity in the chosen period are hidden. Toggle **Show inactive** to see the full chart. Useful for verifying that an account you expect to be empty really is.

## What it draws from

The trial balance is calculated from every posted transaction in your books. There's no "calculation" beyond summing up debits and credits per account.

| Source | What it contributes |
|---|---|
| Posted invoices | AR, sales revenue, VAT payable, COGS, inventory movements |
| Posted bills | AP, expense or inventory, VAT receivable, WHT payable |
| Posted payments | Bank, AR or AP movement |
| Posted payroll runs | Salaries, EPF/ETF/PAYE payable, salaries payable |
| Posted journal entries | Whatever lines you posted |
| GRN postings | Inventory, GRN clearing |
| Stock counts | Inventory, stock variance |

Drafts are excluded — only **posted** transactions count.

## FAQ

**My trial balance doesn't balance — what do I do?**
Don't panic, but don't ignore it either. PettahPro enforces balance at posting time, so an out-of-balance trial balance is unusual. Most likely causes: (a) a database integrity issue (rare); (b) a journal that was hand-edited via the database (which we don't allow through the UI); (c) a corrupted import. Contact PettahPro support and don't post anything else until it's resolved.

**An account I don't recognise is on the trial balance.**
Click into it. The first transaction will tell you what created it — usually an opening balance, an automatic entry from a module, or a journal someone posted.

**Can the trial balance show me budget vs. actual?**
The trial balance only shows actuals. For budget vs. actual, use the **Budget vs. actual** report.

**Why is my AR showing a credit balance?**
A customer paid more than they owe — typical for prepayments and overpayments. The credit balance becomes a liability ("we owe this customer money or future product"). Resolve it by issuing a refund payment or by allocating against a future invoice.

**Does the trial balance match my balance sheet?**
It should. The balance sheet is the trial balance reorganised — assets together, liabilities together, equity together, with the P&L's net result rolled into retained earnings. If they don't tie, something's gone wrong.

## Related

- [Profit & Loss](./profit-loss.md) — income and expenses for a period.
- [Balance sheet](./balance-sheet.md) — assets, liabilities, equity at a point in time.
- [General ledger](./general-ledger.md) — drill into any account's transactions.
- [Chart of accounts](../accounting/chart-of-accounts.md) — the structure underneath.
- [Period close](../accounting/period-lock.md) — typically run after the trial balance is reviewed.
