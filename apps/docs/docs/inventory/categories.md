---
title: Categories
sidebar_position: 5
---

# Categories

## What it does

Categories are the way you group items together — for filtering, for reporting, for keeping a long item list usable. A retailer might categorise items as Food / Beverages / Household. A pharmacy might use Medicines / Cosmetics / Equipment. A hospitality business might use Rooms / F&B / Spa / Other.

PettahPro categories are **hierarchical** — you can have a top-level category with sub-categories, and sub-sub-categories under those. This works well for businesses with hundreds or thousands of items where one level of categorisation isn't enough to navigate.

Categories are optional. A business with 20 items doesn't need them. A business with 2,000 items can't function without them.

## Walkthrough

### Setting up the category tree

Open **Inventory → Categories**. The tree view shows top-level categories and their children. To add:

1. Click **+ New category** at the top level, or **Add child** under an existing category.
2. **Name** — what shows on the items list and in reports.
3. **Code** (optional) — short reference, useful for sorting and printing on labels.
4. **Default tax codes / accounts** (optional) — items in this category default to these. You can override per item.
5. **Save**.

The category appears in the tree. Click and drag to reorder or move between branches.

### Assigning items to a category

When creating or editing an item, pick the category. Each item belongs to one category. (For "two categories" needs, see FAQ below.)

### Bulk-assign

For going-live with categories on existing items: **Items → Bulk action → Assign category**. Pick the items, pick the category, save.

## Common tasks

### See sales by category

**Reports → Sales by category** rolls up your invoices by item category. Useful for the question "which category is my biggest revenue source?" — often a surprise. Drill into a category to see the items contributing.

### Filter the items list

The items list filter has a category picker. Useful when working in one part of the catalogue. The picker supports the hierarchy — picking "Food" shows everything under Food, including Snacks and Beverages.

### Restructure the tree

You set up categories one way and now want to re-organise. Click and drag categories to new parents. Items keep their category assignment; the category just lives in a different place in the tree. No data migration needed.

### Split one category into two

You have "Food" with 200 items, and you want to split into "Snacks" and "Beverages". Create the two new sub-categories under Food. Bulk-assign items to the right one. Once Food has zero items directly assigned (only its children do), it acts as a pure container.

### Merge two categories

Wrong — two categories that should have been one. Create the destination category. Bulk-reassign items from both source categories to it. Once they're empty, delete the source categories.

### Delete a category

Open the category → **Delete**. Only allowed if the category has no items assigned and no sub-categories. If it does, reassign or move first.

### Print labels with category codes

Set a **Code** on each category. The barcode-label printer can include the category code on each label, useful for warehouse organisation. **Inventory → Labels → Configure** sets which fields appear on the labels.

## What gets posted

**Nothing.** Categories are organisation, not transactions. Creating, editing, or deleting a category doesn't move any account.

What categories do affect:
- **Reports** — the way data rolls up.
- **Filters** — the items list and other pickers.
- **Default fields** — items can inherit tax codes and accounts from their category.

## FAQ

**Can an item belong to two categories?**
Strictly, no — one item has one category. For items that genuinely belong in two places (e.g. a gift basket that's both "Food" and "Gift items"), pick the dominant category. If you need cross-cutting tags beyond categories, look at the item's **Tags** field — tags are independent of categories and an item can have many.

**My categories don't match my supplier's catalogue. Should I conform?**
No — your categories are about how **you** want to view your business. Supplier catalogues are how **they** organise. Pick the structure that makes your reporting useful; suppliers' structures are separate.

**Can categories have different tax treatment?**
Yes — a category can have a default tax code that all its items inherit (overridable per item). Useful when, say, all "Medicines" are tax-exempt while everything else is at VAT 18%.

**Can I use categories for branch-specific items?**
Don't. Categories are about what an item **is**. For branch-specific behaviour, use **warehouses** (each branch is a warehouse) and **stock-by-location**. Categories should answer "what kind of thing is this?", not "where is this?".

**My team disagrees on how to categorise some items.**
That's a sign the categorisation is too fine. Roll up to a parent category that everyone accepts; let the sub-categorisation be aspirational. It's common to start with broad categories and refine over months as patterns emerge.

**The Sales by category report is missing items.**
Check whether all items have a category assigned. Items without a category fall under **Uncategorised** in reports — bulk-assign to fix.

## Related

- [Items](./items.md) — the items being categorised.
- **Sales by category report** — see your category breakdown.
- **Tags** — for cross-cutting groupings beyond categories.
