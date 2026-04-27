---
title: Debit notes
sidebar_position: 5
---

# Debit notes

## What it does

A debit note is the reverse of a bill — the document you send a supplier when you're claiming a credit against something they billed you. Common reasons:

- Goods returned to the supplier (defective, wrong items, damage).
- Bill was over-charged or contained wrong items.
- Supplier offered a discount or allowance after billing.
- Cancellation of an order that was already billed.

A debit note reduces what you owe the supplier (AP) and reverses the input VAT on the original. If the original involved stock, it also takes the stock back out of inventory (since you're returning it).

You can't edit a posted bill — debit note is the audit-correct way to undo or adjust it.

Note: **debit note** here means the document you (the buyer) **issue** to the supplier. Some businesses also use "debit note" to refer to a bill they receive from a supplier — same concept, different perspective. PettahPro uses the buyer's perspective consistently.

## Walkthrough

Open **Buy → Debit notes → + New debit note**.

1. **Pick the supplier**.
2. **Pick the bill this debit note is against** — the cleanest path. Click **From bill**, pick the bill. Lines copy across.
3. **Adjust lines** — for partial returns, reduce quantity. For corrections, change unit price or item.
4. **Reason** — Return / Pricing correction / Discount / Cancellation / Other, plus a free-text note.
5. **Save as draft** or **Post**.

Posting:

- Allocates a debit note number.
- Reduces what you owe the supplier (AP) by the debit note total.
- Reverses input VAT to **VAT receivable** for the debit note value.
- For stock items, removes the stock from inventory (and reverses the inventory cost).
- Generates the PDF for sending to the supplier.

## Common tasks

### Get a refund from the supplier

After posting a debit note, your supplier balance has a credit (you've over-paid them or they owe you). Two ways to settle:

- **Apply against a future bill** — next bill from this supplier nets the credit off automatically (if you pick auto-allocation).
- **Get a refund** — supplier sends you money. Post it as a negative supplier payment (or via **Buy → Refunds**), allocated against the debit note.

### Issue a debit note without a referenced bill

For one-off claims (e.g. an SLA penalty against a supplier where there's no specific bill), create the debit note without picking a bill. Enter the lines manually. Often used for service-level agreement claims, late-delivery penalties, or quality rebates.

### Partial return

Bought 10 units, returning 3. Pick the original bill, reduce the line quantity from 10 to 3 on the debit note, post. AP drops by 3 units' value; stock goes down by 3 units (you're sending them back).

### Cancellation of an entire bill

Pick the bill, accept all lines as-is on the debit note, post. The original bill stays in the audit trail; it's just been fully credited. If you'd already paid it, you now have a credit balance to claim back from the supplier.

### Send the debit note to the supplier

The **Send** button on the posted debit note emails the PDF. Same template engine as bills.

### Track open debit notes

The debit notes list, filtered to **Status = Open** (not yet applied or refunded), is your "supplier owes us money" view. Useful for chasing refunds and for end-of-month reviews.

## What gets posted

For a typical debit note that fully reverses a bill:

| Account | Debit | Credit |
|---|---|---|
| Accounts payable | Total (incl. VAT) | |
| Inventory or expense | | Subtotal |
| VAT receivable | | VAT amount |

Supplier balance comes down. Input VAT is reversed (you can no longer claim it). Inventory or expense is reversed.

If WHT was withheld on the original bill, the WHT also reverses:

| Account | Debit | Credit |
|---|---|---|
| WHT payable | WHT amount | |
| Accounts payable | | WHT amount |

So the AP movement is the gross debit-note amount minus the WHT (matching how the original bill flowed in net).

## FAQ

**The supplier sent me a "credit note" — should I post that or a debit note?**
The supplier's credit note is functionally what you record as a debit note. They're the same event from two sides. Post a debit note in PettahPro that mirrors what they sent you.

**Can I edit a posted debit note?**
No. Like bills and credit notes, debit notes lock at posting. To correct, post another debit note (or a fresh bill) that reverses the wrong one.

**Returned goods that we then re-sold to a different customer — does stock matter?**
Don't return them, then. If the stock is genuinely going out of your warehouse to the supplier, the debit note's stock-removal effect is correct. If you're keeping the stock and the supplier's just giving you a price credit, use a debit note **without stock impact** — there's a toggle to skip the inventory effect.

**Multi-currency — what FX rate?**
The debit note posts in the supplier's bill currency, converted to LKR at the debit note's date FX rate. If the rate has moved since the bill, the difference posts as a forex gain/loss.

**The supplier is refusing to accept the debit note. What now?**
PettahPro can post the debit note regardless — the audit trail records what you've claimed. Whether the supplier accepts is a commercial conversation. If they don't, you might need to abandon the claim (post another bill / journal to reverse the debit note's effect) or escalate.

**Can a debit note cross periods?**
Yes — its date determines the period it lands in, regardless of the original bill's period. Both periods need to be open at posting.

## Related

- [Bills](./bills.md) — what debit notes reverse.
- [Supplier payments](./supplier-payments.md) — for refunds.
- [Sell → Credit notes](../sell/credit-notes.md) — the customer-side equivalent.
- [Settings → Document templates](../settings/overview.md) — customise the debit-note PDF.
