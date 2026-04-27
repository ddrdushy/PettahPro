---
title: Customer payments
sidebar_position: 6
---

# Customer payments

## What it does

A customer payment is the document that records money coming in from a customer — usually against one or more outstanding invoices. It increases your bank/cash balance and decreases what the customer owes you (AR).

PettahPro supports every common Sri Lankan payment method: cash, cheque, bank transfer, LankaQR, FriMi, Genie. Each is a first-class option on the payment screen — pick the method and the bank/cash account it lands in, and PettahPro takes care of the rest.

## Walkthrough

Open **Sell → Payments → + New payment**.

1. **Pick the customer**.
2. **Pick the payment method** — Cash / Cheque / Bank transfer / LankaQR / FriMi / Genie / Other.
3. **Pick the bank or cash account** the money landed in.
4. **Set the amount**.
5. **For cheques:** add the cheque number, the bank, and the expected clearance date. PettahPro will only count the money in your bank when the cheque clears (see Cheques below).
6. **Allocate** the payment against open invoices. Three options:
   - **Auto-allocate** — applies against the oldest open invoices first.
   - **Manual** — pick which invoices to allocate against, and how much per invoice.
   - **Unallocated** — leave the payment as a credit on the customer's account, to allocate later.
7. **Save as draft** or **Post**.

Posting credits the customer's AR balance and debits the bank/cash account.

## Common tasks

### Receive a partial payment

Customer paid 50,000 against a 100,000 invoice. Allocate 50,000 to the invoice. Invoice flips to **Partially paid**; the unpaid 50,000 stays open on AR aging. Next payment will allocate against the same invoice (or auto-allocate against the oldest, which might still be this one).

### Customer paid in advance

No invoice yet. Receive the payment and leave it **Unallocated**. The customer's account shows a credit balance. When you later post an invoice for them, the unallocated payment will auto-suggest as the allocation.

### Cheque payment workflow

A cheque has its own clearance cycle:

1. **Receive the cheque** — record the payment, the cheque number, the expected clearance date. PettahPro books the receipt to **Cheques on hand** rather than directly to your bank account.
2. **Deposit the cheque** at your bank. Update the payment to **Deposited**.
3. **Cheque clears** — typically 1–3 working days later. Update to **Cleared**. PettahPro then moves the money from "Cheques on hand" to your bank account.
4. **Cheque bounces** — update to **Bounced**. PettahPro reverses the receipt; the customer's invoice goes back to unpaid; you'd typically follow up with the customer.

### Receive a payment against multiple invoices

Customer paid one large amount that covers three open invoices. On the allocation step, manually distribute the payment across the three invoices. PettahPro shows you the running total to make sure it adds up to the payment amount.

### Refund a payment

Customer paid, but later returned the goods (via a credit note). Now they have a credit balance. **Sell → Refunds → + New refund**, pick the customer, allocate against the credit note. Money leaves your bank back to the customer.

### Receive payment via the customer portal

If you've enabled portal payments, the customer can pay invoices online via the portal (LankaQR, card, or bank transfer). Those payments come into PettahPro automatically with the allocation already applied.

### Email a receipt to the customer

After posting, click **Send receipt**. The customer gets a PDF receipt confirming what was paid and against which invoices.

## What gets posted

For a typical bank-transfer payment of 100,000 against an open invoice:

| Account | Debit | Credit |
|---|---|---|
| Bank — primary | 100,000 | |
| Accounts receivable | | 100,000 |

Bank balance up; AR down; the specific invoice is marked paid (or partially paid).

For a cheque payment, the journal posts in two steps:

**At cheque receipt:**

| Account | Debit | Credit |
|---|---|---|
| Cheques on hand | 100,000 | |
| Accounts receivable | | 100,000 |

**At cheque clearance:**

| Account | Debit | Credit |
|---|---|---|
| Bank — primary | 100,000 | |
| Cheques on hand | | 100,000 |

The two-step flow keeps "Cheques on hand" as a real interim asset — useful for reconciliation.

## FAQ

**The customer transferred but I haven't seen it in the bank yet — should I post the payment?**
Wait until you see it. Bank transfers can take a day or two; if you post before the money's there, you're crediting the bank account with money that hasn't arrived. Best to wait, or post against a "Funds in transit" account and reconcile when the money lands.

**Customer overpaid by 5,000 — what now?**
Allocate the actual invoice amount; leave 5,000 as unallocated credit on the customer. Apply against their next invoice, or refund if they ask.

**A bounced cheque was reversed but the customer says they did pay.**
Check the bank account — has the money actually arrived? If yes, the cheque bouncing might be a duplicate or a system error; reverse the bounce and re-post. If no, the customer is wrong (or remembering a different payment) — show them the bounce notice from your bank.

**Can I batch-post multiple payments at once?**
Yes — **Sell → Payments → Import**. Useful when you have a bank statement listing 50 incoming transfers. Upload the file, match each row to a customer, allocate, post.

**Multi-currency — customer paid in USD but my books are in LKR.**
Pick the foreign currency on the payment header. The amount stays in the customer's currency; the bank booking is in LKR converted at the day's rate. If the rate has moved since the invoice, the difference is recorded as a forex gain/loss automatically.

**Customer paid me in cash but doesn't want a receipt — should I still post?**
Yes. Posting keeps your books complete; the receipt is just a courtesy. If the customer doesn't want one emailed, you can skip the **Send receipt** step.

## Related

- [Invoices](./invoices.md) — what payments clear.
- [Credit notes](./credit-notes.md) — for refunds.
- [Customer portal](./customer-portal.md) — where customers pay online.
- **Bank reconciliation** — match payments to your bank statement.
- **Cheques** — the full cheque lifecycle.
