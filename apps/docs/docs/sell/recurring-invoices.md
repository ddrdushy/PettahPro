---
title: Recurring invoices
sidebar_position: 7
---

# Recurring invoices

## What it does

A recurring invoice template generates invoices on a schedule — monthly, quarterly, annually, or whatever cadence makes sense — without you having to recreate them each time. Common use cases:

- Monthly rent.
- Subscription / retainer fees.
- Maintenance contracts.
- Software licensing.
- Anything that repeats on a known schedule with the same shape.

PettahPro creates each invoice automatically on the schedule you set. Optionally it also emails the customer automatically. Optionally it auto-posts (rather than landing as a draft for review). The level of automation is up to you.

## Walkthrough

Open **Sell → Recurring invoices → + New recurring invoice**.

1. **Pick the customer**.
2. **Set the schedule:**
   - **Frequency** — monthly / quarterly / annually / custom.
   - **Start date** — when the first invoice generates.
   - **End date** (optional) — when to stop. Leave blank for "forever until cancelled".
   - **Day of month** — for monthly schedules, which date in the month (e.g. always on the 1st).
3. **Add the line items** — same shape as a regular invoice. Item, quantity, unit price, tax code.
4. **Set the automation level:**
   - **Generate as draft** — invoices land in your drafts; you review and post manually.
   - **Auto-post** — invoices generate and post automatically on the date.
   - **Auto-post and email** — invoice posts and is emailed to the customer the same day.
5. **Save**.

The first invoice generates on the start date. Subsequent invoices generate on the schedule until the end date (if any) or until you cancel the template.

## Common tasks

### Set up monthly rent

Frequency = monthly, day = 1, lines = "Rent — \[property\]", auto-post and email. From the start date forward, the customer gets an invoice on the 1st of every month with no further effort from you.

### Pause a recurring invoice temporarily

Open the template → **Pause**. Invoices stop generating until you resume. Useful when the customer's contract is on hold (e.g. building under renovation, customer travelling, etc.).

### End a recurring invoice

Open the template → **End**. Set the end date to the most recent past month. No further invoices generate. The template stays for audit trail.

### Update the price for next cycle

Open the template → **Edit** → change the line price. The change applies to **future** invoices. Already-posted invoices keep their original price.

### See what's scheduled to generate next

The recurring invoices list shows **Next generation** for each template. Sort by that to see what's coming up. Useful at month-end to forecast the AR that's about to be created.

### Customer wants to be invoiced quarterly instead of monthly

Open the template → **Edit** → change Frequency to quarterly. The next generation date adjusts. Already-posted invoices stay; future generations follow the new schedule.

### Generate this month's invoices early

If you want to generate ahead of schedule (e.g. customer requested an early invoice), click **Generate now** on the template. It creates the invoice immediately, dated whatever you pick. Doesn't affect the schedule for future generations.

## What gets posted

A generated recurring invoice posts the same way as a regular invoice — same journal entry, same VAT handling, same stock effects (if any). The only difference is **when** and **how** the invoice was created.

Templates themselves don't post anything. They're just the recipe.

## FAQ

**My customer's contract has variable amounts each month. Can I still use recurring?**
If the variation is small or rule-based, yes. Set the template with the base lines; auto-generate as **draft** rather than auto-post; review and adjust each month before posting. If the variation is structural (different items each month), recurring isn't the right tool — just create regular invoices.

**The customer disputed an auto-emailed invoice — what now?**
Issue a credit note to reverse it (or part of it). Update the template if the disputed price was wrong, so future invoices are correct. Auto-posting works well 95% of the time and adjusts via credit notes when it doesn't.

**What happens if I'm away when the invoice is due to generate?**
Auto-generation runs without you. Invoices generate on schedule whether you're logged in or not. That's the point.

**Can I have a recurring invoice with a one-time setup fee on the first one?**
Yes — the first generated invoice can include a "First-only" line. On the template, mark a line as **First period only** and it'll appear on the first invoice but not subsequent ones.

**The customer's terms changed mid-contract. Should I edit the template or end and create a new one?**
For minor changes (price adjustment, item swap), edit the template — applies from the next generation onwards. For major changes (different contract structure entirely), end the existing template and create a new one. Audit trail is cleaner that way.

**Can recurring templates be tied to the customer portal?**
Yes — the portal shows the customer's recurring invoices and the next generation date. Useful for customers who want to know what's coming.

## Related

- [Invoices](./invoices.md) — what gets generated.
- [Customer payments](./customer-payments.md) — settling the auto-generated invoices.
- [Buy → Recurring bills](../buy/bills.md) — the supplier-side equivalent.
- **Customer portal** — customers can see their recurring schedule.
