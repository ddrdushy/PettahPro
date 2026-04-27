---
title: Credit notes
sidebar_position: 5
---

# Credit notes

## What it does

A credit note is the reverse of an invoice. You issue one to a customer when:

- The customer returned goods.
- The original invoice was wrong (wrong amount, wrong items, wrong customer).
- You're giving a discount or allowance after the original invoice has gone out.
- You're cancelling a sale that was already invoiced.

A credit note reduces what the customer owes you (AR) and reverses the VAT on the original. If the original involved stock-tracked items, it also puts stock back on the shelf.

You can't edit a posted invoice — that's how the audit trail stays clean. You issue a credit note instead, then a fresh invoice if needed.

## Walkthrough

Open **Sell → Credit notes → + New credit note**.

1. **Pick the customer**.
2. **Pick the invoice this credit note is against** — almost always the cleanest start. Click **From invoice**, pick the invoice. Lines copy across.
3. **Adjust lines** — for partial returns, reduce quantity. For corrections, change unit price or item.
4. **Reason** — pick from the dropdown (Return / Pricing correction / Discount / Cancellation / Other) and add a free-text note.
5. **Save as draft** or **Post**.

Posting:

- Allocates a credit note number.
- Reduces the customer's AR balance by the credit note total.
- Reverses VAT to **VAT payable** for the credit-note value.
- For stock items, returns the stock to inventory.
- Reverses the original COGS posting for those stock items.
- Generates the PDF for sending.

## Common tasks

### Refund the credit to the customer

After a credit note is posted, the customer has a credit balance with you. Two ways to settle:

- **Apply against a new invoice** — the customer's next invoice gets the credit netted off.
- **Refund the money** — go to **Sell → Refunds → + New refund**, pick the customer, allocate against the credit note. Money leaves your bank back to the customer.

### Issue a credit note without a referenced invoice

For one-off goodwill credits or for cases where the original invoice is from a previous system. **+ New credit note** without picking an invoice; enter the lines manually. Use the customer's credit going forward; refund it if they ask.

### Partial return

Customer bought 10 units, returns 3. Pick the original invoice, reduce the line quantity from 10 to 3 on the credit note, post. AR comes down by the value of 3 units; stock goes up by 3 units.

### Cancellation of an entire invoice

Pick the invoice, accept all lines as-is on the credit note, post. The original invoice still exists in the audit trail; it's just been fully credited. If the customer never paid, their balance is zero. If the customer had paid, they now have a credit balance you'll need to refund.

### Send the credit note to the customer

The **Send** button on the posted credit note emails the PDF. Same template engine as invoices; you can customise the layout.

### See the credit-note history for a customer

Customer detail → **Credit notes** tab shows every credit issued, with status (open credit / fully applied / refunded). Useful for tracking goodwill spend.

## What gets posted

For a typical credit note that fully reverses an invoice:

| Account | Debit | Credit |
|---|---|---|
| Sales revenue | Subtotal | |
| VAT payable | VAT amount | |
| Accounts receivable | | Total (incl. VAT) |

Customer's AR balance comes down. VAT collected is reversed. Income is reversed.

For stock-tracked items, additionally:

| Account | Debit | Credit |
|---|---|---|
| Inventory | Item cost × qty | |
| Cost of goods sold | | Same |

Stock comes back, COGS is reversed.

These are the exact opposite of what the original invoice posted — that's the point.

## FAQ

**The customer paid the full invoice, then returned half. How does that work?**
1. Issue a credit note for the returned half. Customer's AR drops to zero, then continues to a credit balance equal to the value of returned goods.
2. Either: (a) refund the credit balance to the customer (a refund payment); or (b) leave the credit on their account to apply against the next invoice.

Most customers prefer the credit-on-account approach for ongoing relationships.

**Can I edit a posted credit note?**
No. Like invoices, credit notes are locked once posted. To correct a wrong credit note, post another credit note (or invoice) that reverses the wrong one.

**Customer returned damaged goods that we can't resell — does stock still go up?**
By default yes. Then immediately post a **stock adjustment** to write off the damaged units (with a reason). Net effect: AR drops, stock stays the same, write-off expense appears on P&L. That's the audit-correct sequence.

**Can a credit note cross periods?**
Yes — the credit note's date is when it's issued. That date determines the period it lands in. The original invoice stays in its own period; the credit note goes in its own. Both periods need to be open at posting time.

**Multi-currency credit note — what FX rate?**
The credit note posts in the customer's invoice currency, converted to LKR at the credit note's date FX rate. If the rate has moved since the original invoice, the difference is recorded as a forex gain or loss.

**The customer says they didn't get the credit note. How do I confirm?**
Check **Settings → Notifications → Outbound email log**. You'll see whether the email was sent and whether the customer's mail server bounced it. Resend if needed; **Send** can be clicked again.

## Related

- [Invoices](./invoices.md) — what credit notes reverse.
- [Customer payments](./customer-payments.md) — where refunds happen.
- [Buy → Debit notes](../buy/bills.md) — the supplier-side equivalent.
- [Settings → Document templates](../settings/overview.md) — customise the credit-note PDF.
