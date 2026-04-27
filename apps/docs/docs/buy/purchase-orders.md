---
title: Purchase orders
sidebar_position: 2
---

# Purchase orders

## What it does

A purchase order (PO) is the document you send to a supplier when you're committing to buy something from them. It's a formal "please send us this, at this price, by this date" — useful when you want a paper trail before goods arrive, when the supplier needs a PO number to invoice you, or when you want to track what's on order separately from what's been received.

A PO doesn't post to your books on its own. It commits you to a future purchase, but until the goods or services actually arrive (recorded as a GRN) and the bill comes in, no expense or stock has hit the ledger.

## Walkthrough

Open **Buy → Purchase orders → + New PO**.

1. **Pick a supplier.** Their default currency, payment terms, and any saved tax rules fill in.
2. **Set the PO date and expected delivery date.** Expected delivery is informational — it shows on the supplier's PO and in the open-PO report so you know what's overdue.
3. **Add line items.**
   - Click **+ Add line**, search for the item, set the quantity and unit price.
   - Tax code defaults to the item's purchase tax. Override per line if needed.
4. **Optional: shipping or other charges** — add as a separate line so the supplier sees the full breakdown.
5. **Save as draft** to keep editing, or **Send** to mark the PO as issued.

Sending a PO:

- Allocates a PO number from your number series.
- Generates the PO PDF you can email to the supplier.
- Marks the PO as **Open** — visible on the open-PO report until it's fully received and billed.

## Common tasks

### Email the PO to the supplier

Open the PO → **Send**. The dialog pre-fills the supplier's email and a default subject and body (configurable in **Settings → Notifications**). The PDF goes as an attachment.

### Receive goods against the PO

When the goods arrive, open the PO and click **Convert to GRN**. The lines copy across; you confirm what was actually received (quantities may differ from what you ordered) and post the GRN. That's when stock and the supplier-clearing balance hit your books.

### Convert directly to a bill (services, no GRN needed)

For services or anything you don't track in stock, you don't need a GRN — go straight from PO to bill. Open the PO → **Convert to bill**. Lines copy across; review and post.

### Track what's still open

The **Open POs** report at **Buy → Purchase orders → Open** shows every PO that hasn't been fully received and billed yet. Useful for chasing late deliveries and for forecasting cash — you know what's coming and roughly when.

### Close a PO that won't be fulfilled

If a supplier can't deliver and you don't want the PO lingering as "open", click **Close PO** on the detail page. It moves to **Closed** status and stops appearing on the open-PO report. Any partial deliveries already received stay on your books — closing only affects the unfulfilled remainder.

### Edit an open PO

Unlike a posted bill or invoice, a PO can be edited even after it's been sent — because nothing has hit your books yet. The change re-renders the PDF; resend to the supplier so they have the updated version.

## What gets posted

**Nothing.** A PO is a commitment, not a transaction. It doesn't move any account on its books.

What does happen:

- The PO appears on the **Open POs** report so you can track it.
- A reference is created so the GRN and bill can both link back to this PO.
- Once the GRN posts (stock arrives), inventory goes up and a **GRN clearing** balance appears.
- Once the bill posts, the GRN clearing balance clears and the supplier balance (AP) goes up.

So no journal entry on the PO itself — the postings happen at the GRN and the bill.

## FAQ

**Do I need to use POs at all?**
No — POs are optional. Many small businesses skip them and go straight from "phone the supplier" to "post the bill when it arrives". POs are useful when you have multiple people authorising purchases, when suppliers require a PO number on their invoice, or when you want a record of commitments separate from received goods.

**The supplier delivered more than the PO quantity — how do I handle it?**
On the GRN, just enter the actual received quantity. PettahPro will flag the variance against the PO so the three-way match report sees it. Either accept the variance (sometimes suppliers throw in extras) or send some back and ask for a debit note.

**The supplier delivered partially — can I close the PO partially too?**
Yes. Convert to GRN with the partial quantity. The PO stays **Open** with the remaining quantity. When the rest arrives, do another GRN against the same PO. When everything's been received, the PO automatically marks itself **Closed**.

**Can I require approval before a PO goes out?**
Yes — turn on **PO approval** in **Settings → Approvals**. POs over a chosen threshold need approval from a designated user before they can be sent.

**Why doesn't the PO appear on the trial balance?**
Because nothing has been recorded yet. POs are commitments, not transactions. The trial balance only shows things that have actually moved your books.

## Related

- **GRNs** — recording goods that arrive against the PO.
- **Bills** — the supplier invoice, posted after delivery.
- **Three-way match report** — checks PO ↔ GRN ↔ bill agree.
- **Purchase requisitions** — internal request that turns into a PO (if you use them).
- [Settings → Approvals](../settings/overview.md) — for requiring sign-off on POs above a threshold.
