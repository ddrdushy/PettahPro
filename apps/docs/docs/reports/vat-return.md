---
title: VAT return
sidebar_position: 5
---

# VAT return

## What it does

The VAT return is the report you produce each filing period (monthly or quarterly, depending on your turnover) to declare to Inland Revenue how much VAT you collected, how much VAT you paid out, and the net you owe (or the refund you're due). PettahPro's VAT return summarises the period's transactions in the format the IRD e-Services portal expects, so you can transfer the numbers across with confidence.

The report doesn't file the return for you — you still go to the IRD portal and submit it there. But it gives you the data, with full drill-down so you can verify any number before you file.

## How to read it

Open **Reports → VAT return** and pick:

- **Filing period** — January, Q1, etc. PettahPro auto-detects whether you're monthly or quarterly from your business profile.
- **Year**.

The report has two main sections:

### Output VAT — what you collected from customers

Total VAT charged on:
- Standard-rated sales (18%).
- Zero-rated sales (0%).
- Exempt sales (no VAT).

Each is broken out by line, with the taxable value and the VAT amount.

### Input VAT — what you paid suppliers

Total VAT paid on:
- Standard-rated purchases.
- Capital goods purchases (often handled differently for input claim).
- Imports (VAT paid at customs).

Again, taxable value and VAT amount per line.

### Net VAT

**Output VAT − Input VAT** = what you owe the IRD (or the refund due to you, if input exceeds output).

The bottom of the report shows this as a single number — what you'll enter on the IRD portal as the net VAT payable.

## Common tasks

### File the return

1. Run the report for the filing period.
2. Review the numbers (drill into anything that looks off).
3. Open the IRD e-Services portal in another tab.
4. Transfer the numbers across to the IRD form.
5. Submit on the IRD side.
6. Once the IRD acknowledges, come back to PettahPro and click **Mark as filed**. PettahPro records the filing with date and reference number, and locks the return so it can't be re-run with different numbers.
7. When you pay the VAT, post a payment from your bank to the **VAT payable** account to clear the liability.

### Drill into a specific line

Click any number on the return to see the contributing transactions. The output VAT line opens the list of invoices that contributed; the input VAT line opens the list of bills. From there you can click into individual documents to verify.

### Reconcile against your bank

Once filed and paid, your VAT payable account should be at zero (or close to zero). The **GL filtered to VAT payable** for the period should match: opening balance + posted invoices' VAT − posted bills' VAT − the payment to IRD = closing balance.

### Handle a credit note that crosses periods

A credit note issued in May for an invoice in March reduces output VAT in May (when the credit note posts). PettahPro doesn't recompute prior periods — it correctly puts the reversal in the period it's posted. This is the standard SL VAT treatment.

### Export

Excel is the most useful format — you can re-sort, filter, and verify. PDF is the formal version. CSV is available if you're feeding the data into another system.

### See returns from past periods

Open **Reports → VAT return** and pick a past period. Returns marked as filed are read-only and show the locked-in numbers from the time of filing. Useful for audit reviews.

## What it draws from

The VAT return draws from every posted transaction in the period that has VAT:

| Source | What it contributes |
|---|---|
| Posted invoices | Output VAT (the VAT you charged customers) |
| Posted credit notes | Reversal of output VAT |
| Posted bills | Input VAT (the VAT you paid suppliers, claimable) |
| Posted debit notes | Reversal of input VAT |
| Imports / customs entries | Input VAT paid at the border (if recorded) |

The VAT return uses the **document date** to determine the period — not the posting date. A bill dated in March with VAT still belongs to March's return, even if you posted it in April.

## FAQ

**My filing period is monthly but the report defaults to quarterly.**
Check **Settings → Tax → VAT** and confirm the filing frequency is set to monthly. The report follows that setting.

**The report shows transactions I forgot to file last month — can I include them now?**
No. You file what's in the period; transactions from prior periods belong on prior returns. If a prior return was already filed and a transaction came to light afterwards, the IRD's process is to file a **revised return** for the prior period — talk to your tax practitioner about the correct route.

**Some of my customers don't have a TIN. Can I still claim input VAT on their VAT?**
Input VAT can only be claimed when the supplier is registered (has a TIN on the bill). Bills without a supplier TIN are flagged on the report under **Non-claimable input VAT** so you can see them, but they don't add to the claimable total.

**The report shows a refund due — what do I do?**
Either claim the refund from IRD (their process) or carry it forward to net against next period's payable. In SL practice, most businesses carry forward unless the refund is very large.

**What's the difference between zero-rated and exempt sales?**
Zero-rated sales (e.g. exports) are taxable at 0% — you don't charge VAT but you can still claim input VAT on related purchases. Exempt sales (e.g. financial services) are outside VAT entirely — you don't charge VAT and you can't claim input VAT on related purchases. The return shows both for completeness.

**I posted a bill before I had the supplier's TIN. Can I update it later?**
Edit the supplier record to add the TIN. Future bills automatically use it. For the historical bill, you can't edit it — but you can issue a debit note to reverse it and post a fresh bill with the TIN, if claiming the input VAT matters.

## Related

- [Settings → Tax codes](../settings/overview.md) — where the VAT codes are configured.
- [Sell → Invoices](../sell/invoices.md) — output VAT.
- [Buy → Bills](../buy/bills.md) — input VAT.
- [Glossary — VAT](../concepts/glossary.md#vat--value-added-tax) — the short definition.
