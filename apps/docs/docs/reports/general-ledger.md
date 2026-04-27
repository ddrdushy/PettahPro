---
title: General ledger
sidebar_position: 4
---

# General ledger

## What it does

The general ledger (GL) is the chronological list of every transaction that's posted to your books, organised by account. If the trial balance is the summary, the GL is the detail underneath it. Pick any account, pick a date range, and the GL shows you every line that hit it — opening balance, every posting in date order, closing balance.

The GL is the report you reach for when something on a higher-level report looks wrong and you need to know "why is this number what it is?"

## How to read it

Open **Reports → General ledger** and pick:

- **Account(s)** — one, several, or all.
- **Date range** — defaults to year-to-date.

For each account, the report shows:

- **Opening balance** at the start of the date range.
- **Each posting** in date order, with the date, the document number, the description, the debit, the credit, and the running balance.
- **Closing balance** at the end of the date range.

Each row has a clickable link to the source document — invoice, bill, payment, journal — so you can drill from any line back to where it came from.

If you pick multiple accounts, each account is shown as its own section. If you pick all accounts, you get the full GL — useful for auditors, less useful day-to-day.

## Common tasks

### Investigate a specific account

This is the GL's main job. From the trial balance or P&L or balance sheet, click any account → you land on the GL filtered to that account for the same date range. Scan the activity and click into anything that looks wrong.

### See every transaction by a specific user

Filter by **Posted by**. Useful when reviewing a colleague's work, or when an audit asks "show me everything user X posted in March".

### Search by document number or description

The free-text filter searches across descriptions and document numbers. Useful when you remember "we paid for that thing" but not which account it went to.

### Run for a closed year

Pick the closed FY in the date range. Closed periods don't restrict reading reports — only posting. The GL works fine for a year that ended five years ago, as long as the data is still in the system.

### Export to share with the auditor

Pick **Export → Excel** for the most useful format (auditors love Excel because they can re-sort and filter). PDF is also available for the formal report version.

### Filter to just journals (or invoices, or bills)

Pick a **Source type** — invoice, bill, payment, payroll, journal, GRN, stock count. Useful when you want "all the manual journals that hit this account" without the noise of the regular flow.

### See which document references this account

The GL is the answer. Every posting links to its source document; a quick scan tells you which document types touch a given account most.

## What it draws from

Every posted transaction in your books, organised account by account.

| Source type | What appears in the GL |
|---|---|
| Invoice | One row per ledger account the invoice posts to |
| Bill | Same |
| Payment (in or out) | Bank account row + AR/AP row |
| Payroll run | Multiple rows — gross, EPF, ETF, PAYE, salaries payable |
| Journal entry | Each line of the journal |
| GRN | Inventory and GRN clearing rows |
| Stock count | Inventory and stock variance |

Drafts are excluded. Reversed transactions appear with both the original and the reversal — that's the audit trail.

## FAQ

**The GL is too long to be useful.**
Use filters: pick a single account, narrow the date range, filter by source type. The full unfiltered GL is mostly only useful when an auditor asks for it.

**An account I'd expect to have entries is empty.**
Check the date range — the account might have activity outside the range you've picked. Or the account might be active but unused so far this year. Or you might have the wrong account name (different accounts often have similar names).

**I see a transaction in the GL that doesn't appear on the source document list.**
Most likely it's a system-generated entry — period-end retained earnings transfer, FX revaluation, or an automatic adjustment. The description usually tells you which one. If it doesn't, click the document link — that opens whatever generated the entry.

**Can the GL show me transactions that were drafts?**
No — drafts haven't posted, so they're not in the ledger. To see drafts, go to the relevant module's draft list (e.g. Sell → Invoices → Drafts).

**I want a printout of every journal posted in March. Which report?**
The GL filtered to **Source type = Journal** with the March date range, then export to PDF.

**Does the GL show the cost-centre tag on each line?**
Yes — turn on **Show cost centre** in the column toggles. Useful when reviewing a cost-centre-specific account (e.g. "Branch A salaries").

## Related

- [Trial balance](./trial-balance.md) — the summary the GL underlies.
- [Profit & Loss](./profit-loss.md) and [Balance sheet](./balance-sheet.md) — drill into either to land on the GL.
- [Chart of accounts](../accounting/chart-of-accounts.md) — the account structure.
- [Journal entries](../accounting/journal-entries.md) — reviewing manual journals.
