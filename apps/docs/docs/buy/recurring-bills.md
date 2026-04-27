---
title: Recurring bills
sidebar_position: 6
---

# Recurring bills

## What it does

A recurring bill template generates supplier bills on a schedule — without you having to recreate them each time. The buy-side mirror of recurring invoices. Common use cases:

- Monthly office rent (you receive a bill for the same amount on the same day every month).
- Software subscriptions where the supplier always charges the same amount.
- Utility bills with a fixed component.
- Maintenance contracts.

PettahPro creates each bill as a **draft** on the schedule (default behaviour) — you review, adjust if the actual amount is different, and post. Auto-posting is also available if you want zero touch.

## Walkthrough

Open **Buy → Recurring bills → + New recurring bill**.

1. **Pick the supplier**.
2. **Set the schedule:**
   - **Frequency** — monthly / quarterly / annually / custom.
   - **Start date** — when the first bill generates.
   - **End date** (optional).
   - **Day of month** — for monthly, which day (e.g. always on the 1st).
3. **Add line items**.
4. **Set the automation level:**
   - **Generate as draft** (default) — bill lands in your drafts; you review and post.
   - **Auto-post** — bill posts automatically on the date.
5. **Save**.

The first bill generates on the start date. Subsequent bills generate on the schedule until end date (if any) or you cancel the template.

## Common tasks

### Set up monthly office rent

Frequency = monthly, day = 1, lines = "Office rent — \[location\]", auto-post. Every month the bill generates and posts; you only revisit if the rent changes.

### Pause a recurring bill

Open the template → **Pause**. Bills stop generating until resumed. Useful when a contract is on hold.

### Update the amount for the next cycle

Open the template → **Edit** → change the line amount. Future generations use the new amount; already-posted bills keep their original amount.

### See what's about to generate

The recurring bills list shows **Next generation date**. Sort by it to see the upcoming bills. Useful for end-of-month cash forecasting.

### Drafts that need review

If you've set the template to generate-as-draft, the **Buy → Bills → Drafts** tab will show the auto-generated drafts each cycle. Review the amount, adjust if the actual bill differs, post.

### Generate ahead of schedule

Click **Generate now** on the template. Creates the bill immediately, regardless of the schedule. The schedule continues for future generations.

## What gets posted

A generated recurring bill posts the same way as a regular bill — same journal entry, same VAT handling, same stock effects. The only difference is **how** the bill was created.

Templates themselves don't post anything.

## FAQ

**My utility bills vary each month — is recurring still useful?**
Yes — set the template to generate-as-draft, with an estimated amount. Each month, the draft appears; you adjust the actual amount from the supplier's bill, then post. Saves you from typing the supplier and lines from scratch.

**The supplier increased the rent — do I edit the template or end and create a new one?**
For a price change, edit the template. For a structural change (different items, added charges), end and create new — keeps the audit trail cleaner.

**A recurring bill auto-posted but the supplier hasn't actually billed me yet.**
Auto-post is only safe when the supplier reliably bills the same amount on the same day. If the supplier sometimes bills late or in different amounts, use generate-as-draft instead — drafts can sit until you have the actual bill in hand.

**Can recurring bills generate purchase orders too?**
Not directly — recurring is for the bill side only. If you need recurring POs as well, set up a separate recurring PO template (in the PO module) on the same schedule. Most businesses don't bother for recurring fixed-cost things — they don't really need a PO.

**A bill auto-posted, but the actual amount was different. What now?**
Issue a debit note (if the auto-posted amount was too high) or post a new bill for the difference (if too low). The recurring template keeps generating; consider adjusting the amount on the template if the variance is structural.

**Can I have a one-time setup line on the first bill?**
Yes — mark a line as **First period only** and it'll appear on the first bill but not subsequent ones.

## Related

- [Bills](./bills.md) — what gets generated.
- [Supplier payments](./supplier-payments.md) — settling recurring bills.
- [Sell → Recurring invoices](../sell/recurring-invoices.md) — the customer-side equivalent.
