---
title: Point of sale (POS)
sidebar_position: 10
---

# Point of sale (POS)

## What it does

The point of sale (POS) is the cashier-facing screen for businesses with a sales counter — retail shops, restaurants, cafes, pharmacies. It's a stripped-down, fast invoicing screen designed for over-the-counter sales: scan or tap items, take payment, hand the customer a receipt, move on. No quotations, no sales orders, no allocation — just sale, payment, done.

POS sales post to your books exactly like regular invoices, with the same accounting treatment (revenue, VAT, COGS for stock items). The difference is the screen: POS is optimised for speed and touch input, not for finance-team detail.

## Walkthrough

Open **Sell → POS**.

The POS screen has three areas:

- **Item picker** — search by name, scan a barcode, or pick from a tile grid (most-sold items pinned for one-tap).
- **Cart** — the items being added to the current sale. Each line shows qty, price, and total.
- **Pay** — the payment panel where you take payment.

### A typical sale

1. Customer puts items on the counter.
2. Cashier scans (or types) each item — it lands in the cart.
3. Adjust quantities if multiple of the same item.
4. Cashier reviews total with the customer.
5. Click **Pay** → pick the method (Cash / Card / LankaQR / FriMi / etc.) → enter amount tendered for cash sales (POS calculates change) → confirm.
6. Receipt prints (or emails / SMS to customer if they prefer).
7. Cart clears, ready for the next sale.

The whole thing takes 30 seconds for a typical sale. Slower for the first one of the day; faster once the cashier knows their items.

### Customer optional

Most POS sales are to walk-in customers — you don't capture their details. The sale just records as a "Walk-in customer".

For loyalty programs or B2B counter sales, attach a customer to the sale before paying. Their details fill in (with their loyalty discount applied if they're enrolled).

## Common tasks

### Open the till for the day

First sale of the day, the cashier sets the **opening cash float** — what's in the till before sales start. Used at end-of-day for cash reconciliation.

### Close the till at end of day

End of day: **POS → Close till**. Cashier counts the cash in the till and enters the actual amount. PettahPro shows what was expected (opening float + cash sales − any cash payouts) and the variance. If there's a variance, cashier explains (or doesn't); the variance posts to a "Cash over/short" account on the P&L.

### Cash payout from the till

Sometimes the till is the source of small operational payments — petty cash for office supplies, staff meal money, supplier delivery COD. **POS → Cash out** records this; it doesn't go through normal supplier payments. End-of-day cash reconciliation accounts for it.

### Apply a discount

Cashier-applied discount: tap **Discount** in the cart and enter percentage or amount. Permission can be limited (junior cashiers can apply up to 5%, supervisors up to 20%, managers can override anything).

### Refund a sale

Customer returns an item. **POS → Refund**, find the original sale (by receipt number or by customer), pick the items being returned, process the refund (cash back, card refund, or store credit). Stock returns to inventory automatically.

### Multiple cash drawers

Each POS terminal can have its own cash drawer. Sales recorded at terminal A go to drawer A; drawer A's reconciliation is independent of drawer B. Useful for businesses with multiple sales counters open at once.

### Quick item add for one-off items

For items you sell occasionally that aren't worth setting up as proper items: **+ Quick item** lets the cashier enter a description, price, and tax inline. It posts as a one-off sale to a generic "Miscellaneous" item.

### Print or email receipt

Default is print (most retail customers expect a paper receipt). For customers who want email or SMS, hit **Email receipt** or **SMS receipt** — they enter their address/phone on the spot.

## What gets posted

A POS sale posts the same way as a regular invoice posted in cash:

| Account | Debit | Credit |
|---|---|---|
| Cash on hand (or Bank, for card / QR sales) | Total (incl. VAT) | |
| Sales revenue | | Subtotal |
| VAT payable | | VAT |

For stock items, the stock-and-COGS posting also happens:

| Account | Debit | Credit |
|---|---|---|
| Cost of goods sold | Item cost × qty | |
| Inventory | | Same |

End-of-day cash reconciliation posts any variance:

| Account | Debit | Credit |
|---|---|---|
| Cash over/short (P&L) | Variance (debit if short) | |
| Cash on hand | | Variance |

Or the reverse if the till is over.

## FAQ

**Does POS need an invoice number for every sale?**
Yes — every POS sale is a numbered invoice in the system, just generated from a different screen. The customer's receipt shows the invoice number. For tax purposes, every sale must be invoiced.

**A customer is asking for an invoice in their company name after the sale was already done as walk-in.**
Open the POS sale → **Convert to named invoice** → enter the customer's details → save. The receipt becomes a real invoice with their TIN and details, and the customer can claim input VAT if they're VAT-registered.

**The till is short by 500 at end of day — is that a problem?**
Small variances happen — change errors, miscount. The system records the variance and books it to "Cash over/short". A consistent pattern (one cashier always short, etc.) is worth investigating.

**Can POS work offline?**
Limited. The browser-based POS needs internet for stock checks and posting. For brief outages, you can keep selling — sales queue locally and post when the connection's back. For longer outages, escalate or use a backup process.

**Does POS support split payments — half cash, half card?**
Yes. On the Pay screen, add multiple payment methods, each with its own amount, that sum to the total.

**Loyalty programs — how do they work?**
Customer is enrolled with a phone or card. At checkout, cashier enters the customer's reference; the loyalty discount applies. Points accrue automatically based on the sale total. Configurable in **Settings → Loyalty programs**.

## Related

- [Invoices](./invoices.md) — POS sales are invoices, just generated faster.
- [Customer payments](./customer-payments.md) — for non-counter payment flows.
- [Items](../inventory/items.md) — the master data POS depends on.
- **Cash reconciliation** — the end-of-day flow for till variance.
- **Loyalty programs** — for repeat-customer discounts.
