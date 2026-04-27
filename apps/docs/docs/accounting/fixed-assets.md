---
title: Fixed assets
sidebar_position: 11
---

# Fixed assets

## What it does

Fixed assets are long-term physical things your business owns that aren't sold day-to-day — equipment, vehicles, furniture, IT hardware, property. Unlike inventory (which is for resale), fixed assets are for **use** in running the business, and they typically last more than a year.

Because they're long-lived, you can't expense their full cost in the year you buy them — accounting requires you to spread the cost over the asset's useful life via **depreciation**. PettahPro's Fixed assets module manages the full lifecycle: acquisition, depreciation schedule, maintenance log, disposal.

For a small service business with a laptop and a desk, you can probably skip the formal Fixed assets module — just record purchases as expenses or post them to a "Fixed assets" account on the chart and depreciate manually. For businesses with significant capital (vehicles, machinery, real estate), the module pays back quickly.

## Walkthrough

### Recording an acquisition

Two paths:

**From a bill (the common case):** When posting a bill for a fixed asset (a vehicle from a dealer, a machine from a supplier), pick the **Fixed asset** flag on the bill line. PettahPro asks for the asset details: name, serial number, location, depreciation method, useful life. Posting the bill creates the fixed-asset record automatically and books the cost to Fixed assets (not to expense).

**Manually:** **Accounting → Fixed assets → + New asset** for assets where there's no purchase bill (e.g. an asset transferred in, opening balance from a previous system, an asset acquired before you started using PettahPro).

### Asset details

Each asset has:

- **Name** — what it's called.
- **Asset code** — your internal tag number.
- **Category** — vehicle / equipment / furniture / IT / building / etc.
- **Acquisition date** — when you bought it.
- **Acquisition cost** — what you paid (including any landed cost like delivery, installation).
- **Useful life** — number of years to depreciate over (typically 4–5 for IT, 5–10 for vehicles, 8–15 for furniture, 20–40 for buildings).
- **Salvage value** — what you expect it'll be worth at the end of its life. Usually 0 or 10% of acquisition cost.
- **Depreciation method** — Straight-line / Reducing balance / Units of production.
- **Location** — which warehouse, branch, or person it's assigned to.
- **Custodian** — who's accountable for it.

### Running depreciation

**Accounting → Fixed assets → Run depreciation**.

PettahPro calculates depreciation per asset for the period (typically monthly), shows you the per-asset breakdown, and posts the journal:

| Account | Debit | Credit |
|---|---|---|
| Depreciation expense (P&L) | period depreciation | |
| Accumulated depreciation (BS, contra to fixed assets) | | period depreciation |

The asset's net book value goes down by the period's depreciation. The expense hits the P&L.

You can run depreciation:
- **Monthly** as part of month-end close (most common).
- **Quarterly** for businesses with less material amounts.
- **Annually** at year-end for very small businesses.

### Maintenance log

