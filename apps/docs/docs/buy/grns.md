---
title: Goods Received Notes (GRNs)
sidebar_position: 3
---

# Goods Received Notes (GRNs)

## What it does

A Goods Received Note (GRN) records stock arriving from a supplier. It's the moment your inventory actually goes up and you owe the supplier for the goods — even if their bill hasn't arrived yet.

The point of a GRN is to keep stock movements honest. Goods often physically arrive before the supplier's bill — sometimes by days, sometimes weeks. Without a GRN, you'd either have to wait to update stock (which makes your stock counts wrong) or post a bill before you actually have one (which makes your AP wrong). The GRN bridges that gap: stock goes up now, the supplier balance becomes "we owe this, even though we haven't seen the bill yet", and when the bill eventually arrives it clears that gap.

You only need GRNs for **stock items**. Services and one-off purchases go straight to a bill.

## Walkthrough

Open **Buy → GRNs → + New GRN**.

1. **Pick a supplier.** If goods came against a PO, click **From PO** instead — pick the PO and the lines copy across.
2. **Set the receipt date.** This is the date stock physically arrived, not today's date.
3. **Pick the receiving warehouse.** If you only have one warehouse, this is set automatically.
4. **Add line items.**
   - Quantity received — this is the actual quantity that came in (which may differ from what you ordered).
   - Unit cost — the price you'll be paying for this item. Comes from the PO if you matched one, or the item's purchase price otherwise.
   - For batch- or serial-tracked items, enter the batch/serial details on the line.
5. **Optional: condition or remarks** — for any damage, shortages, or other notes you want on the record.
6. **Save as draft** to hold it pending verification, or **Post** to commit.

When you post:

- Stock goes up at the receiving warehouse for the quantity received.
- A liability appears in the **GRN clearing** account for the value of the goods.
- The GRN PDF is generated for your records.
- If you matched against a PO, the PO's outstanding quantity is reduced.

The GRN clearing balance hangs around until the supplier's bill arrives and is matched against the GRN — at that point, the GRN clearing balance reduces and the regular AP balance goes up.

## Common tasks

### Receive against a PO

If the goods came against a PO, click **From PO** when creating the GRN. Pick the PO; lines copy across with their committed quantities. Override the received quantity per line if it differs from what was ordered. PO status updates automatically — partial receipt stays "Open"; full receipt closes the PO.

### Match the supplier bill to the GRN

When the supplier's bill arrives, open it and click **Match GRN**. Pick the GRN(s) the bill covers. PettahPro:

- Pulls the lines from the GRN(s) into the bill.
- Reduces **GRN clearing** by the matched amount.
- Adds the same amount to **Accounts payable** (the regular supplier balance).
- Runs the three-way match check (PO ↔ GRN ↔ bill).

### Handle partial deliveries

Just enter the actual received quantity on the GRN — don't worry about matching the PO exactly. The PO stays open for the unfulfilled remainder. When the rest arrives, post another GRN against the same PO.

### Reverse a posted GRN

If you posted a GRN by mistake, open it and click **Reverse**. PettahPro books the opposite movement — stock goes back down, the GRN clearing reduces. The original GRN stays in the audit trail with status **Reversed**.

### Quality-check before accepting

If you need to inspect goods before they're "officially" received, save the GRN as a draft when they arrive. Once QC passes, post it. If something fails QC, you can either reduce the quantity on the draft and post (recording only what you accepted) or reject the whole shipment and not post at all.

### Receive into a specific batch or serial

For batch-tracked items (medicines, food), enter the batch number, expiry date, and supplier batch reference on the line. For serial-tracked items (phones, appliances), enter each unique serial. PettahPro tracks each batch and serial through its life — you can see where every unit came from and where it went.

## What gets posted

A GRN moves two accounts:

| Account | Debit | Credit |
|---|---|---|
| Inventory | Quantity × unit cost | |
| GRN clearing | | Same |

Your stock value goes up. The GRN clearing account holds a liability that says "we have these goods but haven't received the bill yet". When the supplier's bill arrives and is matched against the GRN, that clearing balance reverses:

| Account | Debit | Credit |
|---|---|---|
| GRN clearing | Bill amount | |
| Accounts payable | | Bill amount |

So the journey from order to settled is:

1. **PO sent** — nothing posted.
2. **Goods arrive (GRN)** — Inventory ↑, GRN clearing ↑.
3. **Bill arrives (matched to GRN)** — GRN clearing ↓, AP ↑.
4. **Bill paid** — AP ↓, Bank ↓.

## FAQ

**Why can't I just skip the GRN and post the bill when goods arrive?**
You can — for one-off purchases or services where stock isn't involved, that's exactly what people do. But for stock items, the bill often arrives later than the goods do, sometimes much later. Without a GRN, your stock and your books would be out of sync for that gap. The GRN bridges it.

**The supplier billed for a different quantity than I received. What now?**
The three-way match report at **Reports → Three-way match** shows the discrepancy. Talk to the supplier — usually you'd ask for a credit note for the variance, then post the bill against the GRN as it actually arrived (not as billed). The honest stock count and AP balance both stay correct.

**Goods arrived damaged. How do I record that?**
Two options. (1) Reduce the received quantity on the GRN to only what's usable; mark damaged stock as "rejected" with a note, and request a credit note from the supplier. (2) Receive the full quantity and immediately do a **stock adjustment** to write off the damaged units — useful when you might still claim from insurance.

**Can the same PO have multiple GRNs?**
Yes. A PO stays **Open** until its full quantity has been received. You can post as many GRNs against it as you need — useful for trickle deliveries or when an order arrives across multiple shipments.

**Do I need a GRN if the supplier delivers and bills the same day?**
Strictly no — you can skip the GRN and just post the bill, with the bill itself moving stock. But: it's harder to keep inventory accurate that way, and the audit trail is cleaner with a GRN. If you handle stock at all seriously, just post both.

**The GRN clearing account has been growing for months — is that a problem?**
Yes — that's an amber flag. It usually means you're receiving stock but bills aren't being entered against the GRNs. Each open GRN clearing entry is a "we have these goods but haven't recorded the bill yet" — fine for a few weeks, worrying for months. Run the **GRN clearing aging** report to see what's outstanding and chase the bills.

## Related

- **Purchase orders** — what you raise before a delivery.
- **Bills** — the supplier invoice, matched to the GRN.
- **Three-way match report** — checks PO ↔ GRN ↔ bill agree.
- **Stock adjustments** — for writing off damage or obsolescence.
- **Stock counts** — for periodic inventory verification.
- [Glossary — GRN](../concepts/glossary.md#grn--goods-received-note) — the short definition.
