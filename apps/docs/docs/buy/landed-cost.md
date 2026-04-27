---
title: Landed cost
sidebar_position: 8
---

# Landed cost

## What it does

Landed cost is the **true** cost of getting an item to your warehouse, not just the price the supplier charged. For imported goods, the supplier's invoice is only part of the story — you also pay freight, customs duty, port charges, clearing agent fees, insurance. Landed cost spreads those extra charges across the items they relate to, so each item's stock value reflects what it really cost you.

Without landed cost tracking, your inventory is undervalued and your COGS is understated. With it, you know your real margin and your stock balance is correct.

For domestic purchases without freight or duty, landed cost mostly doesn't apply — the bill is the cost. Landed cost is mostly for **importers**.

## Walkthrough

The flow has three documents:

1. The supplier's bill for the goods themselves.
2. Bills for the additional landed costs (freight, customs, clearing agent, insurance) — usually from different suppliers.
3. A **landed cost** record that ties them together and re-allocates the charges to the goods.

### Set up the landed-cost record

Open **Buy → Landed cost → + New landed cost**.

1. **Pick the GRN** for the imported shipment.
2. **Add charge lines** — for each additional cost (freight, duty, clearing, etc.):
   - Pick the bill that covers it (or post the bill from this screen if it hasn't been posted yet).
   - Pick the **allocation method** — by value, by quantity, by weight, or fixed.
3. PettahPro distributes each charge across the GRN's line items per the allocation method, showing you the per-item cost adjustment.
4. Review the resulting per-item landed cost.
5. **Post**.

Posting moves the charges into the items' inventory cost. The GRN clearing balance reduces; inventory cost increases by the same amount; the supplier balances on the cost-side bills come down.

### Allocation methods

- **By value** — costs spread proportionally to each item's purchase value. Most common; works for when costs scale with value (insurance, etc.).
- **By quantity** — equal share per unit. For bulk uniform imports.
- **By weight** — proportional to item weight. For freight charges, where heavier items genuinely cost more to ship.
- **Fixed** — assign specific amounts to specific items. For one-off charges that only relate to certain items.

You can mix methods — e.g. allocate freight by weight and customs duty by value, on the same landed-cost record.

## Common tasks

### Import shipment with three additional bills

Goods bill: 1,000,000. Freight bill: 50,000. Customs duty bill: 100,000. Clearing agent fee: 25,000.

Total extra: 175,000. With "by value" allocation across the goods, every item's unit cost goes up by ~17.5%. The post writes that into inventory; future sales of these items will COGS at the higher cost.

### Charge that arrives later

Customs duty came in three weeks after the goods arrived. The GRN is already posted; the inventory has been valued at goods-cost only.

Open the GRN → **Add landed cost**. Add the duty bill, allocate, post. Inventory cost adjusts upward by the duty amount; the GRN clearing balance reduces. If any of those items have already been sold (their COGS posted at the lower cost), the system shows you the variance — the choice is yours: leave it (the difference goes to a "Landed cost variance" account on P&L) or post a manual adjustment.

### Landed cost on a partial shipment

Half the items have arrived; the other half are on a later ship. Two GRNs, one landed-cost record per GRN — each gets its share of the freight (allocate by weight or quantity, depending on what's accurate).

### Reverse a landed cost

If the allocation was wrong, **Reverse** the landed-cost record. Inventory adjusts back to the goods-only cost; the GRN clearing reverses. Re-post with a corrected allocation.

### See landed cost per item

The item's **Cost history** tab shows every cost movement — purchases, landed-cost adjustments, count variances. Useful when you suspect an item's cost is wrong.

## What gets posted

For a landed-cost record allocating 175,000 of additional charges across imported goods:

| Account | Debit | Credit |
|---|---|---|
| Inventory | 175,000 (split across items) | |
| GRN clearing — freight, duty, clearing | | 175,000 (split across the bills) |

The inventory account goes up; the GRN clearing accounts (or directly the supplier balances, depending on how the cost-side bills are configured) come down by the same amount.

The result: each item in the shipment now has a higher inventory cost reflecting its true landed price. When you eventually sell that item, COGS will reflect the real cost, not the supplier-invoice cost.

## FAQ

**My freight bill came in one currency and the goods bill in another. How does landed cost handle that?**
Each bill posts in its own currency, converted to LKR at the bill's date FX rate. The landed-cost allocation works in LKR — so the freight in USD becomes LKR-equivalent before being spread across items. Currency complications are handled per-bill, not per landed-cost-record.

**The clearing agent's bill includes some service items I don't want to allocate to inventory.**
Use **Fixed** allocation with zero on the lines that shouldn't be allocated. Or post that part of the bill to a non-stock expense account directly, separate from the landed-cost record.

**My items have already been sold by the time the freight bill arrives. Now what?**
PettahPro applies the landed cost retroactively to the inventory cost. For items already sold, the COGS variance posts to a **Landed cost variance** account — by default, this is a P&L account so the variance shows on this period's P&L. Acceptable for small variances; for material amounts, consider a manual adjustment to true up the COGS on the original sales.

**Can I run reports comparing landed cost to supplier-invoice cost?**
Yes — the **Landed cost analysis** report shows your import margin, with per-shipment supplier cost vs. landed cost. Useful for seeing whether duty rates have changed, whether freight costs are creeping up.

**Domestic purchase with delivery charge — should I use landed cost?**
Probably not — for one-off small delivery charges, just put the delivery charge on the same bill as the goods (or as a separate expense bill that doesn't allocate to stock). Landed cost is overhead that only pays off for genuine imports with material extra costs.

**What if I get a refund on the customs duty?**
Post a debit note against the customs bill for the refund amount. Then post a **negative landed cost** (or reverse the original and re-do it without the customs portion). The inventory adjusts back to the corrected figure.

## Related

- [GRNs](./grns.md) — what landed cost is allocated against.
- [Bills](./bills.md) — the cost-side documents that landed cost ties together.
- [Inventory → Items](../inventory/items.md) — where the resulting cost lives.
- **Inventory cost report** — see per-item cost over time, including landed-cost effects.
