---
title: Bank reconciliation
sidebar_position: 9
---

# Bank reconciliation

## What it does

Bank reconciliation is the routine check that what your books say about your bank account matches what the bank statement actually shows. They almost never match exactly out of the box — there are payments you posted that haven't cleared yet, bank charges you didn't know about until the statement came, deposits the bank has but you haven't recorded. Reconciliation is the structured way to find every difference and either match it (it's a known timing item) or correct it (you missed something).

Done routinely (typically monthly), reconciliation keeps your bank balance trustworthy. Skipped, you end up with a bank balance on your books that's slowly drifting from reality, and an audit nightmare at year-end.

## Walkthrough

Open **Accounting → Bank reconciliation → \[bank account\] → + New reconciliation**.

1. **Statement date** — the date the bank statement is "as at".
2. **Statement balance** — the closing balance on the statement.
3. **Statement file** (optional but recommended) — upload the bank's statement (PDF, CSV, or OFX). PettahPro parses it and prefills the comparison.

The reconciliation screen shows two columns:

- **Books** — every transaction in PettahPro that's hit this bank account, in date order.
- **Statement** — every transaction on the bank's statement, in date order.

Your job: tick off each transaction that matches between books and statement.

### Auto-matching

PettahPro auto-matches obvious pairs (same amount, same date, same payee). Most reconciliations end up 90% pre-matched after upload — your job is the remaining 10%.

### Manual matching

For each unmatched item:

- **Match** — if the books and statement entries are the same transaction, click both to link them.
- **Statement-only item** — something on the statement but not in books. Common causes: bank charges, interest credited, direct debits you forgot to post. Click **Add to books** and post the missing entry.
- **Books-only item** — something in books but not on statement. Usually a timing item — a cheque issued that hasn't been presented, or a deposit in transit. Leave unmatched; it'll match on the next statement when it clears.

### Closing reconciliation

Once everything's matched (or knowingly left as timing items), the screen shows:

- **Books balance** as at the statement date.
- **Statement balance** as at the statement date.
- **Outstanding items** — un-cleared cheques, deposits in transit.
- **Computed reconciled balance** — should equal the statement balance.

Click **Reconcile** to lock the reconciliation. From this point, any new transaction in this bank account dated **before** the reconciliation date is flagged — you shouldn't post into a reconciled period.

## Common tasks

### Reconcile every month

Standard rhythm: when each month's statement arrives (typically 1–5 days after month-end), reconcile. Don't let multiple statements pile up — the harder it gets the longer you leave it.

### Handle a statement-only bank charge

Bank charged 1,000 for monthly fees. Click **Add to books** on the bank-charge line. PettahPro pre-fills as a payment from this bank to "Bank charges" expense; you confirm and post. Now both sides have the same transaction; mark them matched.

### Handle a books-only cheque you issued

You issued a cheque to a supplier on the 28th; the supplier hasn't presented it by month-end. The payment is in your books; the bank doesn't have it on this statement. Leave it unmatched — it's a timing item. Next month's reconciliation will match it once the supplier deposits and the cheque clears.

The "Outstanding items" section of the reconciliation tracks these — you should see your books-only cheques here.

### Discover a transaction you missed entirely

Statement shows a payment you don't recognise — could be a duplicate, fraud, or just a payment the team forgot to record. Investigate. If legitimate, **Add to books** and post the appropriate entry. If suspicious (duplicate, error, possible fraud), don't post; talk to the bank and dispute.

### Re-open a reconciliation

Sometimes you need to fix something post-reconciliation. **Open the reconciliation → Re-open**. Permission-restricted. PettahPro records who reopened and why. Make the correction; reconcile again.

### Reconcile a foreign-currency bank account

Same flow, but watch the FX angle: the books balance is in LKR, the statement balance is in foreign currency. PettahPro converts the statement balance at the as-at-date rate for comparison; differences from FX movement are routed to FX gain/loss. See [FX revaluation](./fx-revaluation.md) for the bigger picture.

### Bulk-import bank statements

For multi-month catch-up: **Accounting → Bank reconciliation → Import statements**. Upload statements for several months; PettahPro parses and presents them ready to reconcile one at a time.

## What gets posted

Bank reconciliation itself doesn't post anything — it's a verification, not a transaction.

What posts:
- **Statement-only items you add to books** — each posts as its appropriate journal entry (bank charges, interest income, direct debits, etc.).
- **Corrections** — if reconciliation reveals an error in a previously posted transaction, the correction posts via a reverse-and-repost flow (don't edit posted entries).

The reconciliation document itself stays in PettahPro as a record: which statement was matched, what the variance was, what was added or corrected.

## FAQ

**My books balance and statement balance don't match by a tiny amount (a few hundred rupees) and I can't find why.**
First, check timing items — un-cleared cheques, deposits in transit. The match should be: books balance + outstanding withdrawals (un-cleared cheques) − outstanding deposits = statement balance.

If the math still doesn't work and the difference is small, post the variance to a **Cash over/short** account with a note. A persistent pattern of unexplained variance is a flag — investigate root cause.

**The bank's online statement format isn't supported.**
Standard formats are PDF, CSV, OFX. For odd formats, manually enter the statement transactions as you reconcile. Or contact support — adding a new statement format is usually quick.

**I reconciled but later realised one match was wrong.**
Re-open the reconciliation, unmatch the wrong pair, match correctly, re-close. The audit trail records the change.

**Can I reconcile across multiple periods at once?**
You can reconcile a multi-month range, but it's harder. Best practice: one reconciliation per statement (typically per month). Big multi-month reconciliations are usually a sign of falling behind — don't let that pattern persist.

**The statement closing balance and my books closing balance match but with different statements (e.g. our balances align but cheques are in different transit states).**
That happens — multiple paths to the same end balance. The reconciliation isn't really "match each transaction"; it's "after accounting for timing items, is the balance reconciled?" If yes, you're fine.

**Can I reconcile a credit-card account?**
Yes — credit cards work the same way. Books = your credit-card payable account; statement = the card issuer's statement. Match transactions, post any missing fees, reconcile to the statement closing balance.

## Related

- [Customer payments](../sell/customer-payments.md) and [Supplier payments](../buy/supplier-payments.md) — what hits the bank.
- [Cheques](./cheques.md) — the most common timing item.
- [FX revaluation](./fx-revaluation.md) — for foreign-currency bank accounts.
- [Period close](./period-lock.md) — reconciliation usually precedes period close.
