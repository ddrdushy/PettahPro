---
title: Trends
sidebar_position: 9
---

# Trends

## What it does

The Trends report takes any P&L line, balance-sheet line, or KPI and shows you how it's moved over time — month by month, quarter by quarter, or year by year. A single number ("revenue this month was 5.2 million") tells you nothing without context. The trends report gives you the context: "this month was the highest in the last 12 months" or "this is the third consecutive month of decline".

Use trends when you want to understand the **direction** of a number rather than its current value.

## How to read it

Open **Reports → Trends**.

You pick:

- **Metric** — any P&L line, any balance-sheet line, or any pre-built KPI (revenue, gross margin %, AR days, etc.).
- **Period** — monthly / quarterly / annual.
- **Range** — last 6 months, 12 months, 24 months, or custom.
- **Compare** (optional) — pick a comparison metric to overlay (e.g. revenue vs. expenses).

The report renders as a chart with the period along the x-axis and the metric on the y-axis. Below the chart is a table showing each period's value plus the variance vs. the previous period (both absolute and percentage).

If you've added a comparison metric, both lines appear on the chart and the table shows both.

## Common tasks

### Track sales growth month over month

Pick **Revenue** as the metric, **Monthly**, last 12 months. The chart immediately tells you whether sales are growing, flat, or declining. The table tells you the exact rate.

### Check whether a fixed-cost increase is justified

Pick **Salaries** as the metric vs **Revenue** as the comparison. If salaries are growing faster than revenue (the line is steeper), your salary-to-revenue ratio is creeping up — that's pressure on profitability.

### Spot seasonality

12 months of revenue trends usually shows a pattern — December is usually higher, January is usually lower, etc. Two years of data makes the seasonality obvious. Useful for forecasting and for explaining variance ("yes, January was down, but that's normal — it was up vs. last January").

### Track a margin

Pick **Gross margin %** as the metric. Watching gross margin trend over time is one of the most useful things a small business can do — falling gross margin is a leading indicator of trouble (input cost inflation, customer mix shift, discounting, product mix).

### Compare two divisions or branches

If your transactions are tagged with cost centres, you can pick a metric and split it by cost centre. The chart shows one line per branch — useful for "which branch is performing?"

### Export the chart

PDF or PNG. Useful for board packs and investor updates.

## What it draws from

The Trends report draws from the same sources as the underlying reports:

| Metric | Source |
|---|---|
| P&L lines (revenue, expenses, profit) | Posted income/expense entries within each period |
| Balance-sheet lines (cash, AR, inventory) | The balance-sheet account at the end of each period |
| Margin % metrics | Calculated from the underlying P&L lines |
| Days metrics (AR days, AP days) | Calculated from the relevant balance and the underlying flow |

For period-end balance-sheet metrics, the value is the balance **at the close of the period** — e.g. "AR at end of March".

For flow metrics (revenue, expenses), the value is the **total during the period**.

## FAQ

**Why is the most recent period showing a partial value?**
If the current month isn't over yet, the most recent bar represents month-to-date — not a full month. Some people prefer to exclude the current period for that reason; toggle **Exclude current period** in the report settings.

**Can I see the trend for a single account?**
Yes — pick **Account** as the metric source, then pick the specific account from your chart. The trend shows that account's balance (for balance-sheet accounts) or its activity (for P&L accounts).

**The chart looks weird — one period is hugely higher than all the others.**
That's usually a signal of a one-off entry. Click the period to see the underlying transactions; you'll often find a year-end accrual or a manual journal that's a one-off rather than a recurring flow.

**Can I save a trend chart for re-use?**
Yes — click **Save** and give it a name. Saved charts appear in **My reports** and can be added as a tile to the Executive KPIs dashboard.

**Does the trend report use accrual or cash basis?**
Accrual by default — same as the underlying P&L. For cash-basis trends (e.g. "actual cash collected per month"), pick the cash-flow data source.

**The trend went flat for three months and then jumped — what gives?**
Most common cause: missed monthly closes. Transactions were posted in bulk for those three months in a single batch, so the data is concentrated rather than spread out. Period close discipline fixes it going forward.

## Related

- [Profit & Loss](./profit-loss.md) — the source of most P&L trend data.
- [Balance sheet](./balance-sheet.md) — the source of balance-sheet trends.
- [Executive KPIs](./exec-kpis.md) — pre-built sparkline trends for key metrics.
- [Budget vs. actual](./budget-vs-actual.md) — for trend with a budget overlay.
