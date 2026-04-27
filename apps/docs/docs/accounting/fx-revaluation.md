---
title: FX revaluation
sidebar_position: 7
---

# FX revaluation

## What it does

FX revaluation is the periodic adjustment of foreign-currency balances on your books to reflect the current exchange rate. If you have an unpaid USD invoice from a customer, that invoice was originally booked at the rate on the invoice date — but by month-end, the LKR has moved, and the LKR-equivalent of that USD amount is different. FX revaluation updates the LKR value of those balances to the current rate; the difference posts as an unrealised gain or loss.

Without revaluation, your LKR books would systematically misstate what foreign-currency balances are worth. With it, your balance sheet at month-end actually reflects today's rates.

If your business doesn't have foreign-currency transactions, FX revaluation doesn't apply.

## How it works

The cycle is:

1. **Through the period** — every foreign-currency transaction posts at its date's rate.
2. **At period-end** — you run FX revaluation. PettahPro looks at every open foreign-currency balance (unpaid AR/AP, foreign-currency bank balances) and:
   - Calculates the current LKR value (balance × current rate).
   - Compares to the booked LKR value.
   - Posts the difference as an unrealised gain or loss.
3. **At next period start** — the revaluation either reverses (most common) or stays (less common). With reversal, each period starts fresh; without, you'd need to track cumulative revaluation.
4. **When the foreign-currency balance settles** — the actual realised gain or loss posts (the difference between the original booked rate and the settlement rate).

## Walkthrough

### Running revaluation

Open **Accounting → FX revaluation → + New revaluation**.

1. **As-at date** — typically last day of the month or year.
2. **Currencies to revalue** — pick which (USD, EUR, etc.) or all.
3. **Reversal** — turn on for "post and reverse next period" (most common); off for cumulative.
4. **Click Calculate**. PettahPro shows you, per balance, the booked LKR value, the current LKR value (at the as-at rate), and the variance.
5. Review the variances; **Post**.

PettahPro books each variance as a journal entry. A summary entry posts the totals; per-customer / per-supplier / per-bank-account breakdowns are stored on the revaluation document for traceability.

### Updating exchange rates

Before running revaluation, make sure your **rate table** is current. **Accounting → FX rates** has the daily rates. PettahPro can fetch from the Central Bank of Sri Lanka's daily rates automatically (configure in **Settings → FX → Auto-fetch source**), or you can enter manually if you prefer to use your bank's rates.

### Reverse a revaluation

If the revaluation was posted with the wrong as-at rate or against the wrong period, **Reverse**. The journal posted by the revaluation is undone; you can re-run with corrections.

## Common tasks

### Run monthly revaluation as part of close

Standard pattern: as part of the month-end close, run FX revaluation as at the last day. Lock the period afterwards. Next period the reversal posts on day 1, so the period starts fresh.

### Run annual revaluation only

Smaller businesses with limited FX activity sometimes run revaluation only at year-end. Acceptable, though the monthly P&L will swing more in months with significant rate changes. **Settings → FX → Revaluation frequency** can be set to monthly / quarterly / annual.

### See FX exposure at any point

Revaluation produces a snapshot — but you can also run **Reports → FX exposure** at any date to see your foreign-currency open balances and their LKR equivalents at the date's rates. Useful for forecasting and risk management without actually posting a revaluation.

### Hedge the exposure

If you're holding significant USD AR or USD bank balance and want to hedge against LKR strengthening: forward contracts, options, etc. PettahPro can record forward contracts and treats them as a separate FX-instrument balance. (Hedge accounting is its own topic; talk to your accountant.)

### Multi-currency journal entry

For one-off cross-currency adjustments, post a manual journal in the foreign currency — the journal converts to LKR at the journal date's rate, and the resulting LKR entry hits the GL.

## What gets posted

### During the period — at invoice / bill / payment

Each transaction posts in its document currency, converted to LKR at the document's date rate. The LKR entry is what hits the GL. The original FC amount is stored on the line for reference.

### At settlement — realised FX gain/loss

When a foreign-currency balance settles (USD invoice paid, USD bill paid):

- The bank/cash transaction posts in LKR at the settlement-date rate.
- The AR or AP balance had been booked at the original invoice/bill rate.
- The difference is **realised FX gain/loss**, posted to a P&L account.

| Account | Debit | Credit |
|---|---|---|
| Bank | LKR at settlement rate | |
| Accounts receivable | | LKR at original rate |
| FX gain (or loss) | | (or DR) the difference |

### At period-end — unrealised FX gain/loss

For balances **still open** at period-end:

| Account | Debit | Credit |
|---|---|---|
| Accounts receivable | (or CR) the change in LKR equivalent | |
| Unrealised FX gain (or loss) | | (or DR) the same |

The "Unrealised FX gain/loss" account is on the P&L. With reversal turned on, this entry reverses on day 1 of the next period — so the next period's AR is back to its original booked LKR, ready to revalue again at the new period's end.

## FAQ

**Should I use realised or unrealised FX gain/loss accounts?**
Both. **Realised** is when a transaction settles — the gain or loss is locked in. **Unrealised** is when a balance is still open at period-end — the gain or loss reflects the rate movement but hasn't been realised yet (settlement could move the rate further). Most P&Ls show them as separate lines.

**My foreign-currency bank balance fluctuates daily. Should I revalue daily?**
For most businesses, monthly is enough. Daily revaluation is overhead without much value — you're chasing intra-month rate noise. The exception: businesses with very large FX exposures where daily P&L swing matters (e.g. proprietary trading desks).

**The IRD requires FX gains to be reported as taxable income — does PettahPro handle that?**
Yes. The FX gain account is on the P&L, so it flows into taxable income for income-tax purposes. Realised vs unrealised treatment varies by tax law — some jurisdictions only tax realised, some tax both. Talk to your tax advisor for specifics; PettahPro's role is to track them clearly so your advisor can apply the right rule.

**FX rates auto-fetch isn't working.**
Check **Settings → FX → Source**. The Central Bank of Sri Lanka feed is the default; if it's down, you can switch to manual or an alternative source. The rate-update log shows when each currency was last successfully updated.

**Multi-currency consolidation across group entities.**
Each business in PettahPro is a separate entity with its own books. For group consolidation in a different currency, the consolidation step is currently external — export each entity's data, consolidate in spreadsheet or BI tool. A built-in consolidation module is on the roadmap.

**An invoice was booked at a wrong FX rate. How do I fix?**
Don't edit the invoice — issue a credit note and reissue at the correct rate, with description noting the FX correction. The audit trail stays clean.

## Related

- [Chart of accounts](./chart-of-accounts.md) — FX gain / loss / unrealised accounts.
- [Bank reconciliation](./bank-reconciliation.md) — for foreign-currency bank accounts.
- [Period close](./period-lock.md) — revaluation typically runs as part of close.
- [Sell → Invoices](../sell/invoices.md) and [Buy → Bills](../buy/bills.md) — where FX rates are first applied.
