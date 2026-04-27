---
title: Opening balance
sidebar_position: 12
---

# Opening balance

## What it does

Opening balance is the process of loading your existing balances into PettahPro when you migrate from another system (or from spreadsheets, or from no system). It's a one-time setup step where you tell PettahPro what your accounts looked like on the day you started using it — bank balances, AR, AP, inventory, fixed assets, equity, retained earnings.

Done well, opening balance gives you a clean starting point: every report you run shows the right numbers from day one. Done badly, you spend the next year chasing reconciliation differences.

This page assumes you're going live on a specific cutover date (e.g. start of a new financial year, or first day of a month). All transactions before that date were in your old system; everything after is in PettahPro.

## Walkthrough

### Pick your cutover date

The date PettahPro becomes your system of record. Common choices:

- **Start of a new financial year** (1 April for SL businesses) — cleanest, gives you a full year of clean data.
- **Start of a new month** — acceptable if waiting until April isn't an option. The first year's annual report will be a partial year.
- **Mid-year** — possible but harder; the year's reporting splits across two systems.

### Get the trial balance from your old system

Run a trial balance from the old system as at the day before cutover. You need:

- Every account with its balance.
- Outstanding customer invoices (open AR balance, broken down per customer).
- Outstanding supplier bills (open AP balance, broken down per supplier).
- Inventory by item, with quantity and cost.
- Fixed assets by item, with acquisition cost, accumulated depreciation, net book value.
- Bank balances (these should match your bank statements as at cutover).

### Load the opening trial balance

Open **Accounting → Opening balance**.

1. Set the **Opening date** (one day before cutover, since balances are "as at end of day").
2. Enter each account's balance in the grid. Debits and credits must balance.
3. PettahPro books a single opening journal that establishes every account's balance as at the date.

### Load the open AR

For each unpaid invoice from the old system:

**Sell → Invoices → Import opening invoices**. Upload a CSV with: customer, invoice number, invoice date, due date, amount, currency. PettahPro creates each as a posted invoice dated **before** the cutover. Each contributes to the opening AR balance.

This way, the AR isn't just one lump sum — it's broken down per invoice, which means AR aging works from day one.

### Load the open AP

Same shape on the buy side. **Buy → Bills → Import opening bills**. Upload supplier, bill number, bill date, due date, amount, currency.

### Load opening inventory

For every stock-tracked item, you need to tell PettahPro how much you have and what it cost.

**Inventory → Items → Import opening stock**. CSV with item code, warehouse, quantity, unit cost. PettahPro records the stock with a single "opening stock" GRN dated at cutover.

For batch- or serial-tracked items, the import takes additional columns (batch number, expiry, serial numbers).

### Load opening fixed assets

**Accounting → Fixed assets → Import**. CSV with name, code, category, acquisition date (the **original** date — not cutover), cost, useful life, accumulated depreciation to date.

PettahPro creates each asset with the right net book value. The depreciation schedule continues from where you left off in the old system.

### Reconcile

Once everything's loaded:

1. Run the **Trial balance** in PettahPro at the cutover date.
2. Compare to the trial balance from the old system.
3. They should match exactly. If they don't, find the difference before going live.

Common reconciliation gaps:
- AR or AP doesn't tie because some invoices/bills weren't loaded.
- Inventory doesn't tie because the per-item costs don't sum to the GL inventory total.
- Forex differences if the old system used a different rate for FC balances.

Don't go live until reconciliation is clean.

## Common tasks

### Migrate mid-year

Sometimes you can't wait for the new FY. The mid-year migration needs:

