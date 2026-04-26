---
title: Invoices
sidebar_position: 1
---

# Invoices

## What it does

A sales invoice is the document that records what you've sold, charges VAT, and creates a balance against your customer until they pay. It's the busiest object in PettahPro — most of the other selling documents are either drafts of an invoice (quotation, sales order) or its reverse (credit note).

PettahPro's invoice handles stock and non-stock items on the same document, calculates the tax for you, supports invoicing in any currency (with your books staying in LKR), and gives you both email and print options for sending it.

## Walkthrough

Open **Sell → Invoices → + New invoice**.

1. **Pick a customer.** Their default payment terms, currency, and any saved tax exemptions fill in automatically. If they're set up with a credit limit and this invoice would push them over it, you'll get a warning when you post.
2. **Set the invoice date and due date.** The due date defaults to *invoice date + their payment terms*. Override either if you need to.
3. **Add line items.**
   - Click **+ Add line**, type the item name or code to search, and pick it.
   - Quantity defaults to 1. Unit price comes from the item's default sell price; tax is set to the item's default tax code. Both can be changed on the line.
   - For stock-tracked products, the line shows current available stock. If the line would put you into negative stock, you'll see a warning (the post still goes through unless you've enabled "Block negative stock" in settings).
4. **Optional: charges and discounts.**
   - **Document discount** is spread across all the lines proportionally.
   - **Other charges** (delivery, handling, etc.) are added on top.
5. **Save as draft** to keep working on it later, or **Post** to commit it to your books.

When you post, PettahPro:

- Allocates the next invoice number from your number series.
- Adds the total to the customer's outstanding balance and records the sale.
- For stock items, reduces inventory and records the cost of goods sold.
- Generates the PDF using your active invoice template.
- Locks the document — any further changes need to go through a credit note.

## Common tasks

### Email the invoice to the customer

Open the posted invoice → **Send**. The dialog pre-fills the customer's email, a default subject, and a default body (you can change these in **Settings → Notifications**). The email includes the PDF as an attachment, and a link to your customer portal where they can view it and pay online if you've enabled portal payments.

### Edit a posted invoice

Once an invoice is posted, you can't edit it — the books are locked to keep your accounting trustworthy. To correct a mistake:

- **Wrong amount or items:** issue a credit note for the original invoice, then create a new one with the right details. The credit note brings the customer's balance back to zero on the original.
- **Wrong customer or wrong date:** same approach — credit note + reissue.
- **Typo in the description only:** the PDF re-renders from the data each time, so changes to the description on a credit note won't fix the original PDF that's already been sent.

### Receive a payment against the invoice

On the invoice detail page, click **Receive payment**. That opens the payment screen with this invoice already selected. Pick the method, the bank account, and confirm the amount.

### Convert from a quotation or sales order

Open the quotation or sales order, click **Convert to invoice**. All the lines copy across and you land on a draft invoice for review before posting.

### Recurring invoices

For invoices that go out on the same schedule every month — rent, retainers, subscriptions — set up a **recurring invoice template** instead of creating each one by hand. PettahPro will post and email them on the schedule for you.

### Invoice in a foreign currency

Pick the currency on the invoice header. The line items and totals stay in the customer's currency. Your books, though, post in LKR — converted at the day's exchange rate. If the rate changes between when you invoice and when you're paid, the difference is automatically recorded as a small forex gain or loss when the payment lands.

## What gets posted

Every posted invoice creates a journal entry in your books. For a typical invoice with VAT, three things move:

| Account | Debit | Credit |
|---|---|---|
| Accounts receivable | Total (incl. VAT) | |
| Sales revenue | | Subtotal |
| VAT payable | | VAT amount |

Your customer balance goes up by the total. Your sales income goes up by the pre-VAT amount. The VAT collected sits in **VAT payable** until you remit it to Inland Revenue when you file.

If any of the items are stock-tracked, PettahPro adds two more lines for each one — recording the cost of the goods you just sold:

| Account | Debit | Credit |
|---|---|---|
| Cost of goods sold | Item cost × quantity | |
| Inventory | | Same |

That way your gross margin (sales − cost of goods sold) shows up correctly on the P&L without you having to do anything.

## FAQ

**Why can't I edit a posted invoice?**
Because that invoice has already affected your books. Editing it would silently change history and break the trial balance for any closed period it crosses. The audit-correct way to fix anything is to issue a credit note and reissue — the trail of "this happened, then it was corrected" is exactly what an auditor wants to see.

**The customer says they didn't get the invoice email.**
Check **Settings → Notifications → Outbound email log**. You'll see whether the email was sent successfully and whether the customer's mail server bounced it. Most "didn't get it" cases turn out to be a wrong address or an aggressive spam filter on their end.

**Can I bulk-post a batch of invoices?**
Not from the regular invoice screen — every invoice goes through a single-document review on purpose. If you need to import a batch (say, when migrating from another system), use the import tool at **Sell → Invoices → Import**. It posts each row separately and gives you a per-row success/failure report.

**My customer paid before I sent the invoice — what do I do?**
Receive the payment as an "unallocated" customer payment first. When you later post the invoice, allocate the existing payment to it. Until you do, the payment sits as a credit on their account.

**Can someone outside my business see my draft invoices?**
No. Drafts are visible only inside your own PettahPro account, and only to your team members whose role gives them invoice access. Drafts never appear on the customer portal and never post anything to your books.

## Related

- **Customer payments** — how to record money landing.
- **Credit notes** — for reversing or correcting a posted invoice.
- **Quotations** and **Sales orders** — pre-invoice steps if you use them.
- **Recurring invoices** — for invoices that repeat on a schedule.
- **Customer portal** — your customers' view of their invoices.
- [Document templates](../settings/overview.md) — customise how the PDF looks.