Each asset has a **Maintenance** tab where you record service events — date, vendor, cost, what was done. Maintenance costs can be expensed (revenue expenditure) or capitalised (added to the asset's value); the system lets you choose per event.

### Disposal

When an asset reaches end of life, is sold, or is written off:

**Open the asset → Dispose**.

1. **Disposal date**.
2. **Disposal type** — Sold / Scrapped / Written off / Transferred.
3. **Sale proceeds** (if sold).
4. **Disposal expenses** (if any).

PettahPro books:

| Account | Debit | Credit |
|---|---|---|
| Accumulated depreciation | (its full balance) | |
| Cash / bank (if sold) | proceeds | |
| Loss on disposal (P&L) | shortfall | |
| Fixed assets | | acquisition cost |
| Gain on disposal (P&L) | | excess (if sold above NBV) |

The asset's record stays for audit but is marked **Disposed** and stops appearing on the active register.

## Common tasks

### Bulk-import existing assets

For migrations from another system. **Fixed assets → Import**. CSV with columns for name, code, category, acquisition date, cost, useful life, salvage, accumulated depreciation to date. PettahPro creates the asset records with the correct net book value, ready to continue depreciating from there.

### Run a fixed-asset register

**Reports → Fixed asset register**. Lists every active asset with cost, accumulated depreciation, net book value, depreciation method, location, custodian. The standard report auditors ask for.

### Asset transfer between locations

Asset moves from Colombo office to Kandy office. **Open the asset → Transfer location**. Update location and (optionally) custodian. Audit trail shows the transfer.

### Re-estimate useful life

You bought a vehicle expecting 10 years; turns out the conditions are tougher and it'll only last 6. **Open the asset → Edit → Useful life**. Subsequent depreciation recalculates from the new schedule. Past depreciation is unchanged.

### Revaluation

For property whose market value has changed materially: **Open the asset → Revalue**. Enter the new value; PettahPro books the revaluation gain or loss. Revaluation is regulated — talk to your auditor before doing this; it's not something to do casually.

### Capital work in progress (CWIP)

For assets being built (a building, a piece of custom equipment), the cost accumulates as it's incurred. Use a **CWIP** asset type that doesn't depreciate. When the asset is ready for use, transfer the accumulated cost to a regular fixed asset and start depreciating.

## What gets posted

### At acquisition

| Account | Debit | Credit |
|---|---|---|
| Fixed assets | acquisition cost | |
| Bank or AP | | acquisition cost |

### At each depreciation run

| Account | Debit | Credit |
|---|---|---|
| Depreciation expense | period depreciation | |
| Accumulated depreciation | | same |

### At disposal (sold above book value)

| Account | Debit | Credit |
|---|---|---|
| Cash / bank | proceeds | |
| Accumulated depreciation | accumulated to date | |
| Fixed assets | | acquisition cost |
| Gain on disposal | | proceeds − net book value |

### Net book value

NBV = Acquisition cost − Accumulated depreciation. Reported on the balance sheet as Fixed assets net.

## FAQ

**Straight-line vs reducing balance — which should I use?**
**Straight-line** depreciates the same amount each period — simpler, fits most assets. **Reducing balance** depreciates a fixed percentage of the remaining value each period — fits assets that lose value faster early on (vehicles, IT equipment). Pick what reflects how your assets actually depreciate; consistency matters more than the choice itself.

**Tax-allowed depreciation rates are different from accounting rates. How do I handle that?**
PettahPro tracks one depreciation schedule (the accounting one). For tax filing, you compute tax-allowed depreciation separately (often by category at IRD-prescribed rates). Most tax software handles the divergence; PettahPro provides the asset register; the actual tax computation is your accountant's domain.

**Can I depreciate inventory (stuff for resale)?**
No — inventory and fixed assets are different categories. Inventory's "decline in value" is COGS at sale, not depreciation. Items for resale belong in Inventory, not Fixed assets.

**An asset is fully depreciated but I'm still using it — what now?**
Net book value is zero, but you still have it. The asset stays on the register as fully depreciated. When you eventually dispose, any sale proceeds are pure gain (since NBV is zero).

**A small purchase (a chair, 5,000) — should it be a fixed asset?**
Materiality. Most businesses set a **capitalisation threshold** — items below the threshold are expensed immediately, items above are capitalised as fixed assets. 25,000 is a common threshold for SL SMEs. Configure in **Settings → Fixed assets → Threshold**.

**Asset stolen — how do I record it?**
**Disposal type = Stolen** (or Written off). PettahPro books the loss against an "Asset write-off" expense. If you have insurance and recover something, post a separate journal for the insurance proceeds.

## Related

- [Chart of accounts](./chart-of-accounts.md) — Fixed assets, Accumulated depreciation, Depreciation expense accounts.
- [Bills](../buy/bills.md) — capturing the acquisition.
- [Period close](./period-lock.md) — depreciation runs as part of close.
- [Opening balance](./opening-balance.md) — for loading existing assets when migrating.
