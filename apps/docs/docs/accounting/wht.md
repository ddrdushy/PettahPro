---
title: Withholding tax (WHT)
sidebar_position: 6
---

# Withholding tax (WHT)

## What it does

Withholding tax (WHT) is income tax that you (the payer) deduct at source from certain payments — typically professional services, rent, and director fees — and pay to Inland Revenue on the recipient's behalf. The recipient claims credit for it on their own tax return; the IRD tracks the WHT against both sides.

For Sri Lankan businesses paying suppliers, WHT is a routine operational cost — you pay 95 instead of 100, and remit 5 to IRD. PettahPro handles the calculation, the books, and the year-end Form WHT-T summary.

Common WHT rates:

- **5%** — professional services (consulting, legal, audit, training).
- **10%** — rent and director fees.
- **14%** — payments to non-residents (with treaty exceptions).

The exact rates and applicability change with each annual budget; PettahPro updates the codes centrally when they do.

## How it works

WHT is configured as a **tax code** (just like VAT). When you post a bill that needs WHT applied, you pick the WHT code on the line; PettahPro:

- Reduces what you owe the supplier by the WHT amount.
- Adds the WHT amount to **WHT payable** (a liability you owe IRD).
- Records the WHT on the bill with the supplier's TIN for the Form WHT-T.

When you remit the WHT to IRD (monthly), you post a payment from your bank against the WHT payable account. The liability clears.

At year-end, you file Form WHT-T listing every payment you made with the WHT details. PettahPro produces this from the data.

## Walkthrough

### Applying WHT to a bill

Open the bill (Buy → Bills → New bill).

1. Add the supplier (their TIN should be on file — otherwise, WHT isn't claimable for them).
2. Add the line — say, "Legal services 100,000".
3. **Tax code** — pick `WHT 5%` (or whichever rate applies).
4. Post.

PettahPro books the bill: AP goes up by 95,000 (not 100,000); WHT payable goes up by 5,000; the expense and VAT post normally.

When you pay the supplier, you pay 95,000 (the AP balance). They get a payment slip; the underlying bill records that 5,000 was withheld for IRD.

### Issuing a WHT certificate to the supplier

Suppliers sometimes ask for a WHT certificate — proof you've withheld and remitted on their behalf, so they can claim it. **Buy → Bills → \[the bill\] → Generate WHT certificate**. PettahPro produces the IRD-format certificate in PDF; email it to the supplier.

### Monthly WHT remittance

Open **Reports → WHT summary**, set the period to last month. The report shows total WHT collected by rate. Transfer the totals to the IRD e-Services portal, file the WHT return, pay.

After paying, post a payment in PettahPro from your bank to the WHT payable account. The WHT payable balance drops to zero (or close to zero, ready for next month's collections).

### Year-end Form WHT-T

The annual Form WHT-T lists every payment with WHT, by supplier, for the financial year. **Reports → WHT → Form WHT-T**, set the year, export. The IRD format file is ready to upload.

## Common tasks

### Add a custom WHT rate

PettahPro ships with the standard rates. If a specific contract has an unusual rate (e.g. 7.5% per a specific agreement), **Settings → Tax codes → + New tax code** with type WHT and the custom rate. Use it on the bill where it applies.

### Apply WHT to part of a bill only

A bill might have one professional-services line (WHT applies) and one supply-of-goods line (WHT doesn't apply). Pick the WHT code only on the line where it applies; leave the other line at standard VAT.

### Suppliers without TINs — can I still apply WHT?

Yes — the WHT calculation works regardless. But: you can't issue a Form WHT-T for a supplier without a TIN, which means they can't claim the credit. They'll likely push back. Best practice: get the supplier's TIN on file before posting their first bill.

### Reverse a WHT'd bill

Issuing a debit note for a bill that had WHT also reverses the WHT booking. The WHT payable comes down by the WHT portion of the credit. If you've already remitted the WHT, the reversal creates a refund-due situation — you'd reclaim from IRD on the next return.

### Track WHT per supplier

The supplier's record has a **WHT history** tab — shows every bill where WHT was withheld, the rate, the amount, the certificate status. Useful when a supplier asks "how much WHT did you withhold from me last year?"

## What gets posted

For a 100,000 bill with 5% WHT and 18% VAT:

- Subtotal: 100,000.
- VAT: 18,000.
- Total before WHT: 118,000.
- WHT (5% on 100,000): 5,000.
- AP (what we owe supplier): 113,000.

| Account | Debit | Credit |
|---|---|---|
| Expense | 100,000 | |
| VAT receivable | 18,000 | |
| Accounts payable | | 113,000 |
| WHT payable | | 5,000 |

When we pay the supplier:

| Account | Debit | Credit |
|---|---|---|
| Accounts payable | 113,000 | |
| Bank | | 113,000 |

When we remit the WHT to IRD:

| Account | Debit | Credit |
|---|---|---|
| WHT payable | 5,000 | |
| Bank | | 5,000 |

Net cash out: 118,000 (113k to supplier + 5k to IRD), matching the gross bill total. The WHT just splits where the money goes.

## FAQ

**WHT rates change with the budget — do I need to update them?**
No. PettahPro tracks the statutory rates centrally and updates the tax codes when budgets change them. Effective dates are honoured: a bill dated before a rate change uses the old rate; a bill dated after uses the new rate. Historical bills don't recompute.

**Should I withhold from VAT-registered suppliers?**
Yes — VAT registration and WHT are independent. WHT applies based on the type of payment (professional services, rent, etc.), not on the supplier's VAT status. A VAT-registered consultant still has 5% withheld.

**The supplier disputes the WHT and asks me not to withhold.**
Withholding isn't optional — if the payment type requires WHT, you must withhold by law. The supplier's recourse is to claim the WHT credit on their own tax return; they should provide their TIN so you can issue the certificate.

**Can I withhold less than the standard rate by agreement with the supplier?**
No — statutory rates are the law, not negotiable. Some suppliers have IRD-issued **WHT exemption certificates** (rare, for specific reasons); if so, that supplier's WHT can be set to zero on bills, with the certificate on file as evidence. Without the certificate, withhold at the standard rate.

**A supplier issued me a credit note for an old bill that had WHT — what happens?**
The debit note (your record of their credit) reverses the WHT proportionally. If you'd already remitted the WHT to IRD, the next month's WHT return reflects the reversal as a reduction. You don't claim back from IRD directly; the netting on the next return handles it.

**My WHT payable account never goes to zero.**
A small residual is normal at month-end (timing differences). A persistent large balance suggests either: (a) you're not remitting on time; (b) you posted WHT but the actual payment to IRD wasn't recorded in PettahPro; or (c) statutory rate changes mid-period created a mismatch. Run **Reports → WHT summary** to reconcile.

## Related

- [Bills](../buy/bills.md) — where WHT is applied.
- [Supplier payments](../buy/supplier-payments.md) — the AP amount is net of WHT.
- [VAT return](../reports/vat-return.md) — separate from WHT, but often filed in the same monthly cycle.
- [Settings → Tax codes](../settings/overview.md) — where WHT codes live.
- [Glossary — WHT](../concepts/glossary.md#wht--withholding-tax) — short definition.
