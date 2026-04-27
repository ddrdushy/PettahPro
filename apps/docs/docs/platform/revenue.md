---
title: Revenue
sidebar_position: 7
---

# Revenue

## What it does

The Revenue dashboard is the financial state of the platform — MRR, ARR, growth rate, churn, average revenue per tenant, and the breakdown across plans and add-ons. It's the report the founder, the board, and the investors all want.

Unlike tenant-side reports (which describe one tenant's books), this is a roll-up across **every** tenant on the platform. It shows you whether the SaaS itself is healthy.

## How to read it

Open **Platform → Revenue**.

The top of the screen shows the headline numbers:

- **MRR** (monthly recurring revenue) — the sum of every tenant's monthly subscription, normalised to monthly. Annual-paying tenants contribute 1/12 of their annual subscription.
- **ARR** (annual recurring revenue) — MRR × 12.
- **MRR growth this month** — net change vs. last month.
- **Active tenants** — tenants on a paid plan. Trial tenants are tracked separately.
- **Average revenue per tenant** — MRR / active tenants.

The middle has trend charts:

- **MRR over time** (last 24 months) — with new MRR / expansion / contraction / churn breakdown stacked.
- **Active tenants over time**.
- **Trial-to-paid conversion rate** — by signup cohort.

The bottom has breakdowns:

- **Revenue by plan** — pie + table.
- **Revenue by add-on** — table.
- **Top 10 tenants by revenue** — concentration risk.
- **Coupons applied this month** — what discounts are eating into gross revenue.

## Common tasks

### Run the monthly board update

The headline numbers + the MRR over time chart + the breakdowns by plan = the standard monthly board update slide. Export to PDF for the board pack.

### Track investor metrics

ARR, growth rate, gross margin, net revenue retention are the metrics every SaaS investor asks for. The Revenue dashboard shows ARR and growth directly; the other two require some analysis off the dashboard's data.

### Identify revenue concentration risk

The Top 10 tenants table tells you what % of revenue comes from your top 10 customers. If the top 10 is >30% of MRR, you have concentration risk — losing one of them hurts. This is also where you check that no single customer is more than ~10% of revenue.

### Investigate an MRR drop

Look at the MRR-over-time chart filtered to last month — the breakdown into new MRR, expansion, contraction, churn shows whether the drop was from less new business or more existing business leaving. Each segment can be drilled into to see the specific tenants involved.

### Check trial conversion by cohort

Trial-to-paid conversion by cohort is the leading indicator of pipeline health. A drop in conversion in a recent cohort might signal a problem with onboarding, with the latest pricing, with marketing-qualified-lead quality. Drill into a low-conversion cohort to see who didn't convert and why (in their tenant notes).

### Compare gross vs. net revenue

The dashboard can show gross revenue (before coupons) and net revenue (after coupons). The gap is what discounting is costing you — useful for assessing whether promotions are profitable.

## What it draws from

| Metric | Source |
|---|---|
| MRR / ARR | Tenant subscriptions, normalised to monthly |
| New MRR | Tenants whose first paid period was in the month |
| Expansion MRR | Plan upgrades + add-on additions during the month |
| Contraction MRR | Plan downgrades + add-on removals during the month |
| Churn MRR | Tenants who cancelled during the month |
| Conversion rate | Trial sign-ups → paid conversions per cohort |
| Coupons applied | Coupon redemptions in the period |

The math is reasonably standard SaaS metrics math; the dashboard does it for you.

## FAQ

**Why doesn't this match my accounting books?**
MRR and ARR are SaaS metrics, not GAAP accounting. They smooth out the timing of when cash actually comes in — an annual-paying customer contributes 1/12 of their annual fee to MRR each month, even though they paid once. Your accounting books recognise revenue per the GAAP rules, which may differ from MRR. Both views are useful for different purposes.

**The board wants gross margin. Does the Revenue dashboard show that?**
Not directly — gross margin needs to be computed against your hosting / infra costs, which aren't on this dashboard. Pull MRR from here, infra costs from your accounting books, and combine off-line. This is a deliberate scope decision: this dashboard is about top-line revenue and growth, not cost.

**A tenant's recent payment doesn't appear in MRR.**
Most likely it's a one-time payment (e.g. setup fee, custom-development charge) rather than recurring. MRR only includes recurring subscription revenue. One-time charges roll up under **Other revenue** which is shown separately.

**Can I see revenue per geography?**
If your tenants are tagged with country (most are, from signup), yes — the revenue breakdown can be sliced by country. Useful when expanding internationally.

**Why is "active tenants" different from the count in the Tenants directory?**
The Tenants directory lists everyone — including trials, suspended, and cancelled. The Revenue dashboard's "Active tenants" is just the tenants generating MRR. The numbers differ because most platforms have a tail of trial / inactive tenants that don't contribute to revenue.

**The dashboard is taking a long time to load.**
Larger platforms run into this. Most metrics are pre-computed nightly; for real-time, the system uses incremental updates. If the dashboard's slower than 5 seconds to load, contact support — it's worth tuning.

## Related

- [Plans](./plans.md) — the source of recurring revenue.
- [Add-ons](./addons.md) — the source of expansion revenue.
- [Coupons](./coupons.md) — what's discounting gross revenue.
- [Tenants](./tenants.md) — drill into specific tenants from any breakdown.
- [Tenant health](./tenant-health.md) — operational signals that often lead revenue.
