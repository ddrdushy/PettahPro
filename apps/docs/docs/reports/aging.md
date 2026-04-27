---
title: AR & AP aging
sidebar_position: 7
---

# AR & AP aging

## What it does

Aging reports take your unpaid invoices (AR aging) and unpaid bills (AP aging) and bucket them by how long they've been outstanding — current, 1–30 days overdue, 31–60, 61–90, 90+. They turn a single number on the trial balance ("AR balance: 5.2 million") into a story ("but 1.5 million of it is over 90 days overdue").

AR aging is your collections tool — who hasn't paid, how late are they, who needs chasing first.

AP aging is your cash discipline tool — who you owe, how soon you need to pay, who's about to go past terms.

Together they're the two reports a healthy SME runs every Monday.

## How to read it

Open **Reports → AR aging** (or **Reports → AP aging**) and pick:

- **As at** date — defaults to today.
- **Aging buckets** — defaults to Current / 1–30 / 31–60 / 61–90 / 90+. You can adjust.

The report shows one row per customer (AR) or supplier (AP), with:

- **Name**.
- **Total outstanding** — sum of all unpaid invoices/bills.
- **Current** — not yet due (i.e. the due date is still in the future).
- **1–30 / 31–60 / 61–90 / 90+** — overdue buckets.
- **Credit limit** (AR only) — the customer's limit, if set.

The bottom row is the grand total per bucket — useful for assessing the health of the whole portfolio.

You can drill into any row to see the individual invoices/bills that make up the balance, with each one's due date and overdue days.

## Common tasks

### Run a collections call list

AR aging filtered to **31+ days overdue**, sorted by balance descending, exported to Excel = your call list. Top of the list is who you call first. Each row clicks through to the customer's account so you can see what to discuss.

### Send statements to overdue customers

From the AR aging, multi-select the overdue customers and click **Send statement**. Each customer gets an email with a PDF statement listing every unpaid invoice and the total they owe. Cleaner than sending each invoice individually.

### Plan the week's supplier payments

AP aging filtered to **Current + 1–30 days** is your "due-soon" list. Sort by due date ascending. You know what to pay this week to stay on terms with everyone. Click any supplier to drill into their bills and select what to pay.

### Review aging trend over time

The aging snapshot is at a date — but the trend tells the bigger story. Pick **Compare with** and a prior date (e.g. 30 days ago). The report adds variance columns showing whether each bucket grew or shrank. A growing 90+ bucket is a warning sign — collections are slowing down and bad debts are likely.

### Adjust the bucket sizes

Aging buckets default to Current / 1–30 / 31–60 / 61–90 / 90+. If your terms are 60 days, you might want Current / 1–60 / 61–120 / 120+. Adjust in **Reports → AR aging → Settings**.

### Export for the auditor

Both AR and AP aging are standard auditor requests at year-end. Export to Excel, attach to closing documentation. The PDF version is also useful for board reports.

### Identify customers near their credit limit

AR aging shows current balance vs. credit limit per customer. Anyone whose total outstanding is above their limit is highlighted in red — typically a sign that someone is selling more on credit than the policy allows. Either tighten collections, raise the limit, or stop new sales.

## What it draws from

| Source | What it contributes |
|---|---|
| Posted invoices (open balance) | AR aging — bucketed by due date |
| Customer payments (allocated) | Reduce open invoice balances |
| Posted credit notes | Reduce AR balances |
| Posted bills (open balance) | AP aging — bucketed by due date |
| Supplier payments | Reduce open bill balances |
| Posted debit notes | Reduce AP balances |

A document is "open" if it hasn't been fully paid (or fully credited). "Days overdue" is calculated from the document's **due date**, not the document date.

Drafts and unposted documents don't count.

## FAQ

**The aging report says a customer owes me money but they say they paid.**
Check three things: (a) was the payment posted in PettahPro, or just deposited in the bank without recording it? (b) was the payment **allocated** to the right invoice, or sitting unallocated? (c) does the customer's record on the supplier's side actually match this invoice?

Most "phantom debt" cases are unposted or unallocated payments.

**How does aging handle partial payments?**
The remaining unpaid balance ages from the original due date. If a customer paid 60% of a 100k invoice on time and the rest is now 45 days overdue, the 40k remainder shows in the 31–60 bucket.

**A customer paid in advance — they show as a credit balance. How does that age?**
Credits don't age — they're not overdue, they're a deposit. They show on the report as a negative balance under **Credits**, separate from the aging buckets.

**Can aging include FX-revalued balances?**
Yes. If you have foreign-currency invoices, the report can show the LKR-equivalent at the as-at date's FX rate. Toggle **Revalue at as-at date**. Useful at year-end for the formal statement.

**Why does my AR total on the aging not match the AR account on the trial balance?**
They should match. If they don't: (a) make sure the as-at date is the same; (b) check for unallocated payments (they reduce the AR account but don't appear on aging until allocated); (c) run **Bank reconciliation** to catch any open items.

**The collections call list is too long to be useful.**
Filter it. Most SMEs work the call list as: 90+ first, then 61–90, then 31–60. Anything under 30 days is usually not worth chasing — they'll come in. Sorting by balance descending also helps focus on the few customers carrying most of the risk.

## Related

- [Sell → Invoices](../sell/invoices.md) — generates AR.
- [Buy → Bills](../buy/bills.md) — generates AP.
- **Customer payments** — clears AR.
- **Supplier payments** — clears AP.
- **Customer statements** — bulk-send statements to overdue customers.
- [Trial balance](./trial-balance.md) — should match the aging total.
