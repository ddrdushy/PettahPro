---
title: Journal entries
sidebar_position: 2
---

# Journal entries

## What it does

A journal entry is a manual transaction you post directly to your books, moving money between accounts that aren't covered by one of the regular document types (invoice, bill, payment, etc.). Most things in PettahPro post journals automatically when you save the document — invoices, bills, payroll runs, supplier payments all create journals on their own. You only post a manual journal when you need to record something the regular documents can't, or when you're making a correction or year-end adjustment.

Common reasons to post a manual journal:

- **Opening balances** when starting on PettahPro mid-year (often handled by the dedicated Opening balance module instead).
- **Year-end adjustments** — depreciation, accruals, prepayments, provisions.
- **Correcting an error** — reclassifying something that posted to the wrong account.
- **Bank charges and interest** that aren't tied to a specific document.
- **Owner contributions and drawings** — money the owner puts in or takes out.

## Walkthrough

Open **Accounting → Journal entries → + New journal**.

1. **Set the date.** This is the date the entry takes effect, which determines which period it lands in. The period must be open.
2. **Add a description.** A short note explaining what the journal is for. This shows on the GL and the audit trail — write something your future self (or your auditor) will understand.
3. **Add lines.** Each line has:
   - **Account** — pick from your chart of accounts.
   - **Debit** OR **Credit** — fill in one or the other, not both.
   - **Description** — line-level note (defaults to the journal description).
   - **Cost centre** — optional unless you've made it required.
4. **Make it balance.** Total debits must equal total credits. PettahPro shows you the running totals at the bottom — if they don't match, you can't post.
5. **Save as draft** to keep editing, or **Post** to commit it to your books.

When you post, PettahPro:

- Allocates a journal number from your number series.
- Books each line to its account.
- Updates the running balance for every account on the journal.
- Locks the journal — you can't edit afterwards.

## Common tasks

### Post a depreciation entry

At the end of each month or year, you depreciate fixed assets. For a vehicle worth 1,200,000 depreciating at 20% per year (so 240,000 per year, or 20,000 per month):

| Account | Debit | Credit |
|---|---|---|
| Depreciation expense | 20,000 | |
| Accumulated depreciation — vehicles | | 20,000 |

(If you use the Fixed assets module, depreciation is automated — you only need a manual journal for one-off adjustments.)

### Reclassify something posted to the wrong account

You posted a bill to "Travel" but it should have been "Marketing". Don't edit the bill — post a journal that moves the amount:

| Account | Debit | Credit |
|---|---|---|
| Marketing | 25,000 | |
| Travel | | 25,000 |

The bill stays as it was; this journal corrects the classification on the P&L from this point forward.

### Record bank charges

Your bank statement shows a 500 monthly charge that didn't go through PettahPro. Post:

| Account | Debit | Credit |
|---|---|---|
| Bank charges | 500 | |
| Bank — primary | | 500 |

### Record an owner's contribution

The owner put 100,000 of their own money into the business bank account:

| Account | Debit | Credit |
|---|---|---|
| Bank — primary | 100,000 | |
| Owner's equity | | 100,000 |

The mirror entry — owner taking money out — is the reverse (DR Owner's drawings / CR Bank).

### Reverse a posted journal

Open the journal → **Reverse**. PettahPro creates a new journal with the opposite of every line, dated whenever you choose. The original journal stays in the audit trail with status **Reversed**. This is the audit-correct way to undo a journal — never edit history.

### Post a recurring journal (depreciation, prepayments)

For journals that repeat with the same shape every month, set up a **recurring journal template** under **Accounting → Recurring journals**. PettahPro creates the draft on the schedule for you to review and post. Useful for monthly depreciation, rent prepayment release, accruals.

### Find a specific journal

Open **Accounting → Journal entries**. The list is filterable by date range, posted-by, account, and free text on the description. Each journal has a unique number you can also search by directly.

## What gets posted

A journal entry posts itself, by definition. Whatever lines you put on it are exactly what hits the books.

The single rule PettahPro enforces: **debits must equal credits**. If they don't, the journal is rejected — your trial balance can't go out of balance from a manual journal.

A few other things to know about the posting:

- The journal date determines the period it lands in. The period has to be **open** — if it's been locked (typically because the month or year is closed), the journal is rejected with a message telling you which period is locked.
- Once posted, a journal is locked. Edits go through the **Reverse** flow above.
- Journals appear in the general ledger filtered by any of their accounts, on the trial balance contributing to those accounts' totals, and on the audit log under "who posted what".

## FAQ

**My debits and credits balance but it still won't post — why?**
Most common reasons: (1) the date is in a locked period; (2) one of the accounts you picked is inactive; (3) you don't have the `accounting.post-journal` permission (typically only Accountant, Admin, and Owner roles do); (4) approval is required and you haven't sent it for approval. The error message tells you which one.

**Can I post a journal that affects another business's books?**
No. Each business in PettahPro has its own books and its own chart of accounts. Journals only post within the business you're logged into.

**Should I be posting lots of manual journals?**
Probably not. PettahPro is set up so most things post automatically through the regular documents — invoices, bills, payments, payroll. If you're posting 50 manual journals a month, you're probably doing something the wrong way and there's a regular document that would handle it. Talk to support before posting bulk manual journals.

**Can I import journals from Excel?**
Yes. **Accounting → Journal entries → Import** takes a CSV or Excel file and posts each row as a journal. Useful for migrations and for businesses whose accountant works in Excel and sends you the entries to post.

**My auditor wants to see a journal that was reversed. Where is it?**
Reversed journals stay in the system permanently — they don't disappear. Filter the journal list by status **Reversed** to see them, or look at the audit log which shows every reverse action with the user, time, and reason.

**Can I post a journal in a foreign currency?**
The lines you enter post in your books currency (LKR). If you're recording an entry that originated in another currency, convert it at the day's rate before entering, and put the original currency and amount in the description for reference. (The Bills, Invoices, and Payments modules handle multi-currency conversion automatically — you don't need a manual journal for those.)

## Related

- **Chart of accounts** — the accounts your journals can use.
- **Recurring journals** — for entries that repeat on a schedule.
- **Period close** — locking a period prevents further journal posting in it.
- **Opening balance** — for loading initial balances when starting on PettahPro.
- **Fixed assets** — automates depreciation journals if you use it.
- **General ledger report** — drill into any account to see the journals affecting it.
