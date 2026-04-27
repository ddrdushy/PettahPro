---
title: Executive KPIs
sidebar_position: 8
---

# Executive KPIs

## What it does

The Executive KPIs report is the one-screen dashboard for whoever runs the business — owner, MD, finance lead. It pulls the most important numbers from across the whole system into a single view: revenue, profit, cash, AR, AP, headcount, key margins. Designed to be glanced at every morning, not poured over for an hour.

It's a curated subset of what you could find by piecing together the trial balance, P&L, cash flow, and aging — but laid out as the KPIs most owner-operators actually care about.

## How to read it

Open **Reports → Executive KPIs**.

The top of the screen shows **today's snapshot**:

- **Cash position** — bank + cash balances summed.
- **AR outstanding** — what customers owe (with overdue split as red bar).
- **AP outstanding** — what you owe suppliers (with overdue split).
- **Net working capital** — current assets minus current liabilities.

The middle shows **this month vs. previous month**:

- **Revenue** — month-to-date sales.
- **Gross profit** — and gross margin %.
- **Operating expenses**.
- **Net profit** — and net margin %.
- **Cash generated**.

The bottom shows **trends** — sparkline charts of the last 12 months for:

- Revenue.
- Gross margin %.
- Net profit.
- Cash position.
- AR days outstanding.

Each tile is clickable — click cash position to see the underlying bank accounts, click revenue to drill into the P&L, click AR to land on the AR aging.

## Common tasks

### Check the business in 30 seconds

Open the dashboard, glance at the four "today" tiles. If anything is red (overdue AR way up, cash way down), drill into it. Otherwise carry on with your day.

### Spot a trend before it becomes a problem

Look at the sparklines. Revenue trending down for three consecutive months, or gross margin compressing, or AR days creeping up — all signals that something is changing. The dashboard shows the change before the monthly review meeting catches it.

### Set custom KPIs

If you care about something not on the default dashboard (e.g. specific product line revenue, employee productivity, average invoice size), open **Settings → KPI dashboard** and add a custom tile. Pick the data source, the calculation, and the sparkline period.

### Customise per role

Different people care about different KPIs. The dashboard supports per-role layouts — Owner sees everything, Finance lead sees the financial KPIs, Sales lead sees the revenue and AR KPIs only. Configure in **Settings → Roles → Dashboard layout**.

### Export the snapshot

The "Export this view" button produces a one-page PDF — useful for management meetings or sharing with investors. The PDF shows what the screen showed at the moment of export.

### See the dashboard at a past date

For investor or board reviews, you sometimes want "what did the dashboard show at end of last quarter?" Pick **As at** and a past date — the dashboard recalculates.

## What it draws from

The dashboard is a curated view across many sources:

| Tile | Source |
|---|---|
| Cash position | Bank + cash account balances |
| AR / AP outstanding | Aging reports |
| Revenue | P&L (period-to-date sales) |
| Gross profit / margin | P&L (revenue − COGS) |
| Net profit | P&L (bottom line) |
| Cash generated | Cash flow report |
| AR days outstanding | (AR balance / annualised revenue) × 365 |

Calculations are real-time — no overnight refresh, no caching beyond a few seconds.

## FAQ

**My dashboard shows revenue going up but profit going down — what's happening?**
Probably gross margin compression — your revenue is growing but your costs are growing faster. Drill into the P&L and check COGS as % of revenue, plus expense lines. Common culprits: input cost inflation, discounting, or fixed-cost growth (more staff, larger premises) outpacing revenue.

**Cash position is dropping even though we're profitable.**
Look at AR days outstanding. If that's growing, customers are paying slower and your cash is stuck in receivables. Look at inventory too — money tied up in stock you haven't sold. Profit is on accrual basis; cash is real.

**The KPIs use accrual numbers but I think in cash. Can I switch?**
Most KPIs (revenue, profit) are accrual-basis because that's the standard accounting view. Cash position and cash generated are cash-basis. If you want a fully cash-basis dashboard, configure custom tiles in **Settings → KPI dashboard** — you can build cash-basis KPIs using the cash flow data.

**Can I share the dashboard with my accountant who doesn't have a login?**
Use the export to PDF. There's no read-only public-link option for the dashboard — sensitive operational data shouldn't sit at a guessable URL.

**The dashboard is slow to load.**
First load fetches a lot of data (12 months of trends across multiple sources). Subsequent loads are cached briefly. If it's persistently slow, the most likely cause is a very long history with many transactions; talk to support about a data archive for very old years.

## Related

- [Profit & Loss](./profit-loss.md) — the income side of the dashboard.
- [Balance sheet](./balance-sheet.md) — the position side.
- [Cash flow](./cash-flow.md) — the cash story.
- [Aging](./aging.md) — AR / AP detail.
- [Trends](./trends.md) — period-over-period comparisons.
