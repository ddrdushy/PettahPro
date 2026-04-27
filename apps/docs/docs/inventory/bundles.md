---
title: Bundles
sidebar_position: 3
---

# Bundles

## What it does

A bundle is a virtual item made up of other items — a "package" you sell as one thing on the invoice but which physically consists of several stock items. The classic example: a "Welcome kit" that's actually a pen + a notebook + a bag, sold as one item at one price.

Bundles solve a common headache: you want to sell a kit at a single price without having to remember and key in every component on the invoice — and you want stock for each component to come down accurately when the kit is sold.

PettahPro's bundle:

- Has its own item code, name, and sell price (the "bundle price" — what the customer pays for the whole kit).
- Has a list of **component items** with quantities (1 pen + 1 notebook + 1 bag).
- Doesn't have stock of its own — the components do.
- When sold, automatically reduces stock on each component by the bundle quantity × component quantity.

A bundle isn't a manufacturing recipe (PettahPro doesn't have a manufacturing module yet). It's just a packaging shortcut — components stay as separate stock items and can be sold individually too, the bundle is one of several ways they can leave the warehouse.

## Walkthrough

### Creating a bundle

Open **Inventory → Items → + New item** and pick **Item type = Bundle**.

1. **Name and code** — what shows on the invoice (e.g. "Welcome kit").
2. **Sell price** — the bundle price. This is what the customer is charged for the whole kit; it's typically less than the sum of the components' individual prices (that's the discount you're offering for buying as a bundle).
3. **Tax code** — VAT 18% normally. The whole bundle is taxed at this rate as one line.
4. **Components** — click **+ Add component** for each item that goes into the bundle.
   - Pick the item.
   - Set the **quantity per bundle** (e.g. 1 pen, 2 notebooks, 1 bag).
5. Save.

The bundle appears in the items list with type "Bundle" and is now selectable on invoices.

### Selling a bundle

On a regular invoice, just pick the bundle in the line picker. PettahPro:

- Shows the bundle name and code on the invoice line (the customer doesn't see the components).
- Uses the bundle's sell price.
- When you post the invoice, automatically reduces stock for each component by the appropriate quantity.

If a customer orders 5 Welcome kits and the bundle is 1 pen + 2 notebooks + 1 bag:
- Pen stock down by 5
- Notebook stock down by 10
- Bag stock down by 5

### Receiving a bundle

You don't. Bundles aren't physical things — they're virtual. You receive the components individually (via GRNs against the component items), and PettahPro tracks them as components. When a customer buys the bundle, the components leave the warehouse.

If your supplier ships you 100 pre-packed kits already assembled, you have two options:

1. Treat the supplier's "kit" as 100 × pen + 200 × notebook + 100 × bag on the GRN. The kit was just a packaging convenience for the supplier; you account for the components.
2. Create a **separate non-bundle item** called "Pre-packed welcome kit" that's a real product (not a bundle). Receive that as one item, sell it as one item. No bundle relationship.

Option 1 is cleaner if your customers might buy components individually. Option 2 is simpler if the kit is genuinely sold and bought atomically.

## Common tasks

### Change a bundle's components

Open the bundle → **Edit** → modify the component list and quantities → save. The change applies to **future** invoices only; bundles already sold keep their original component breakdown for stock purposes.

### Stop offering a bundle

Open the bundle → **Mark as inactive**. It disappears from the invoice line picker but historical sales of it remain visible.

### Sell a component on its own

You can — components stay as regular items in their own right. The Welcome kit's bundle relationship only kicks in when somebody buys the bundle; selling a single pen still works exactly as before, reducing pen stock by one.

### Run "out of stock" alerts on bundles

PettahPro doesn't track bundle stock directly because the bundle has none. What it does do is flag a bundle as "low stock" when **any of its components** would be the limiting factor. So if you have 100 pens, 50 notebooks (with the bundle needing 2 each), and 100 bags, the bundle's effective availability is 25 — limited by notebooks.

This shows up on the items list and in the dashboard low-stock widget.

### Use a bundle inside a bundle

You can't (yet). PettahPro's bundles are flat: components must be regular items, not other bundles. If you genuinely need nested kits, the workaround is to flatten the structure — list every leaf component on the parent bundle directly.

### Show the bundle's components on the invoice PDF

By default, the invoice line just shows "Welcome kit × 5". If you want the components listed below the bundle line on the printed invoice (so the customer sees what's in the kit), turn on **Show bundle components on PDF** in Settings → Document templates → Invoice. This is purely cosmetic — the line still posts as one bundle, the components are just visible.

### Refund or return a bundle

Issue a credit note for the bundle line (just like any other line). Stock for each component goes back up by the appropriate quantity. The customer's balance comes down.

## What gets posted

A bundle on an invoice line posts the same shape as any other invoice line — it's one revenue line at the bundle's sell price, with VAT calculated on it as a unit:

| Account | Debit | Credit |
|---|---|---|
| Accounts receivable | bundle price (incl. VAT) | |
| Sales revenue | | bundle subtotal |
| VAT payable | | VAT amount |

The cost side is where bundles do something special. Instead of one COGS posting, **each component generates its own**:

| Account | Debit | Credit |
|---|---|---|
| Cost of goods sold | (pen cost × 5) + (notebook cost × 10) + (bag cost × 5) | |
| Inventory — pens | | pen cost × 5 |
| Inventory — notebooks | | notebook cost × 10 |
| Inventory — bags | | bag cost × 5 |

So your COGS reflects the actual cost of each component (not a stored "bundle cost"), and inventory ledgers stay accurate per item.

## FAQ

**A component runs out of stock — can I still sell the bundle?**
Yes, by default — PettahPro warns you that a component is going negative but doesn't block the post. If you want it to block, turn on **Block negative stock** in Settings → Inventory. Tighter control, but you have to be on top of GRNs.

**The bundle's sell price is less than the sum of its components' sell prices. Is that wrong?**
No, that's how a bundle is meant to work — you discount the kit relative to buying the bits separately, and the customer pays the lower price. Your gross margin on the bundle is naturally tighter than on the components individually; that's the trade-off you've chosen.

**Can a bundle's components be services?**
Yes. A "Setup package" bundle can include a "Setup fee" service item plus an "Installation visit" service item plus a physical "Hardware kit" product. Selling the bundle posts revenue for the whole price, reduces hardware stock, and books the service items the way the items themselves are configured.

**My customer wants the bundle but with one component swapped out. How?**
Don't bend the bundle definition. On the invoice, key the components individually instead of the bundle — pen + notebook + bag-substitute, each as separate lines. Keeps the bundle definition clean for everyone else.

**Can I see how many bundles I've sold?**
Yes — the **Sales by item** report shows bundles like any other item, with quantity and revenue. Cross-reference against the **Stock movements** report to see the underlying component movements.

**What happens if I delete a component item that's used in a bundle?**
PettahPro won't let you delete it — the bundle reference would break. Deactivate the component first (so it can't be added to new bundles), then either remove it from the bundle's component list or accept that the bundle now has a deactivated component (which means new sales of the bundle will fail).

## Related

- [Items](./items.md) — the master items that bundles are made of.
- **Stock movements** — see component movements driven by bundle sales.
- [Sell → Invoices](../sell/invoices.md) — where bundles get sold.
- [Glossary — Bundle / Kit](../concepts/glossary.md#bundle--kit) — the short definition.
