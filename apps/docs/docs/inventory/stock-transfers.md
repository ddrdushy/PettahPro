---
title: Stock transfers
sidebar_position: 4
---

# Stock transfers

## What it does

A stock transfer moves inventory between two of your warehouses or locations — without involving a customer or a supplier. Stock leaves Warehouse A; the same stock arrives at Warehouse B; your overall stock value doesn't change, but the location-level balances do.

For a single-warehouse business, stock transfers don't apply. For multi-warehouse businesses (multiple branches, separate retail and warehouse locations, regional distribution centres), transfers are how you move inventory between them while keeping each location's stock count accurate.

A transfer is a stock movement, not a sale or a purchase. There's no revenue, no expense, no AR, no AP — just inventory shifting around inside the business.

## Walkthrough

Open **Inventory → Stock transfers → + New transfer**.

1. **Source warehouse** — where the stock is leaving from.
2. **Destination warehouse** — where the stock is arriving.
3. **Transfer date** — when the stock physically moves.
4. **Add line items** — item and quantity. Pricing isn't relevant on a transfer; it's a movement, not a sale.
5. **For batch- or serial-tracked items**, pick the specific batches / serials being transferred.
6. **Save as draft** or **Post**.

Posting reduces stock at the source warehouse and increases stock at the destination by the same quantities. The transfer document and PDF generate; you can print or email it as a "delivery note" between your own warehouses.

### In-transit handling

By default, the transfer is "instant" — stock moves immediately from source to destination. For real long-distance moves (Colombo → Jaffna by truck, taking three days), you might want to track the in-transit period:

- Turn on **In-transit tracking** in **Settings → Inventory → Stock transfers**.
- The transfer then has two posting steps: **Dispatch** (stock leaves source, goes to "Stock in transit") and **Receive** (stock leaves "in transit", arrives at destination).
- Between dispatch and receive, the stock is visible on neither warehouse but on the "Stock in transit" balance. Useful for spotting a transfer that left but never arrived.

## Common tasks

### Transfer goods between branches

Cleanest case. Source = Branch A, Destination = Branch B, lines = the items being moved. Post. Stock balance updates at both locations. Print the transfer doc for the truck driver.

### Transfer from warehouse to retail

For businesses with a back-warehouse and a sales floor, transfers move stock to the front when needed. Often done daily — the cashier needs more of an item, requests a transfer, the warehouse posts it.

### Receive a transfer that arrived with damage

In-transit tracking turned on. The dispatch posted; the truck arrives, but two of the three boxes are damaged. On **Receive**, enter actual received quantities (less than dispatched). The damaged units stay in the "in transit" balance until you decide:
- Write them off via a **stock adjustment** (insurance claim if applicable).
- Or send back to source (another transfer).

### Bulk transfer: rebalancing across locations

End of month, head office decides to redistribute stock. Use **Inventory → Stock transfers → Bulk** to create multiple transfers across multiple location pairs in one go. Saves clicking through the new-transfer screen 30 times.

### Reverse a transfer

If a transfer was posted by mistake, **Reverse**. Stock goes back to the source from the destination. Original transfer stays in the audit trail.

### Print transfer documents

The transfer PDF acts as the goods-movement document — the receiving warehouse signs it on arrival to confirm receipt. Print at dispatch; sign at receive; file. Standard internal logistics paper trail.

## What gets posted

A stock transfer doesn't post to the GL — it's a stock-only movement (your overall inventory value doesn't change, just the location split). The inventory ledger records:

- Source warehouse: stock down by transferred quantity.
- Destination warehouse: stock up by the same quantity.

If in-transit tracking is on, the dispatch step records:

- Source warehouse: stock down.
- Stock-in-transit balance: stock up.

And the receive step:

- Stock-in-transit balance: stock down.
- Destination warehouse: stock up.

The GL **doesn't** move because total inventory is constant. Per-warehouse inventory valuations on reports update; the consolidated balance sheet doesn't change.

## FAQ

**The destination warehouse received fewer units than the source dispatched. What now?**
That's the in-transit shortfall case. The variance stays in **Stock in transit** until you account for it — either as damaged-and-written-off (stock adjustment), as still-in-transit-but-late (leave for now), or as actually-arrived-but-misplaced (find it and post a manual receive).

**Can I transfer at zero cost? Or do transfers preserve the source warehouse's cost?**
Transfers preserve the **moving-average cost** of the items at the source. If Warehouse A's average cost for an item is 100 and Warehouse B's was 95, the transferred stock arrives at B with cost 100, and B's average cost recomputes accordingly.

**Do I need to involve accounting in transfers?**
Generally no — transfers are purely operational, the GL doesn't move. The exception is if you have **inter-company** structure (warehouses owned by different legal entities); then a transfer is a sale between entities and needs full document treatment.

**Can multiple lines on one transfer go to different destinations?**
No — one transfer is one source-destination pair. For multi-destination shipments, create one transfer per destination.

**A transfer's been "in transit" for two weeks — is that a problem?**
If real, it means stock is sitting somewhere unaccounted for, which costs money. Run the **In-transit aging** report to see all open transfers; investigate any that's been open more than your normal transit time.

**Can I transfer service items?**
No — services don't have stock to move. Stock transfers are for stock-tracked items only.

## Related

- [Items](./items.md) — the master items being transferred.
- [Stock counts](./stock-counts.md) — usually run alongside transfers to verify location-level accuracy.
- [Bundles](./bundles.md) — bundles transfer as their components (PettahPro spreads the bundle across its components automatically).
- [Batches and serials](./batches-and-serials.md) — for batch- and serial-tracked transfers.
