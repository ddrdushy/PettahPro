---
title: Stock counts
sidebar_position: 2
---

# Stock counts

## What it does

A stock count is the act of physically counting what's actually on your shelves and reconciling it against what your books say should be there. No matter how careful your day-to-day stock management is, real-world differences creep in — damage that wasn't reported, theft, miscounted GRNs, items used internally without being recorded. Stock counts catch all of that and bring your inventory records back in line with reality.

Most businesses count stock at least once a year (often as part of year-end close). Bigger or higher-value inventories are counted more often — quarterly, monthly, or via rolling counts where a slice of the warehouse is counted every week.

PettahPro supports two styles:

- **Full count** — count everything in a warehouse on one date. Operations usually pause while it happens.
- **Cycle count** — count a subset (one category, one shelf, one supplier's items) without stopping the rest of the warehouse.

Either way the mechanics are the same: print a count sheet, count, enter the actual numbers, post the variance.

## Walkthrough

### Setting up the count

Open **Inventory → Stock counts → + New count**.

1. **Pick the warehouse.** If you only have one, this is set automatically.
2. **Pick the count type** — Full or Cycle.
3. **Pick the scope** (cycle counts only) — by category, by item, or by location within the warehouse.
4. **Set the count date.** This is the date "as at" which the count is being taken. The system snapshots the expected quantity for every in-scope item at this moment.
5. **Save as draft.** PettahPro creates the count sheet — a list of every item in scope with its expected quantity blanked out (so the counter doesn't get biased by what it "should" be).

### Counting

Print the count sheet. The counter walks the warehouse and writes down the actual quantity for each item. For batch- or serial-tracked items, the sheet also lists each batch or each serial — count and tick.

Some businesses do a **double count**: two people count independently, results are compared, and any disagreement gets recounted. PettahPro doesn't enforce this — it's a workflow you can layer on top.

### Entering the count

Back in PettahPro: **Inventory → Stock counts → \[your count\] → Enter counts**.

Either:
- Type the quantities into the table, or
- Upload the count sheet as a CSV (one row per item with the actual quantity).

PettahPro shows the **expected** column (what the books say) alongside the **actual** column (what you counted). The **variance** column highlights any difference.

### Posting the count

Once you've entered everything and reviewed the variances:

1. Click **Review variances**. PettahPro shows you every line where actual ≠ expected.
2. For each variance, decide: is this a genuine difference (post it) or a counting error (recount)?
3. For counting errors, send the item back for a recount and re-enter.
4. When you're satisfied with the variances, click **Post**.

Posting a stock count:

- Adjusts inventory up or down to match the actual count.
- Books the variance to the **Stock variance** account (or an adjustment account you've configured).
- Locks the count — no further edits.
- Generates a count report you can save for your records or share with your auditor.

## Common tasks

### Pause operations during a full count

In **Settings → Inventory** turn on **Block transactions during count**. While a full count is **In progress**, GRNs, invoices, and stock transfers in that warehouse are blocked, with a message saying a count is underway. Once the count posts, the block lifts. (Cycle counts don't block.)

### Recount a single item without restarting

After posting the count, you realised one item was wrong — the counter miscounted boxes that were stacked behind something. The clean fix is a **stock adjustment** for that single item. Open **Inventory → Stock adjustments → + New** and post the difference. Don't reverse the whole count for one item.

### Cycle count by category

For a 5,000-item warehouse where a full count would take a week, set up monthly cycle counts: each month covers a different category, and after 12 months everything's been counted at least once. Reports → **Cycle count coverage** shows you what's been counted recently and what hasn't.

### Track counters

Each posted count records who entered the counts and who posted them. Useful when reviewing variance patterns — if the same person consistently has high variance, they probably need more training (or there's a real issue with the items they're counting).

### Handle batch- and serial-tracked items

For **batch-tracked** items (medicines, food), the count sheet lists each batch separately — you count units within each batch. PettahPro reconciles per batch, so an expired batch with 0 actual count vs 50 expected gets written off correctly.

For **serial-tracked** items (phones, appliances), the count sheet lists each serial — you tick whether it's there or missing. PettahPro flags any missing serials as gone-from-stock and any unexpected serials as gain-to-stock.

### Run the variance report

After posting, **Reports → Stock count variance** shows you the historical variance over time. A consistently positive variance might mean you're under-recording purchases; a consistently negative variance might mean theft, damage, or unrecorded internal use. The pattern matters more than any single count.

## What gets posted

When you post a stock count, PettahPro books the variance only — not the full count. If you counted 100 units of an item and the books said 105, only the 5-unit shortfall is posted:

For a **shortage** (actual less than expected):

| Account | Debit | Credit |
|---|---|---|
| Stock variance | shortage value | |
| Inventory | | same |

For a **surplus** (actual more than expected):

| Account | Debit | Credit |
|---|---|---|
| Inventory | surplus value | |
| Stock variance | | same |

The variance values use the moving-average cost, so the inventory account moves to its correct value and the stock variance account on the P&L shows the cumulative effect of all counts.

The "Stock variance" account is on your P&L by default. Material variances usually need investigation — they often signal something else going on (theft, damage not reported, missing GRNs).

## FAQ

**My count showed a big shortage on a high-value item — what should I do?**
Recount before posting. Genuine variances do happen but a big shortage on a high-value item is the kind of thing you want to be sure about before adjusting your books. If the recount confirms, post the variance and investigate (theft, damage, miscounted GRN). The count itself isn't an investigation tool — it just makes the number visible.

**Can I count two warehouses at once?**
Yes — they're independent. Each warehouse's count blocks (or doesn't block) only its own transactions.

**Half-way through entering counts, I realised the scope was wrong. Can I change it?**
Only on a **draft** count. Open the count → **Edit scope**. PettahPro re-snapshots the expected quantities for the new scope. Once you've started entering actuals, changing scope wipes the actuals — only do it if you haven't entered much yet.

**I want to count without printing — can the team enter counts on a tablet directly?**
Yes — the count entry screen works on tablets and phones. Many businesses skip the printout entirely and have someone walking the warehouse with a tablet. Auto-saves as you go.

**Stock count posted but a colleague said one number was wrong. How do I fix it?**
Don't re-do the whole count. Post a **stock adjustment** for just the wrong line, with a description noting that it's a correction to count #X. Audit trail stays clean.

**Will an auditor accept a posted stock count as evidence of physical inventory?**
The system records who counted, when, and what was actually counted. That's a useful start but auditors usually want to **observe** a count themselves once a year — they'll watch your team count and verify a sample. PettahPro's records support that workflow but don't replace observation.

## Related

- [Items](./items.md) — what's being counted.
- **Stock adjustments** — for one-off corrections (don't run a count for a single item).
- **Stock transfers** — moving stock between warehouses (not a count).
- [Period close](../accounting/period-lock.md) — annual count is usually part of year-end close.
- [Glossary — Batch / Lot](../concepts/glossary.md#batch--lot) and [Serial](../concepts/glossary.md#serial) — the tracking concepts.
