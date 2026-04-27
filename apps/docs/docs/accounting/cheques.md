---
title: Cheques
sidebar_position: 10
---

# Cheques

## What it does

Cheques are still everywhere in Sri Lankan business — supplier payments, customer payments, payroll, post-dated arrangements. Unlike instant payments (cash, bank transfer, mobile wallet), cheques have a lifecycle: written → deposited → cleared (or bounced). PettahPro tracks the whole flow so your books reflect when the money actually moves, not when the cheque was written.

The core distinction: **a cheque written today is not money out of your bank today.** It's a promise that will move money when it clears. Most accounting issues with cheques come from treating them as if they were instant — your bank balance ends up wrong.

## How cheques work in PettahPro

### Cheques you issue (paying suppliers / staff)

Three states:

1. **Issued** — you've written the cheque but it's still in your supplier's hands. Money is not yet out of your bank. PettahPro tracks the amount as **Cheques outstanding** rather than reducing the bank balance.
2. **Cleared** — the supplier has presented the cheque, the bank has debited your account. Money is now out. PettahPro moves the amount from "Cheques outstanding" to your bank.
3. **Cancelled / lost** — cheque is being voided. The "Cheques outstanding" reverses; you'd typically issue a replacement.

### Cheques you receive (customer payments)

Three states:

1. **Received** — customer gave you the cheque. It's not yet in your bank. PettahPro tracks the amount as **Cheques on hand**.
2. **Deposited** — you've taken the cheque to the bank. Status updates; money is "in transit".
3. **Cleared** — the bank confirms the cheque is good and the funds are in your account. PettahPro moves the amount from "Cheques on hand" to your bank.
4. **Bounced** — the cheque was returned. The "Cheques on hand" reverses; the customer's invoice goes back to unpaid; you typically chase the customer.

## Walkthrough

### Recording a cheque payment to a supplier

Open **Buy → Payments → + New payment**.

- Method = **Cheque**.
- Pick the bank account the cheque is drawn on.
- Enter the cheque number, the date you wrote the cheque, the amount.
- Allocate against the bill(s).
- Post.

PettahPro books the journal at issue:

| Account | Debit | Credit |
|---|---|---|
| Accounts payable | amount | |
| Cheques outstanding | | amount |

Bank balance is unchanged at this point (correct — you haven't actually paid yet).

When the cheque clears (you see the debit on the bank statement), open the payment → **Mark as cleared**. The journal posts:

| Account | Debit | Credit |
|---|---|---|
| Cheques outstanding | amount | |
| Bank — primary | | amount |

Now the bank reflects the actual debit.

### Recording a cheque from a customer

Open **Sell → Payments → + New payment**.

- Method = **Cheque**.
- Pick the bank account the cheque will be deposited to.
- Enter the cheque number, the cheque date (could be future for post-dated), the amount.
- The expected clearance date — typically 1–3 working days after deposit.
- Allocate against the invoice(s).
- Post.

PettahPro books at receive:

| Account | Debit | Credit |
|---|---|---|
| Cheques on hand | amount | |
| Accounts receivable | | amount |

When you deposit and the cheque clears, **Mark as cleared**:

| Account | Debit | Credit |
|---|---|---|
| Bank — primary | amount | |
| Cheques on hand | | amount |

If the cheque bounces, **Mark as bounced**:

| Account | Debit | Credit |
|---|---|---|
| Accounts receivable | amount | |
| Cheques on hand | | amount |

The original invoice is back to unpaid; you'd typically follow up with the customer.

## Common tasks

### Post-dated cheque from a customer

Customer hands you a cheque dated 30 days from now. Record at receive with the cheque date as the future date. Don't deposit until that date. PettahPro waits to mark cleared until the cheque date or later.

### Bulk cheque deposit

You collected ten cheques over the week and deposit them all on Friday. Open **Sell → Cheques on hand**, multi-select all the cheques, click **Deposit**. PettahPro generates a deposit slip; status on each cheque updates to Deposited.

### Cheque that's been on hand for too long

The "Cheques on hand" account shouldn't carry old balances. Run **Reports → Cheques on hand** sorted by age. Anything more than a couple of weeks is suspect — the cheque might be stale, lost, or forgotten in someone's drawer. Investigate.

### Cancelled cheque

You wrote a cheque, then the supplier returned it asking for a different payment method. **Mark as cancelled** on the supplier payment. The Cheques outstanding reverses; the bill goes back to unpaid. Issue a new payment via the new method.

### Bounce charge from your bank

When a customer's cheque bounces, your bank typically charges you 500–1,500 for the inconvenience. Post that as a separate bank-charge expense:

| Account | Debit | Credit |
|---|---|---|
| Bank charges | 1,000 | |
| Bank | | 1,000 |

You can then reclaim the bounce charge from the customer (post a journal adding 1,000 to their AR with description "Bounce charge"), or absorb it.

### Cheque register

**Reports → Cheque register** lists every cheque, with status, dates, amounts, and counterparty. Sort by status to see all open / cleared / bounced. Filter by bank account when you have multiple. Useful for end-of-period reviews.

## What gets posted

Summarised in the lifecycle diagrams above, but to make the pattern clear:

**The two-step flow** (issue → clear, or receive → clear) is what keeps your bank balance accurate to actual debits/credits, not to written/received intent. Without it, you'd see "Bank balance: 100,000" while a 90,000 cheque is sitting in a supplier's drawer waiting to be presented — your books say you have 100k but you really only have 10k available to spend.

The interim accounts ("Cheques outstanding", "Cheques on hand") are real assets / liabilities at the in-between stage:

- **Cheques outstanding** is a liability — you've committed to paying, the cheque is out there, the recipient could present at any time.
- **Cheques on hand** is an asset — a piece of paper with a promise to pay, potentially worth what it says, potentially worthless if it bounces.

## FAQ

**My supplier doesn't deposit cheques quickly. Should I treat the payment as cleared immediately?**
No — that defeats the point of the two-step flow. Your bank balance would overstate available cash. Mark cleared only when the bank statement shows the debit (or the bank confirms presentation). Trust the bank, not the recipient.

**A customer's cheque "cleared" weeks ago but the funds were reversed. What happened?**
Sounds like the bank initially credited you but then bounced after the fact (e.g. the cheque came back from the issuer's bank as unfunded a week later). Mark the original payment as **Bounced** with the late-bounce date. Books reverse; deal with the customer.

**Can I print cheques from PettahPro?**
There's a basic cheque-print layout for some bank cheque formats. Usually the actual physical cheque is hand-written or printed at the bank's pre-printed stock; PettahPro records the cheque number for reconciliation but doesn't typically produce the physical paper.

**Lost cheque book — what now?**
Notify your bank immediately. In PettahPro, mark every issued cheque from that book as **Stop payment requested** (a separate state). The bank should refuse any presented cheques with those numbers; if a fraudulent cheque does clear despite the stop, deal with the bank.

**The bank cleared a cheque on a different date than I marked it cleared.**
Edit the cleared date on the cheque (if the period is open). The bank statement is authoritative; reconcile against it.

**Do post-dated cheques sit in the system as a future-dated transaction?**
Yes — the cheque exists with its dated date, in "Received but not yet to be deposited" state. The clearing date is typically the cheque date plus a few days; PettahPro waits until then.

## Related

- [Customer payments](../sell/customer-payments.md) — receiving cheques.
- [Supplier payments](../buy/supplier-payments.md) — issuing cheques.
- [Bank reconciliation](./bank-reconciliation.md) — uncleared cheques are the most common reconciliation timing item.
- [Glossary — Cheque](../concepts/glossary.md#cheque) — short definition.
