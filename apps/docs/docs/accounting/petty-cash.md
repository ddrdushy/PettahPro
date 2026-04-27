---
title: Petty cash
sidebar_position: 8
---

# Petty cash

## What it does

Petty cash is the small amount of physical cash you keep on hand at the office for everyday small expenses — paper, parking, snacks for visitors, taxi fares for staff. It's typically a small float (5,000 to 50,000 depending on the business) that sits in a locked drawer or box, with someone (the **petty cash custodian**) accountable for it.

PettahPro tracks petty cash like any other cash account, with workflows for the typical petty-cash patterns: float top-ups, expense vouchers, periodic reconciliation.

For a fully cashless business, you don't need petty cash. For most SL SMEs, having some cash on hand is just practical — and if you have it, you should track it.

## Walkthrough

### Setting up the petty cash account

Open **Accounting → Chart of accounts → + New account**.

- **Section** — Asset.
- **Type** — Cash.
- **Code** — pick a free number (e.g. 1020).
- **Name** — "Petty cash" (or "Petty cash — \[location\]" if you have multiple).

The account appears in your chart and is selectable on payment screens.

### The initial float

The first time, you transfer some cash from your bank into the petty-cash drawer. Record this in PettahPro as a transfer:

**Accounting → Cash transfers → Bank → Petty cash, amount 10,000.**

| Account | Debit | Credit |
|---|---|---|
| Petty cash | 10,000 | |
| Bank | | 10,000 |

Now your petty-cash account has a 10,000 balance, matching what's physically in the drawer.

### Recording an expense

Someone takes 500 from petty cash for stationery. Two ways to record:

**Inline (simplest):** Post the expense as a payment from the petty-cash account.

| Account | Debit | Credit |
|---|---|---|
| Stationery expense | 500 | |
| Petty cash | | 500 |

Petty cash drops to 9,500. The receipt for the stationery should be filed (digitally or physically) for audit.

**Via a voucher (more controlled):** Use **Accounting → Petty cash → + New voucher**. Captures who took the cash, the date, the purpose, the receipt photo, the manager who approved (if you require approval). The voucher then posts the same journal but with a stronger paper trail.

For businesses with audit requirements or larger petty-cash floats, the voucher flow is much better.

### Topping up the float

Petty cash drops as expenses come out. When it gets low, the custodian gets a top-up from the bank:

**Accounting → Cash transfers → Bank → Petty cash, amount 5,000.**

Brings the float back up. A common pattern is to **top up to a fixed amount** — say, always restore to 10,000. The size of the top-up varies based on what's been spent.

### Periodic reconciliation

Monthly (or weekly for higher-volume businesses), the custodian counts the cash in the drawer. **Accounting → Petty cash → Reconcile**.

Enter the **actual count**. PettahPro shows what the books say should be there. If they match, post the reconciliation — done.

If they don't match (variance):
- **Investigate** — check for missed vouchers, receipts that weren't recorded, errors.
- **Accept the variance** — post the difference to a "Cash over/short" account. Small variances are normal.
- **Larger variances** — investigate before posting; talk to the custodian.

## Common tasks

### Multiple petty-cash boxes

Each branch has its own petty-cash drawer with its own custodian. Set up a separate petty-cash account per location — "Petty cash — Colombo", "Petty cash — Kandy". Each has its own balance, its own custodian, its own reconciliation.

### Approve high-value vouchers

For businesses where petty-cash usage is monitored: turn on **Settings → Approvals → Petty cash voucher**. Vouchers above a chosen threshold (e.g. 1,000) need approval from a designated manager before posting.

### Generate a petty-cash report

**Reports → Petty cash → \[period\]** shows: opening balance, every voucher / top-up in the period, closing balance, and any reconciliation variances. Useful for monthly review with the custodian.

### Custodian handover

When the petty-cash custodian changes (someone leaves, role rotation), do a reconciliation on the spot — count the cash, post any variance, file the reconciliation report. The new custodian inherits the balance with a clean baseline.

### Cash on hand vs petty cash

These are two different concepts:
- **Petty cash** is the small office float for incidental expenses.
- **Cash on hand** is broader — could include the till at a POS terminal, money in transit between branches, etc.

In your chart of accounts, you can have both. Most SMEs only need one or the other (often "Cash on hand" covers both informally for smaller businesses).

## What gets posted

Petty-cash transactions post the same way as any other cash transaction, just against the petty-cash account instead of the bank account. The journal shape is what you'd expect — expense or transfer, debit and credit balanced.

The reconciliation step posts only the **variance** if there is one, not the full counted amount:

| Account | Debit | Credit |
|---|---|---|
| Cash over/short (P&L) | shortage | |
| Petty cash | | shortage |

(Or the reverse for a surplus.)

## FAQ

**My petty cash float is enormous (200,000+). Should it still be petty cash?**
Probably not — that's a real cash holding, not "petty". Track it as **Cash on hand** with the same care as a bank account: regular reconciliation, controlled access, audit trail. The "petty" in petty cash implies it's small enough that occasional 100-rupee variances aren't worth investigating.

**The custodian wants to make a payment to a supplier from petty cash.**
Use it for very small supplier bills (under, say, 5,000) where the formality of a normal supplier-payment isn't worth it. For anything larger, route through the proper supplier-payment flow against the bank account. Mixing operational supplier payments and petty-cash drains makes both messier.

**Receipts for petty-cash expenses keep getting lost.**
Cultural / process issue, not a system one. The voucher flow with photo upload reduces the problem — even if the paper receipt is lost, there's a digital copy on the voucher. Make uploading the receipt part of the voucher workflow.

**Can the petty cash account go negative?**
PettahPro will let you (with a warning), but it shouldn't — physically you can't have negative cash in a drawer. A negative balance means you've recorded more expenses than you actually had cash for; usually a mistake. Investigate and correct before continuing.

**What about petty cash for staff travel advances?**
That's a different pattern — staff take a travel advance, spend it, return the unused portion + receipts. Use **HR → Staff loans / advances** for that, not petty cash. Petty cash is for office incidentals, not personal advances.

## Related

- [Chart of accounts](./chart-of-accounts.md) — set up the petty cash account.
- [Cheques](./cheques.md) and [Bank reconciliation](./bank-reconciliation.md) — for the bank-account side of things.
- [HR → Expense claims](../hr/payroll.md) — for staff reimbursements (different flow).
- **Cash transfers** — for top-ups between bank and petty cash.