- Year-to-date P&L numbers from the old system (so the YTD reports in PettahPro are accurate from cutover onwards — you'd post a year-to-date opening journal for income/expense accounts).
- Or accept that PettahPro's first-year P&L only covers the period from cutover.

The simpler approach: cut over with balance-sheet opening balances only; start the P&L at zero from cutover. Annual reports for the first year cover only the post-cutover period.

### Migrate from spreadsheets

If you've been running on spreadsheets with no formal trial balance, treat cutover as your "real" books baseline. Best you can do:

- Bank balances from bank statements.
- AR / AP by reading off your unpaid-customer / unpaid-supplier list and entering each.
- Inventory by stocktake.
- Fixed assets by listing what you have and estimating acquisition date and cost.
- Plug the balancing figure into Equity / Retained earnings.

This is rougher than a proper migration, but at least you start with a balanced trial balance.

### Re-do opening balances

If you find a major error in opening balances after going live: **Accounting → Opening balance → Reverse**. PettahPro reverses the opening journal; you can re-load corrected. Caveat: any transactions posted **after** the opening journal will have their context shift, so investigate before reversing.

### Going live across multiple businesses

If you're migrating multiple businesses to PettahPro, do them one at a time — full end-to-end for each, including reconciliation, before starting the next. Trying to do all in parallel multiplies the risk.

## What gets posted

### The single opening journal

PettahPro books one journal at the opening date that establishes every account's balance:

| Account | Debit | Credit |
|---|---|---|
| Bank — primary | bank balance | |
| Accounts receivable | total open AR | |
| Inventory | total inventory value | |
| Fixed assets | total fixed asset cost | |
| ... | ... | |
| Accounts payable | | total open AP |
| Accumulated depreciation | | total |
| VAT payable | | balance |
| ... | ... | |
| Owner's equity | | balance |
| Retained earnings | | balance |

The journal is balanced (debits = credits). Each subsequent transaction posts on top of these opening balances.

### Per-document opening loads

Loaded invoices, bills, GRNs, fixed assets each have their own posted entries dated before cutover. They don't change the trial balance (because the balances were set by the opening journal); they exist to give you the per-document detail (e.g. AR aging by invoice).

## FAQ

**My old system's account names don't match PettahPro's.**
Map them. PettahPro's chart is fairly standard SL — most accounts have direct equivalents. For accounts that don't map cleanly, either rename PettahPro's accounts to match yours, or accept the rename and update reports accordingly.

**My opening AR includes some old debt I'm not sure I'll collect.**
Load it at face value. Then post a **bad debt provision** journal: increase Bad debt expense, decrease an "Allowance for doubtful debts" contra-account against AR. Doesn't change the AR record but acknowledges the realistic value. If specific invoices are truly written off, post the write-off after going live.

**My old system's fixed asset register is patchy. What do I do?**
Best-effort. List what you can. Where acquisition date or cost is unknown, estimate. The opening trial balance just needs to balance; the per-asset detail is for your future reference. Talk to your accountant about whether the gaps need a one-off provision or write-off.

**Should I import historical transactions before cutover?**
Generally no — the opening balance establishes the starting state; historical transaction-level data lives in the old system. Importing years of history is expensive and rarely worth it. Most businesses keep the old system available read-only for historical lookups.

**Can I add an asset that should have been on the opening list?**
Yes — post-cutover, you can create a fixed asset with an acquisition date before cutover. PettahPro books an adjustment journal so the GL stays balanced. Do this for occasional missed assets; for systematic miss, reverse the opening and re-load.

**Cutover date is in the past — is that a problem?**
No. PettahPro handles backdated opening. Just make sure the opening date is **before** any operational transaction you've already posted in PettahPro (otherwise you'd be opening a balance after transactions had already happened, which doesn't make sense).

## Related

- [Chart of accounts](./chart-of-accounts.md) — what to populate in the opening journal.
- [Trial balance](../reports/trial-balance.md) — how to verify reconciliation.
- [Fixed assets](./fixed-assets.md) — opening fixed-asset import.
- [Sell → Invoices](../sell/invoices.md) and [Buy → Bills](../buy/bills.md) — opening AR and AP loads.
- **Inventory → Items → Import opening stock** — opening stock load.
