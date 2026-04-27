---
title: Delivery notes
sidebar_position: 4
---

# Delivery notes

## What it does

A delivery note records goods physically leaving your warehouse to a customer — separately from the invoice. The point is to keep stock movements honest and traceable: stock goes down when goods ship, regardless of when you bill.

For businesses that ship before billing (a common pattern in B2B), delivery notes are essential. The driver hands one to the customer at delivery; the customer signs to confirm receipt; that signed copy is your evidence the goods got there.

Delivery notes are stock-movement documents — they reduce inventory but don't post to revenue or AR until the matching invoice posts.

## Walkthrough

Open **Sell → Delivery notes → + New delivery note**.

1. **Pick a customer**.
2. **Pick a sales order** (optional but common) — or work from scratch.
3. **Set the delivery date** and the **delivery address** (defaults to the customer's address).
4. **Add line items** — item and quantity. Pricing isn't relevant on a delivery note (that's the invoice's job).
5. **Add notes** — driver name, vehicle, special instructions.
6. **Save as draft** or **Post**.

Posting reduces stock for each delivered item and generates the delivery note PDF for the driver to take.

## Common tasks

### Generate from a sales order

If goods are leaving against an open sales order, this is the cleanest path. Open the SO → **Create delivery note** → confirm quantities (some lines may ship today, others later) → post.

### Send goods without a sales order

You don't have to use sales orders. Create a delivery note directly with the customer and items; post; ship; invoice when you're ready.

### Convert to invoice

After delivery, click **Create invoice** on the delivery note. The invoice picks up the delivered lines with prices from the customer / item defaults; you confirm and post.

### Multi-shipment orders

A single sales order can have multiple delivery notes — one per shipment. Each delivery note ships and reduces stock for its own quantities. The sales order tracks fulfilment progress.

### Driver signature flow

Print the delivery note. The driver takes it; the customer signs at delivery; the signed copy returns to your office. **Mark as delivered** on the delivery note and (optionally) attach a scan of the signed copy. The audit trail then shows confirmed delivery.

### Reject a delivery (customer didn't accept goods)

Customer rejected the shipment at the door. The delivery note stays in the audit trail; **reverse** it to put the stock back. Investigate why (wrong items, damaged goods, address mismatch) before reshipping.

### Driver loses the delivery note

Reprint from the system. The delivery note number is the same; the system records that a reprint was requested.

## What gets posted

A posted delivery note moves **stock only**:

| Account | Debit | Credit |
|---|---|---|
| (no entry to the GL) | | |

Wait — that's not quite right. Stock movements happen in the inventory ledger; they don't hit the GL until the invoice posts. The delivery note's effect is:

- Stock goes down on the inventory ledger by the delivered quantity.
- A "shipped, not yet invoiced" balance appears for tracking purposes (cleared when the invoice posts).

If your books expect deliveries to post COGS at delivery (rather than at invoice), there's a setting in **Settings → Inventory → Cost recognition** to flip the behaviour. Most SMEs leave it at the default (COGS posts at invoice).

## FAQ

**A delivery shipped but no invoice has been raised — is that money I've earned?**
Yes, you've earned it (the goods are out the door), but the GL doesn't know yet — that happens when the invoice posts. The "shipped, not yet invoiced" balance is the gap. The **Sales orders** report flags any SO with deliveries that haven't been invoiced.

**Can I deliver more than the sales order quantity?**
Yes, but PettahPro will warn — usually it means a mistake. If you genuinely need to (e.g. supplier error means you actually have more to ship), confirm; the SO records the variance.

**Customer wants the delivery note to look different from our default.**
The delivery note PDF uses the active delivery-note template. Clone in **Settings → Document templates**, edit, set as active.

**Can a delivery note include service items?**
Services don't physically deliver, so the system mostly skips them on delivery notes — they appear on the invoice instead. If you've got a mixed product+service order, the delivery note shows just the products being shipped.

**Can two warehouses ship for the same delivery note?**
One delivery note = one source warehouse. For shipments from multiple warehouses, create one delivery note per warehouse; the sales order tracks fulfilment across both.

**Delivery is happening tomorrow but the system won't let me post for a future date.**
The delivery date is when the goods physically left/arrive. If you're posting in advance, use today's date and the actual delivery date as a separate "expected" field. Or post tomorrow.

## Related

- [Sales orders](./sales-orders.md) — what most delivery notes are generated against.
- [Invoices](./invoices.md) — what delivery notes convert to.
- **Stock movements** — see the inventory ledger entries.
- [Settings → Document templates](../settings/overview.md) — customise the delivery note PDF.
