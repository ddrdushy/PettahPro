---
title: Proforma invoices
sidebar_position: 8
---

# Proforma invoices

## What it does

A proforma invoice is a "what the invoice will look like" document — it shows items, prices, taxes, and the total exactly like a real invoice, but it doesn't post to your books. It's a non-committal preview.

Common use cases:

- Customer needs an itemised document to get internal purchase approval before they commit.
- The customer's bank wants a proforma to release funds for an advance payment.
- Import paperwork — customs, freight forwarders often request a proforma.
- Visa or financial-statement contexts where the customer needs to show "this is what they'll be charging me".

A proforma is closer to a quotation than to an invoice. The difference is the format — a proforma looks like a real invoice (with "PROFORMA" stamped on it), where a quotation looks like a price proposal.

## Walkthrough

Open **Sell → Proforma invoices → + New proforma**.

1. **Pick a customer**.
2. **Set the proforma date and validity date**.
3. **Add line items** — same shape as on a regular invoice.
4. **Save and Send** to generate the PDF and email it to the customer.

The PDF says **PROFORMA INVOICE** prominently — so customs / banks / accounts teams don't mistake it for the real thing.

## Common tasks

### Convert a proforma to an invoice

Customer is ready to commit. Open the proforma → **Convert to invoice**. Lines copy across; you confirm and post. The proforma stays in the audit trail with a link to the converted invoice.

### Convert via a sales order

For longer-cycle deals, convert the proforma to a sales order first, then later to delivery notes and invoices as fulfilment happens. Gives you an intermediate fulfilment-tracking step.

### Resend a proforma

Customer says they didn't get it. Click **Send** again. The same PDF goes out (you can also adjust the email subject / body before sending if needed).

### Update prices and reissue

The validity has expired and prices have changed. Don't edit the original proforma — issue a **new proforma** with current prices, and (optionally) mark the old one as **Superseded**.

### Cancel a proforma

If the deal is dead, mark the proforma **Cancelled**. Keeps it in the audit trail; doesn't generate noise on the open-proforma list.

### Use the proforma format for a deposit invoice

Some businesses use proformas to request advance payments — "send 50% to start". You can do this two ways:

1. **Proforma showing the full price**, customer pays 50% based on the proforma, you post a real invoice for 50% (with a note that 50% is a deposit), the remaining 50% goes on the next real invoice when goods ship.
2. **Real invoice for the deposit only**, no proforma needed.

Option 2 is cleaner accounting-wise; option 1 is sometimes what customers expect because their internal process needs a "full quote" document.

## What gets posted

**Nothing.** Proformas are non-committal; they don't move any account.

What gets recorded:
- The proforma as a numbered document with audit trail.
- Status (Draft / Sent / Converted / Cancelled / Superseded).
- The link to any invoice or sales order it converts into.

## FAQ

**Quotation or proforma — which should I use?**
Use whichever the customer asks for. The conventions vary: in B2B sales workflows, "quotation" is more common; for export, customs, and bank-related contexts, "proforma invoice" is the standard term. Functionally they're nearly the same — both are non-posting price proposals.

**Can a proforma include VAT?**
Yes — the proforma shows VAT just like a real invoice would. The customer sees the full landed cost including VAT, which is usually what they need. (No VAT is actually collected because nothing posts.)

**The customer paid against the proforma — what now?**
Take the payment as an **unallocated customer payment**. Then convert the proforma to a real invoice; allocate the payment against the invoice when posting. Books are now correct.

**Can a proforma cross periods?**
Doesn't matter — proformas don't post, so periods don't apply to them. The converted invoice has its own date which determines the period it lands in.

**Can I email a proforma in the customer's currency?**
Yes — pick the currency on the header. The PDF shows the proforma in that currency, which is typically what customs / banks need to see.

**Customer's bank rejected the proforma because it didn't have a "proforma reference number" they wanted.**
Add a free-text reference field on the proforma (in the notes section) with whatever reference the bank needs. Or customise the proforma template to include a specific field for this — **Settings → Document templates → Proforma**.

## Related

- [Invoices](./invoices.md) — what proformas convert to.
- [Quotations](./quotations.md) — the close cousin (different format, same purpose).
- **Customer payments** — handling deposits paid against a proforma.
- [Settings → Document templates](../settings/overview.md) — customise the proforma PDF.
