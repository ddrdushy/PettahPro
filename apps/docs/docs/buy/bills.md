---
title: Bills
sidebar_position: 1
---

# Bills

## What it does

A bill is the document that records what you've bought, captures the VAT and any WHT, and creates a balance you owe the supplier until you pay them. It's the buying-side mirror of an invoice — most other Buy documents either lead up to a bill (purchase order, GRN) or reverse one (debit note).

PettahPro's bill handles stock and non-stock purchases on the same document, calculates input VAT and WHT for you, supports buying in any currency (your books stay in LKR), and lets you match against a PO or GRN so the three-way reconciliation works.

## Walkthrough

Open **Buy → Bills → + New bill**.

1. **Pick a supplier.** Their default payment terms, currency, and any saved tax rules fill in automatically.
2. **Set the bill date and due date.** The bill date is the date on the supplier's document (not today's date). Due date defaults to *bill date + their payment terms*.
3. **Enter the supplier's bill number.** This is the number on the supplier's invoice — useful for matching when they call about a specific one.
4. **Add line items.**
   - Click **+ Add line**, type the item name or code to search, and pick it.
   - Quantity and unit price come from your purchase price; tax is the item's purchase tax code. Override on the line if the supplier charged differently.
   - For stock-tracked products, posting the bill increases inventory at the unit cost on this line.
5. **Optional: WHT.** If you're withholding tax on this payment (typically 5% on professional services, 10% on rent), pick the WHT code. PettahPro reduces what you owe the supplier and books the WHT to your liability for remittance.
6. **Optional: match against a PO or GRN.** If the goods arrived with a GRN already, click **Match GRN** and pick it — quantities and prices fill in from the GRN. The bill then clears the "GRN clearing" balance for those items.
7. **Save as draft** to keep working on it, or **Post** to commit it to your books.

When you post, PettahPro:

- Allocates the next bill number from your number series.
- Adds the total to what you owe the supplier and records the expense (or stock + GRN clearing for stock items).
- Generates a PDF you can save for your records.
- Locks the document — any further changes need to go through a debit note.

## Common tasks

### Pay the bill

On the bill detail page, click **Pay bill**. That opens the supplier payment screen with this bill already selected. Pick the payment method, the bank account, and confirm the amount. PettahPro reduces your bank balance and clears the supplier balance for the amount paid.

### Edit a posted bill

Once a bill is posted, you can't edit it — your books are locked to keep accounting trustworthy. To correct a mistake:

- **Wrong amount or items:** issue a debit note for the original, then create a new bill with the right details. The debit note brings the supplier balance back to zero.
- **Wrong supplier or wrong date:** same approach — debit note + reissue.

### Match against a purchase order or GRN

If you raised a PO and the supplier delivered it (with a GRN), you don't have to re-key everything. On the new bill, **Match PO** or **Match GRN** copies the lines across. PettahPro then runs the three-way match check (PO ↔ GRN ↔ bill) and flags anything that doesn't tie up.

### Bill in a foreign currency

Pick the currency on the bill header. Lines stay in supplier currency. Your books post in LKR at the day's exchange rate. If the rate changes between when you receive the bill and when you pay, the small forex gain or loss is automatically recorded when the payment posts.

### Recurring bills

For bills that come on the same schedule every month — rent, internet, software subscriptions — set up a **recurring bill template** instead of entering each one by hand. PettahPro creates the draft on the schedule for you to review and post.

### WHT on professional services

When you're paying for professional services (legal, audit, consulting), you usually need to withhold 5%. On the bill, pick the **WHT 5%** tax code. PettahPro reduces the amount you owe the supplier by the WHT, and adds the same amount to **WHT payable** which you remit to Inland Revenue at the end of the month.

## What gets posted

A typical bill with VAT creates a journal entry that moves three accounts:

| Account | Debit | Credit |
|---|---|---|
| Expense (or Inventory for stock items) | Subtotal | |
| VAT receivable (input VAT) | VAT amount | |
| Accounts payable | | Total (incl. VAT) |

Your supplier balance goes up by the total. Your expense (or inventory) goes up by the pre-VAT amount. The input VAT sits in **VAT receivable** until it offsets your output VAT on the next return.

If you've withheld tax (WHT), there's an extra line:

| Account | Debit | Credit |
|---|---|---|
| Accounts payable | WHT amount | |
| WHT payable | | WHT amount |

That reduces what you actually owe the supplier and creates a separate liability for the tax that you'll remit to Inland Revenue.

For a stock item, the entry is the same shape but the debit goes to **Inventory** instead of an expense account. The cost only hits your P&L when you later sell the item — that's COGS doing its job.

## FAQ

**The supplier sent two copies of the same bill — should I post both?**
Only post the genuine one. PettahPro flags potential duplicates by checking the supplier's bill number against bills you've already posted from that supplier. If you accidentally do post both, issue a debit note for the duplicate.

**The bill matches the PO but not the GRN — what now?**
The three-way match report at **Reports → Three-way match** shows you exactly where the mismatch is — usually it's a quantity difference (you ordered 100, got 95, but the supplier billed for 100). The honest answer is to talk to the supplier and either get a credit note from them, or accept the variance and adjust on your side.

**Can I post a bill without matching a PO?**
Yes. PO matching is optional. Many small businesses don't bother with formal POs — they place orders by phone or email and just post the bill when it arrives.

**The supplier doesn't have a TIN — can I still claim the input VAT?**
Only if the supplier is VAT-registered. Without a TIN on the bill, the input VAT can't be claimed. Talk to the supplier about getting their VAT certificate, or treat the full amount as expense.

**I imported the bill before the goods arrived. How do I reconcile when the GRN comes in?**
This is the "bill before GRN" case. PettahPro records the bill as normal but expects a matching GRN — the **GRN clearing** account stays open until the GRN posts. The GRN then closes that clearing balance against inventory.

## Related

- **Purchase orders** — what you raise before the bill arrives.
- **GRNs** — what records stock arriving from the supplier.
- **Supplier payments** — how to clear the supplier balance.
- **Debit notes** — for reversing or correcting a posted bill.
- **Recurring bills** — for bills that repeat on a schedule.
- [Settings → Tax codes](../settings/overview.md) — for setting up your VAT and WHT codes.
