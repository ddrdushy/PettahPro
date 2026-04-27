---
title: Three-way match
sidebar_position: 11
---

# Three-way match

## What it does

The three-way match report reconciles three documents that describe the same purchase: the **purchase order** you raised, the **GRN** that records the goods arriving, and the **bill** the supplier sent. Ideally they all agree — same items, same quantities, same prices. In practice, they often don't, and the three-way match is how you catch the mismatches before they cost you money.

Common things three-way match catches:

- A supplier billed for more than they delivered.
- A receiver counted in fewer units than the supplier shipped (potential theft or damage in transit).
- A price on the bill is higher than the PO (price drift).
- A bill came in for goods that were never received (potential fraud).
- A GRN was posted but no bill ever arrived (supplier hasn't billed yet, or the bill was lost).

## How to read it

Open **Reports → Three-way match**. The report shows one row per **incomplete or mismatched** purchase, with columns:

- **PO number / date / supplier**.
- **GRN(s)** — which GRNs reference this PO.
- **Bill(s)** — which bills reference this PO or GRN.
- **PO total** — value at the time of the PO.
- **GRN total** — value of what was received.
- **Bill total** — value of what was billed.
- **Status** — what's mismatched or missing.
- **Variance** — the worst single difference among the three.

Status values you'll see:

- **Matched** — all three documents agree. (Hidden by default; toggle "Show matched" to include them.)
- **Bill missing** — PO + GRN posted, no bill yet. Often fine — supplier hasn't billed.
- **GRN missing** — PO + bill posted, no GRN. Worth investigating — did the goods actually arrive?
- **Quantity mismatch** — one of the three has different quantities. Investigate.
- **Price mismatch** — one of the three has different prices. Investigate.
- **No PO** — bill posted with no PO reference. Fine if you don't use POs; flag-worthy if you do.

## Common tasks

### Run a weekly three-way review

Filter to **Status ≠ Matched**. Sort by variance descending. Work down the list, resolving each one. Most will be small things (ones-and-twos differences); some will reveal real problems (a supplier double-billing, a missed delivery).

### Resolve a "GRN missing" case

PO and bill posted, no GRN. Two possibilities: the goods arrived but nobody posted the GRN (chase the warehouse team), or the bill was posted prematurely (the goods aren't actually here yet — chase Accounts). Either way, post a GRN to close the loop, or reverse the bill if it shouldn't have been posted.

### Resolve a "Bill missing" case

PO and GRN posted, no bill. Usually fine — wait for the supplier's bill. If it's been weeks, chase the supplier. If it's been months, the supplier may have lost track — call them.

### Resolve a quantity mismatch

PO said 100, GRN said 95, bill said 100. The supplier billed for the full amount, but you only received 95. Three options:

1. **Get a credit note from the supplier** for the missing 5. Post the credit note; the bill clears against the GRN at the actual quantity.
2. **Accept the variance** — sometimes the goods arrived later or the count was wrong. Post a stock adjustment or amend the GRN.
3. **Reject the bill and ask for a corrected one** — the cleanest option. Don't post it until the bill matches reality.

### Resolve a price mismatch

PO said 100/unit, bill says 110/unit. Either the supplier raised prices without telling you (talk to them) or your buyer agreed verbally (your buyer should have updated the PO). Either way, the bill should match the actual price agreed.

### Filter to a specific supplier

Useful when reviewing one supplier's account in detail. The report filtered to one supplier shows you their match-rate over time — how often they bill correctly.

### Export

Excel for working through the list with a colleague. PDF for sharing with management.

## What it draws from

| Side | Source |
|---|---|
| PO data | Posted purchase orders |
| GRN data | Posted GRNs that reference a PO |
| Bill data | Posted bills that reference a PO or GRN |
| Status | Computed: which documents exist and whether quantities/prices match |

The report only includes purchases where at least one of the three documents exists and isn't fully reconciled.

## FAQ

**My business doesn't use POs. Is this report useful?**
Less so. Without POs, the report becomes a "GRN vs bill" two-way match — still useful for catching billing errors, but the "did we actually order this?" check is missing. If you're not using POs but want stronger purchase controls, consider adopting them at least for high-value purchases.

**A bill was posted that doesn't match a GRN. The supplier insists they delivered. What do I do?**
Investigate physically — was it received but not GRN'd? Was it delivered to the wrong location? Was it lost? Don't accept "we delivered, you didn't receive" without evidence. The three-way match flags it; the resolution is offline.

**Can I auto-match if everything agrees within a small tolerance?**
Yes — set a **tolerance** in **Settings → Procurement → Match tolerance**. Within tolerance (e.g. 1% or LKR 100), variances are considered "Matched" and don't appear on the report. Useful for ignoring rounding differences.

**The report shows the same PO multiple times — why?**
A PO with multiple GRNs and multiple bills shows once per "match group" — the system tries to pair up which GRN goes with which bill. If pairing is ambiguous, multiple rows can appear. Resolve by being explicit on the bill which GRN it covers.

**A bill was matched to the wrong GRN — how do I fix it?**
Open the bill, edit the GRN reference, save. The match recomputes immediately.

**Can three-way match catch fraud?**
It catches **patterns** that suggest fraud — bills with no GRN (paying for goods that never arrived), GRNs with prices higher than PO (collusion with supplier), repeated near-tolerance variances always favouring the supplier. It doesn't prove fraud; it surfaces the patterns that warrant investigation.

## Related

- [Buy → Bills](../buy/bills.md).
- [Buy → Purchase orders](../buy/purchase-orders.md).
- [Buy → GRNs](../buy/grns.md).
- [Settings → Approvals](../settings/overview.md) — for adding approval gates on bills above a threshold.
