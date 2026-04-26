---
title: Invoices
sidebar_position: 1
---

# Invoices

## Overview

A sales invoice is the document that books revenue, charges VAT, and creates an AR balance against a customer. It's the busiest object in the system — most other Sell-side documents are either drafts of an invoice (quotation, sales order) or its reverse (credit note). PettahPro's invoice supports stock and non-stock lines on the same document, automatic tax computation, multi-currency on the document with LKR on the ledger, and either email or print delivery.

## Walkthrough

Visit `/app/invoices/new`.

1. **Pick a customer.** The customer's payment terms, default currency, and any saved tax exemptions auto-fill. If the customer's credit limit is set and this invoice would breach it, you'll see a warning at post time.
2. **Set the invoice date and due date.** Due date defaults to *invoice date + payment terms*. Override either if needed.
3. **Add line items.**
   - Click **+ Add line**, search by name or SKU, pick the item.
   - Quantity defaults to 1. Unit price comes from the item's sell price; tax code from its default. Both are overridable per line.
   - For **stock-tracked products**, the line shows current available quantity. If you'd post negative stock, you'll see an inline warning (the post still goes through unless you've turned on **Block negative stock** in settings).
4. **Optional: charges and discounts.**
   - **Document discount** applies pro-rata across lines.
   - **Other charges** (delivery, handling) book to whatever income/expense account you map.
5. **Save as draft** to keep it editable, or **Post** to commit it.

Posting:

- Allocates a number from the active **invoice number series**.
- Books the journal entry (see Behind the scenes below).
- Relieves stock and books COGS for stock-tracked lines.
- Generates the PDF (rendered via the active **document template**).
- Locks the document — further changes require a credit note.

## Common tasks

### Email the invoice to the customer

Open the posted invoice → **Send**. The dialog pre-fills the customer's email and a default subject/body (configurable in Settings → Notifications). The email includes the PDF attachment and a link to the customer portal where the customer can view the invoice and pay online if you've enabled portal payments.

### Edit a posted invoice

You can't — posting is final. To correct an error:

- **Wrong amount or items:** issue a credit note for the original, then post a fresh invoice. The credit note nets the AR back to zero.
- **Wrong customer or date:** there's no shortcut. Same as above — credit + re-issue.
- **Typo in description only:** the PDF re-renders from the data each time, so changing the line description on the *credit note* won't fix the original PDF. If you've already sent it, you've sent it.

### Apply a payment

Go to `/app/payments/new` and allocate against the invoice (see [Customer payments](../sell/invoices)). Or, on the invoice detail page, click **Receive payment** — that opens the payment screen pre-allocated to this invoice.

### Convert from a quotation or sales order

Open the quotation/SO and click **Convert to invoice**. All lines copy across and you land on the new draft invoice for review before posting.

### Recurring invoices

For invoices that repeat on a schedule (rent, retainers, subscriptions): set up a [recurring invoice template](../sell/invoices) instead of creating each one by hand. The system posts on the schedule and emails the customer automatically.

### Multi-currency

Set the document currency on the invoice header. Lines stay in document currency; the **journal posts in LKR** at the invoice-date FX rate from the rate table. If FX changes between invoice and payment, the difference is booked as **forex gain/loss** when the payment posts. See [FX revaluation](../accounting/period-lock) for period-end revaluation of unpaid foreign-currency AR.

## Behind the scenes

### Journal entry on post

For a non-stock invoice with VAT:

```
DR  1100 Accounts receivable      [total inc. VAT]
    CR  4000 Sales revenue        [subtotal]
    CR  2100 VAT payable          [VAT]
```

If any line is stock-tracked, additionally per line:

```
DR  5000 Cost of goods sold       [item.buy_price × qty]
    CR  1200 Inventory            [same]
```

Other charges and discounts post to the accounts you've mapped on the charge type and the **discount given** account respectively.

### Tables touched

- `invoices` — header (one row).
- `invoice_lines` — one row per line.
- `journals` + `journal_lines` — the GL posting.
- `inventory_ledger` — one row per stock line with the issue movement.
- `documents_meta` — number-series allocation.
- `audit_events` — who posted, when, from what IP.

### What's enforced

- **Balanced journal.** The DR/CR totals must match — refused at post.
- **Period not locked.** Invoice date must fall in an open period.
- **Stock policy.** If "block negative stock" is on, stock-tracked lines must have quantity available.
- **Customer not on hold.** A customer can be flagged on hold (e.g. for non-payment); their invoices won't post until cleared.
- **Tax code valid as at invoice date.** Tax codes have effective-from/to dates so historical rates work correctly.

### Document template

The PDF is rendered through the **template engine** — see [Document templates](../settings/overview). The default is the *Classic invoice* template. You can clone it, edit the section composition, and set the clone as active without touching code.

## FAQ

**Why can't I edit a posted invoice?**
Because the journal it booked is part of your audited ledger. Editing would silently change historical balances and break the trial balance for any period the change crosses. Issue a credit note instead — that's the audit-correct path.

**The customer says they didn't get the email.**
Check Settings → Notifications → **Outbound email log**. You'll see whether the SMTP server accepted it, and whether the customer's mail server bounced it. Most "didn't get it" turns out to be a wrong address or a spam filter.

**Can I bulk-post invoices?**
Not from the UI — every invoice goes through the same single-document review flow on purpose. For programmatic bulk creation (e.g. importing from another system), use the invoice import on `/app/invoices/import` which posts each row in its own transaction and gives you a per-row success/failure report.

**Customer paid in advance — how do I handle that?**
Take the payment as an **unallocated customer payment**. When you later post the invoice, allocate the existing payment to it. Until then the payment sits as a credit balance on the customer's account.

**Are draft invoices visible to anyone?**
Only inside your own tenant — and only to users whose role has `sales.view` permission. Drafts never appear in any external-facing report and never post anything to the GL.

## Related modules

- [Customer payments](../sell/invoices) — how money landing closes the AR.
- [Credit notes](../sell/invoices) — reversing a posted invoice.
- [Quotations](../sell/invoices) and [Sales orders](../sell/invoices) — pre-invoice steps.
- [Recurring invoices](../sell/invoices) — schedule-driven posting.
- [Customer portal](../sell/invoices) — customer-facing view of their invoices.
- [Document templates](../settings/overview) — customise the PDF.
