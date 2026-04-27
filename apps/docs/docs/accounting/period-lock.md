---
title: Period close & lock
sidebar_position: 3
---

# Period close & lock

## What it does

Closing a period (a month or a year) is the act of declaring that the books for that period are final. After you've reconciled bank statements, posted year-end adjustments, and reviewed the trial balance, you "close" the period — and from that point on, nothing more can post into it.

The point is to stop your historical numbers from changing under your feet. Without period close, somebody could post a journal dated last March, your March P&L would silently change, and your auditor's signed report wouldn't tie to the numbers you have today. Closing the period freezes history.

PettahPro supports two kinds of close:

- **Soft close** — the period is locked but can be unlocked again if you really need to post something into it.
- **Hard close** — the period is sealed permanently; nothing can post in or near it ever again. Used at year-end after the audit is signed off.

You don't have to close periods at all if you don't want to. But once your business is past the early stages, monthly close is one of the basic disciplines that keeps your books trustworthy.

## Walkthrough

### Closing a month

A typical month-end close looks like this:

1. **Reconcile your bank accounts.** Open **Accounting → Bank reconciliation**, match every transaction in PettahPro to the bank statement, and resolve any unreconciled items. Don't skip this — period close on top of an unreconciled bank is a recipe for surprises.
2. **Post any month-end adjustments** as journal entries — depreciation, accruals, prepayment releases, provisions.
3. **Review the trial balance** for the month. Open **Reports → Trial balance**, set the date to the last day of the month, and look down the list. Anything that looks wrong, fix now while the period is still open.
4. **Close the period.** Open **Accounting → Periods**, find the month, click **Close**. PettahPro asks for an optional reason (e.g. "March 2026 closed after bank rec on 5 April") — fill that in for the audit trail and confirm.

The month is now locked. Any attempt to post a transaction with a date in the locked period (whether an invoice, a bill, a payment, or a manual journal) is rejected with a message saying the period is locked.

### Closing a year

Year-end close is the same shape, but with more steps before the lock:

1. **Reconcile every bank account** through 31 March.
2. **Post all year-end journals** — depreciation for the full year, provisions, accruals, prepayments, owner adjustments.
3. **Review the trial balance, P&L, and balance sheet** as at 31 March. The P&L's net profit should match what would be transferred to retained earnings.
4. **Run the year-end transfer.** PettahPro's **Accounting → Year-end close** flow moves the net profit from the income statement into Retained earnings, and resets income and expense accounts to zero for the new year. (This is what makes the new FY's P&L start at zero while the balance sheet carries forward.)
5. **Soft-close the year.** Lock all the months in the FY. The auditors will go through the books in this state.
6. **After the audit signs off, hard-close the year.** Once hard-closed, nothing can ever post into the year — even with admin override.

### Unlocking a soft-closed period

If you really need to post into a soft-closed period (e.g. an invoice from last month came in late and you genuinely need to backdate it), open **Accounting → Periods**, find the month, click **Unlock**. PettahPro asks for a reason — write something honest, because this goes on the audit trail. Post what you need to, then close the period again.

Unlocking is restricted to roles with `accounting.unlock-period` — typically just the Owner.

## Common tasks

### Close the month after payroll

Payroll posts on the 25th, but the month doesn't end until the 30th/31st. Sequence:

1. Run payroll, approve it, disburse it.
2. Wait for any further month-end transactions (rent, utilities, last bills).
3. On the 1st–5th of the next month, do the bank reconciliation for the closed month.
4. Post month-end journals.
5. Close the month.

### Reverse a journal that posted into a locked period

You can't post a reversal directly into a locked period. Two options:

- **If it's soft-closed**, unlock the period, post the reversal, close again.
- **If it's hard-closed or you don't want to unlock**, post the reversal in the next open period instead. The total ledger ends up the same; the trail just shows "originally posted in March, corrected in April".

### Run reports for a closed period

Closing a period only stops new entries from posting — it doesn't affect reading reports. You can still run the trial balance, P&L, balance sheet, GL, AR/AP aging, and every other report for any closed period any time.

### Roll back a year-end close

If you've done the year-end transfer but realised you made a mistake, click **Reverse year-end close** in **Accounting → Year-end close**. PettahPro reverses the retained-earnings transfer, leaves income/expense accounts populated again, and unlocks the months. You can then post your corrections and re-run year-end. (This only works on soft-closed years — hard-closed years cannot be rolled back.)

### Stop people from posting into prior periods even when they're not closed

If you want a hard policy of "no backdated entries beyond X days", set **Settings → Approvals → Backdated transactions**. Above the chosen threshold, any backdated transaction needs approval — even before you've formally closed the period.

## What gets posted

Period close itself doesn't post anything to your books — it's a control, not a transaction.

What does post around year-end is the **year-end retained earnings transfer**, which happens when you run year-end close. For a year with 5,000,000 of net profit:

| Account | Debit | Credit |
|---|---|---|
| Retained earnings | | 5,000,000 |
| (Each income account) | (its full year balance) | |
| (Each expense account) | | (its full year balance) |

End result: every income and expense account is zeroed out, the net profit is sitting in Retained earnings on the balance sheet, and the new year's P&L starts at zero.

The actual lines depend on your chart and the year's activity, but the principle is: **income and expense accounts are temporary, retained earnings is permanent**. Year-end close moves the period's net result into the permanent account.

## FAQ

**Do I have to close periods?**
No — PettahPro doesn't require period close. But after a year or so most businesses do close monthly, because:
- Reports stop changing under your feet.
- Anyone backdating an entry is forced to acknowledge it (via unlock).
- Audit trails are cleaner.
- Year-end close is much simpler when each month was already locked.

**My accountant wants to post journals into a closed month — what do I do?**
If you want them to be able to: unlock the month, let them post, close again. If you'd rather they stop trying: ask them to post the journal in the current month dated today, with a description noting what it relates to. Most accountants accept the second option once they understand period close is there to protect the books.

**Why are some accounts the same balance after year-end close as before?**
Year-end close zeroes out **income and expense** accounts only — those are the temporary accounts. Asset, liability, and equity balances carry forward unchanged into the new year. Bank balances, AR, AP, fixed assets, etc., all stay the same.

**Can I have different fiscal year-ends for different parts of my business?**
No — PettahPro has one fiscal year per business. If you have group entities with different year-ends, run them as separate businesses on PettahPro.

**Hard close was an accident. Can it be undone?**
Hard close is deliberately one-way — that's the point of it. If you've genuinely hard-closed by accident and need to post into the year, contact PettahPro support; in extreme cases an admin override is possible, but it's logged prominently and is meant for true emergencies (e.g. tax authority adjustment after audit).

**A bill came in dated last year (already hard-closed). How do I record it?**
Post it in the current period with a description noting the original date. The expense lands in this year's P&L, which is the correct outcome — the prior year is signed off and shouldn't change. If the amount is material to the prior year, talk to your auditor about a prior-year adjustment journal in the current year.

## Related

- **Bank reconciliation** — the typical step right before monthly close.
- **Journal entries** — for posting any month-end adjustments before close.
- **Year-end close** — the year-specific flow that includes the retained-earnings transfer.
- **Trial balance** — the report you scan before pulling the trigger on close.
- [Settings → Approvals](../settings/overview.md) — for restricting backdated entries even when a period isn't closed.
- [Glossary — Period lock](../concepts/glossary.md#period-lock) — the short definition.
