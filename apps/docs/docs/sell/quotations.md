---
title: Quotations
sidebar_position: 2
---

# Quotations

## What it does

A quotation is a formal price offer you send to a customer before any sale is committed. It says "if you order this, this is what it'll cost". The customer accepts (or doesn't); if they accept, the quotation typically becomes a sales order or an invoice.

Quotations don't post to your books. They commit nothing — until the customer says yes and you turn the quotation into something that does post.

Common use cases:
- B2B sales where the customer needs an itemised price before they place the order.
- Tenders and proposals where you're competing on price.
- Project work where the scope and cost need agreement before work begins.

## Walkthrough

Open **Sell → Quotations → + New quotation**.

1. **Pick a customer.** Or click **+ New customer** to add one on the fly. (For prospects who aren't customers yet, you can use a placeholder customer record and convert later.)
2. **Set the quotation date and validity date.** Validity is when the price expires — the customer needs to accept by then or you may need to requote. 30 days is typical.
3. **Add line items** — same as on an invoice. Item, quantity, unit price, tax code.
4. **Add notes** — payment terms, delivery time, scope notes, anything the customer needs to know.
5. **Save as draft** to keep editing, or **Send** to mark it as issued.

Sending allocates a quotation number and generates the PDF. Email it to the customer (the **Send** button does this with one click) or download and send via WhatsApp / handshake / whatever your customer prefers.

## Common tasks

### Convert a quotation to an invoice

Customer says yes. Open the quotation → **Convert to invoice**. All lines copy across; you land on a draft invoice for review before posting.

### Convert to a sales order first

If you want the intermediate step (especially for orders that take time to fulfil), **Convert to sales order** instead. The sales order tracks fulfilment; you generate the invoice when goods are delivered.

### Send a follow-up

The quotations list shows status — Draft / Sent / Accepted / Rejected / Expired. For quotes that are Sent but haven't been actioned, click **Send reminder** to nudge the customer.

### Mark a quotation as won or lost

When the customer responds, mark the quote **Accepted** or **Rejected**. Helps with conversion-rate analysis later. **Reports → Quotation conversion** shows your win rate over time.

### Quote in a foreign currency

Pick the currency on the header. Lines stay in that currency on the PDF. If the customer accepts and you convert to invoice, the invoice inherits the currency.

### Use a quotation template

For products you quote often, save the line set as a template. **Quotations → Templates → + New template**. Reuse on future quotations to skip the line entry.

### Discount on the whole quotation

Set a **document discount** on the header — applied pro-rata across lines on the PDF and on the converted invoice.

## What gets posted

**Nothing.** Quotations are commitments, not transactions. No journal entry, no balance change, no stock movement. The whole point is to give the customer a price before anything happens to your books.

What gets recorded:
- The quotation as a numbered document, with full audit trail.
- Status changes (Draft → Sent → Accepted / Rejected) for conversion reporting.
- The link to any sales order or invoice it's converted into.

## FAQ

**The customer accepted three months ago and the price has changed since. Can I update the quotation?**
Don't edit a sent quotation — that breaks the audit trail. Either: (a) issue a new quotation with current prices and have them accept that one; or (b) convert the original to invoice but override the prices on the invoice (with a note for the customer explaining why).

**Can I run a quotation through approval before sending?**
Yes — turn on **Quotation approval** in **Settings → Approvals**. Quotes above a threshold need approval from a chosen role before they can be sent.

**My customer wants me to break the quote into "phase 1" and "phase 2".**
Two options. (1) Issue two separate quotations, one per phase. Cleaner for project tracking. (2) Use **sub-totals** on the lines — group lines under headings within the same quotation. Less paperwork but tracking each phase's status separately is harder.

**Customer wants the quote in their format, not ours.**
The quotation PDF uses the active **quotation template**. Clone it in **Settings → Document templates**, edit the layout, set the clone as active. Or use a per-customer template if specific customers always need a specific format.

**Can I see all open quotations?**
The list defaults to "Sent + Accepted" (in flight). Filter to **Status = Sent** for "still waiting on a decision". Filter to **Validity expiring this week** for chase-up priority.

**Two salespeople quoted the same customer different prices. How do I handle that?**
Both quotations exist in the system. Talk to the salespeople and decide which one stands; mark the other as **Rejected** with a note. Customer-facing, you'd send a corrected quotation if needed.

## Related

- [Invoices](./invoices.md) — what most quotations convert to.
- [Sales orders](./sales-orders.md) — the intermediate step for fulfilment tracking.
- **Recurring quotations** — for renewals (less common; usually you just keep the customer on the same terms).
- [Settings → Document templates](../settings/overview.md) — customise the quotation PDF.
