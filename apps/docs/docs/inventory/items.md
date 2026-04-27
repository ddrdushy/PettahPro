---
title: Items
sidebar_position: 1
---

# Items

## What it does

An item is anything you sell or buy — a product on a shelf, a service you provide, a kit of components. Items are the master data underneath every invoice, bill, GRN, and stock movement; if it appears on a line on any of those documents, it's an item.

PettahPro has three kinds of items:

- **Product** — a physical thing with stock and a unit cost. Tracked through inventory: stock goes up when you receive it, down when you sell it. Examples: a packet of biscuits, a bottle of shampoo, a 1-litre paint tin.
- **Service** — billable activity, no stock. Examples: an hour of consulting, a delivery charge, a service-call visit.
- **Bundle** — a virtual item made up of other items. Examples: "Welcome kit" = pen + notebook + bag. (See [Bundles](./bundles.md) for the full story.)

The kind you pick decides how the item behaves on every document going forward — so it's worth getting right when you create an item.

## Walkthrough

Open **Inventory → Items → + New item**.

1. **Item type** — Product / Service / Bundle. You can't change this after the first transaction posts; pick the right one now.
2. **Name** — what shows up on invoices and bills. Keep it short and recognisable.
3. **Item code (SKU)** — your unique identifier for this item. PettahPro auto-generates one if you don't enter one. Useful when you have many similar items and want to pick by code rather than name.
4. **Sell price** — the default price on invoices. Per-line override on the invoice itself if you negotiate a different price.
5. **Buy price** — what you typically pay for it. Used to compute cost of goods sold when you sell a stock item.
6. **Tax codes** — usually `VAT 18%` for sell and buy. Override per line if a specific transaction is taxed differently.
7. **Income account** (services / sales side) — which P&L line the sale credits. Defaults to "Sales revenue" but you can pick a more specific income account (e.g. "Sales — restaurant" vs "Sales — bar").
8. **Expense or inventory account** (buy side) — which account the buy posts to. For products, the default is "Inventory" (asset). For services, the default is whatever expense account you've mapped — utilities, professional fees, etc.

For **products**, you also configure:

- **Track stock** — yes (default) or no. If off, the item behaves like a service for inventory purposes — no stock ledger, no COGS — but you can still buy/sell it. Useful for pass-through items where you don't actually hold any.
- **Default warehouse** — where new stock comes in by default. Override per GRN.
- **Reorder level** — when stock drops to this number, you get a low-stock alert.
- **Batch / serial tracking** — turn on if you need to track expiry, manufacturing date, or unique unit serials. (See [Batches & serials](./items.md) — to be expanded.)
- **Unit of measure** — pieces, kg, litres, metres, etc.

Save. The item now appears on every relevant transaction screen.

## Common tasks

### Edit an existing item

Open the item → **Edit**. You can change the name, prices, tax codes, accounts, and most other fields freely; historical transactions are not affected. The one thing you can't change after the first transaction is the **item type** — once a product is a product, it stays a product.

### Bulk import items from a spreadsheet

For migrations, or when adding a large catalogue, use **Inventory → Items → Import**. Upload a CSV or Excel file with one row per item. PettahPro shows a preview, lets you map the columns, and then creates each item with a per-row success/failure report.

### Discontinue an item

Open the item → **Mark as inactive**. Inactive items don't appear in the line picker on new transactions but stay queryable for historical reports. If you also want to clear out the stock, do a stock adjustment first to write off whatever's left.

### Change a product's buy or sell price

Just edit the item — the new price applies to new documents from now on. Existing posted invoices and bills are unaffected (their prices are locked at their date of post).

### See what an item costs you on average

Open the item → **Stock movements** tab. Each receipt records the unit cost; PettahPro shows the **moving average** cost based on what you've actually paid. That's the cost used for COGS when you sell.

### Group items into categories

Open **Inventory → Categories** and create a category tree (e.g. "Food", with sub-categories "Snacks" and "Beverages"). Then assign items to categories. Reports and dashboards can then group sales and stock by category — useful for retail and wholesale businesses with hundreds of items.

### Use multiple units of measure (UOM)

If you sell milk by the litre but buy it by the carton (12 litres), set the **Buy UOM** to "carton (12L)" with a conversion factor of 12 to your sell UOM "litre". When you receive a GRN of 10 cartons, stock goes up 120 litres; sell 1 litre at a time and the maths just works.

## What gets posted

Creating an item doesn't post anything to your books — it's master data, not a transaction.

What's relevant is **what the item drives** when it appears on a document:

| Document | What the item contributes |
|---|---|
| Invoice line | Sell price (overridable), tax code, income account, COGS account (for stock items) |
| Bill line | Buy price (overridable), tax code, expense or inventory account |
| GRN line | Unit cost, inventory account, batch/serial details |
| Stock count | Whether it's tracked, current quantity for variance |

The item's settings define the defaults; the document is where the actual posting happens.

For a stock-tracked product, every sale also posts the cost side automatically:

| Account | Debit | Credit |
|---|---|---|
| Cost of goods sold | item cost × quantity | |
| Inventory | | same |

The "item cost" used here is your moving-average buy price, computed from your actual GRN history.

## FAQ

**Should I track stock on something I always buy and immediately sell?**
If you genuinely never hold inventory (drop-ship, made-to-order), turn **Track stock** off — it makes the bookkeeping simpler. If you ever physically hold the item, even for a day, leave tracking on. The COGS / margin reporting only works correctly when stock is tracked.

**My supplier sometimes ships in different sizes — can the same item handle that?**
Yes — use **multiple UOMs** with conversion factors. The item is still one item; the UOM tells PettahPro how many of the base unit each pack contains.

**Can I have the same item code in two warehouses with different prices?**
The item is one record per business, but you can set per-warehouse cost using the moving-average cost — i.e., each warehouse maintains its own running cost based on what arrived there. Reports can show value per warehouse separately.

**A customer wants a one-off custom item that won't recur. Should I create a master item?**
For pure one-offs, no — use a generic "Miscellaneous service" item and override the description and price on the invoice line. For anything that might come back, even occasionally, create the item — searching for it by name later is much faster than re-typing.

**My items list is unmanageably long. Can I split it across products and services?**
Use **categories** rather than separate item lists. Categories are filterable on the items list, on every transaction line picker, and on reports. The shape of "one items list grouped by category" works much better in practice than "products list + services list".

**I deleted an item but transactions referencing it still appear correctly — why?**
PettahPro doesn't actually delete an item that's been used; it marks it inactive and hides it from the picker. Historical transactions keep their reference and continue to display correctly. To genuinely remove an item it has to be unused on any document, ever.

## Related

- [Bundles](./bundles.md) — virtual items made of other items.
- [Stock counts](./stock-counts.md) — periodic physical verification.
- **Stock transfers** — moving stock between warehouses.
- **Categories** — grouping items for filtering and reporting.
- **GRNs** — receiving stock against an item.
- [Sell → Invoices](../sell/invoices.md) — how items appear on a sale.
- [Buy → Bills](../buy/bills.md) — how items appear on a purchase.
