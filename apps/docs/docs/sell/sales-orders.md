---
title: Sales orders
sidebar_position: 3
---

# Sales orders

## What it does

A sales order is the customer's confirmed order before you fulfil it. Where a quotation is "this is what it would cost", a sales order is "yes, please send this". For businesses where there's a real gap between order and delivery — manufacturing, custom work, large stock items, multiple-shipment orders — the sales order tracks what's been ordered, what's been delivered, and what's still owing.

Sales orders don't post to your books. Like quotations, they commit nothing — until you fulfil and invoice.

If your business goes straight from order to invoice with no fulfilment gap, you can skip sales orders entirely and just create invoices directly.

## Walkthrough

Open **Sell → Sales orders → + New sales order**.

1. **Pick a customer**.
2. **Set the order date and expected delivery date**.
3. **Add line items** — item, quantity, unit price, tax code.
4. **Optional: link to a quotation** — if this order accepts a previous quote, picking the quote auto-fills the lines.
5. **Save as draft** or **Confirm**. Confirming locks the order against further customer changes (you can still cancel and reissue if you need to).

Once confirmed, the sales order becomes the reference for everything that follows: delivery notes when goods leave, invoices when you bill, partial delivery tracking on the order itself.

## Common tasks

### Convert from a quotation

The cleanest path. Open the accepted quotation → **Convert to sales order**. Lines copy across; you adjust if needed and confirm.

### Track partial fulfilment

Open the sales order. The order shows committed quantities (what was ordered) vs. delivered quantities (what's been shipped via delivery notes) vs. invoiced quantities (what's been billed). The order stays **Open** until everything's delivered and invoiced; **Closed** when fully done.

### Generate a delivery note

When goods are ready to ship, click **Create delivery note** on the order. PettahPro creates a delivery note pre-filled with the unfulfilled lines; you confirm quantities (some lines may ship today, others later) and post the delivery note.

### Generate an invoice

Two options:
- **Bill on delivery** — invoice for each delivery as it ships. Click **Create invoice** on the delivery note.
- **Bill at the end** — fulfil all deliveries first, then invoice once for everything. Click **Create invoice** on the sales order itself.

### Cancel a sales order

If the customer cancels before fulfilment, mark the order **Cancelled**. Anything already delivered (and invoiced) stays — you'd issue a credit note for those if returning. Future fulfilment stops.

### See the sales pipeline

The sales orders list, filtered to **Status = Open** and sorted by **Expected delivery**, is your fulfilment pipeline. Anything past its expected delivery date with undelivered quantity is overdue — chase production / inventory / shipping.

### Adjust an open order

Customer wants to change quantities mid-stream. Open the order → **Edit**. PettahPro warns you about anything that's already been delivered or invoiced (those parts can't change). The unfulfilled portion can be adjusted; the order's totals re-compute.

## What gets posted

**Nothing.** Sales orders are commitments, not transactions. They don't post to your books.

What gets recorded:
- The sales order as a numbered document with audit trail.
- Status (Draft / Confirmed / Open / Closed / Cancelled).
- Linked quotation, delivery notes, and invoices for traceability.
- Fulfilment progress (committed vs. delivered vs. invoiced quantities).

## FAQ

**Do I have to use sales orders if I'm using quotations and invoices?**
No. Quotations → invoice is a perfectly valid two-step flow for businesses that don't have a fulfilment gap. Sales orders are for the middle case: you've taken the order but haven't yet shipped or billed. If your sales process is simpler than that, skip them.

**An order has been "Open" for months — what should I do?**
Either fulfil it, cancel it, or close it. Long-open orders cause noise on the pipeline view. Cancelled orders stay in the audit trail; closed orders mean "we considered this done even though it wasn't fully delivered".

**Customer ordered 100, you delivered 95, the missing 5 is on backorder. How does the system show that?**
The order stays **Open** with 5 units unfulfilled. The pipeline view shows it as overdue (assuming the expected delivery date has passed). When the 5 ship, you create another delivery note for 5; the order then closes.

**Can a sales order include service items?**
Yes. The fulfilment tracking still applies — the service is "delivered" when you've performed it, "invoiced" when you've billed for it. For pure project work, this is often better than going straight to an invoice because you can track partial completion.

**Two sales orders for the same customer — should I merge them?**
Generally no — keep them separate. Each represents a distinct order with its own dates and references. You can invoice both on a single combined invoice if the customer wants that, but the sales orders stay as two records.

**Can sales order numbers be sequential per customer?**
By default they're sequential across all customers. For per-customer numbering, set up a per-customer number series in **Settings → Number series**.

## Related

- [Quotations](./quotations.md) — the step before.
- [Delivery notes](./delivery-notes.md) — recording shipments.
- [Invoices](./invoices.md) — billing for delivered goods.
- **Sales pipeline** — the open-orders view.
