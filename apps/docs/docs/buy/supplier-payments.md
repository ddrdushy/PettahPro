---
title: Supplier payments
sidebar_position: 4
---

# Supplier payments

## What it does

A supplier payment is the document that records money going out to a supplier — usually against one or more outstanding bills. It reduces your bank/cash balance and reduces what you owe the supplier (AP).

The mirror of customer payments: same shape, opposite direction. Same payment methods supported (cash, cheque, bank transfer, online), same allocation flow.

## Walkthrough

Open **Buy → Payments → + New payment**.

1. **Pick the supplier**.
2. **Pick the payment method** — Cash / Cheque / Bank transfer / Online / Other.
3. **Pick the bank or cash account** the money came from.
4. **Set the amount**.
5. **For cheques you're issuing:** add the cheque number, the bank, and the issue date. (Cheques you write follow the same lifecycle as cheques you receive — see Cheques below.)
6. **Allocate** the payment against open bills:
   - **Auto-allocate** — applies against the oldest open bills first.
   - **Manual** — pick which bills to allocate against, and how much per bill.
   - **Unallocated** — leave the payment as a credit on the supplier's account.
7. **Save as draft** or **Post**.

Posting reduces your bank balance and reduces the supplier's AP.

## Common tasks

### Pay a single bill

The cleanest path: open the bill → **Pay bill**. Opens the payment screen with this bill already selected. Pick the method, the bank, confirm the amount.

### Bulk-pay multiple bills at once

Common for paying a supplier you owe several months of bills. **Buy → Payments → + New payment**, pick the supplier, then on the allocation step select all the bills (or use auto-allocate). One payment record clears multiple bills.

### Pay multiple suppliers at once

If you're doing a payment run (paying 20 suppliers on the 25th of the month, say), use **Buy → Payment runs → + New payment run**. Pick which bills are in the run; PettahPro generates the bank file (CSV in your bank's expected format) for upload to the corporate banking portal. Once the bank confirms, mark the run as paid; one supplier-payment record gets created per supplier.

### Cheque payment workflow

Cheques you write to suppliers follow a lifecycle:

1. **Issue cheque** — record the payment with the cheque number. PettahPro books the payment to **Cheques outstanding** rather than directly to your bank.
2. **Cheque presented and cleared** — bank confirms the supplier presented the cheque. Update to **Cleared**. PettahPro then moves the amount from "Cheques outstanding" to your bank.
3. **Cheque cancelled / lost** — update to **Cancelled**. The cheques outstanding balance reverses; you'd typically issue a replacement.

The two-step flow keeps your bank balance accurate to what's actually been debited — useful for cash-flow management when you've issued cheques the supplier hasn't presented yet.

### Pay a supplier in a foreign currency

Pick the foreign currency on the payment header. The amount stays in supplier currency; the bank booking is in LKR converted at the day's rate. If the FX rate has moved since the bill, the difference is recorded as a forex gain/loss.

### Refund from a supplier

If a supplier credited you (debit note) and is sending money back, record it as a **negative supplier payment** — or use **Buy → Refunds**. Increases your bank, reduces the supplier credit balance.

### Email a remittance advice to the supplier

After posting, click **Send remittance**. The supplier gets a PDF summarising what you paid and against which bills — useful when payments cover multiple bills and the supplier needs to know how to allocate on their side.

## What gets posted

For a typical bank-transfer payment of 100,000 against an open bill:

| Account | Debit | Credit |
|---|---|---|
| Accounts payable | 100,000 | |
| Bank — primary | | 100,000 |

Bank balance down; AP down; the specific bill is marked paid (or partially paid).

For a cheque payment, the journal posts in two steps. **At cheque issue:**

| Account | Debit | Credit |
|---|---|---|
| Accounts payable | 100,000 | |
| Cheques outstanding | | 100,000 |

**At cheque clearance:**

| Account | Debit | Credit |
|---|---|---|
| Cheques outstanding | 100,000 | |
| Bank — primary | | 100,000 |

If WHT was withheld on the original bill, the WHT portion stays in the **WHT payable** liability — paid separately to Inland Revenue at month-end.

## FAQ

**A bill includes WHT — does the supplier payment match the bill total or the net?**
The net. If the bill was 100,000 with 5,000 WHT withheld, the supplier gets 95,000 (which is the AP balance). The 5,000 WHT stays in **WHT payable** until you remit it to IRD.

**Supplier asked me to pay against an old bill instead of the new one I'd planned.**
On the allocation step, manually pick the old bill instead of accepting auto-allocate's choice. The customer always wins on what they want allocated.

**The bank rejected my payment file with format errors.**
Different banks expect slightly different CSV / text formats. **Settings → Banks** lets you pick the right format per bank account. If your bank's format isn't listed, contact support — adding a new bank format is a quick fix.

**Multi-currency: I owe in USD but want to pay in LKR.**
Set the payment currency to LKR; tell PettahPro you're paying X LKR; on the allocation step, pick the USD bill — PettahPro shows the equivalent USD covered at the day's rate. The bill is settled (full or partial); any FX difference posts as a gain/loss.

**Can I post a payment for a future-dated cheque?**
Yes — record the cheque now with the issue date. Mark it as **Cleared** when the supplier actually presents it. This keeps "Cheques outstanding" reflecting reality.

**Can I undo a posted payment?**
You can **reverse** it. The reversal adds the bill back to AP and the bank balance back. Original payment stays in audit trail with status Reversed.

## Related

- [Bills](./bills.md) — what payments clear.
- [Debit notes](./debit-notes.md) — supplier-side credits.
- [Sell → Customer payments](../sell/customer-payments.md) — the mirror image.
- **Bank reconciliation** — match payments to your bank statement.
- **Cheques** — the full cheque lifecycle.
