---
title: Tenant health
sidebar_position: 8
---

# Tenant health

## What it does

The Tenant health dashboard surfaces operational signals about how each tenant is using PettahPro — and flags the ones that look unhealthy. A tenant who hasn't logged in for 30 days, or whose transactions have dropped off, or who's hitting errors repeatedly, is probably about to churn. Catching that early lets the support or success team reach out before it's too late.

This is the report the Customer Success team runs first thing every morning.

## How to read it

Open **Platform → Tenant health**. The list shows every active tenant scored on a 1–5 health scale, sorted worst-first by default. Each row has:

- **Tenant**.
- **Plan**.
- **Health score** — 1 (worst) to 5 (best), with a colour band.
- **Signal flags** — which specific signals are firing (low logins, no transactions, high error rate, etc.).
- **Last activity** — most recent meaningful action.
- **Days as customer** — how long they've been on a paid plan.
- **MRR** — what they pay.

You can filter by:
- **Score range** — show me only the at-risk (1–2).
- **Plan**.
- **Tenure** — new tenants vs. long-standing.
- **Signal flag** — show me only tenants with a specific signal firing.

### Health score factors

The score combines:

- **Login frequency** — how often the owner / admins log in.
- **Transaction volume** — invoices, bills, payments per week. Flat or declining is bad.
- **Feature adoption** — are they using more than just one module? Tenants using only invoices are easier to lose than tenants using invoices + bills + payroll.
- **Support tickets** — many open tickets is a flag, but so is zero engagement (you don't know what's wrong).
- **Errors** — uncaught errors hitting their account, or repeated failed actions.
- **Billing health** — late payments, failed cards.

Each factor weighted; result rolled into the 1–5 score. The factors and weights are tunable in **Platform → Settings → Health scoring**.

## Common tasks

### Run the daily customer success review

Filter to **Score 1–2**, sort by MRR descending. Top of the list is who CS should call today — the most at-risk, highest-revenue tenants. For each, check the signal flags to know what to discuss.

### Identify trial users about to expire who haven't engaged

Filter to **Plan = Trial** and **Score 1–2**. These are trials that probably won't convert without intervention. Reach out, offer a demo, ask if there's a blocker.

### Catch tenants whose usage is silently dropping

Filter to **Long-standing (>1 year)** and **Score 1–2**. These are loyal tenants who might be quietly leaving. Often the most valuable saves — they've been paying a long time and switching costs are real, so a small intervention can prevent a churn.

### Investigate a specific tenant's score

Click into the tenant. The detail page shows each signal's individual score, the trend over the last 90 days for each, and a list of recent activity. Useful for understanding **why** their score is what it is.

### See platform-wide health trends

The top of the dashboard shows the distribution of tenants across the 5 health bands, plus the trend over time. A growing tail of 1–2 scores is a leading indicator of churn.

### Set up alerts

You can configure email alerts when:
- A specific tenant's score drops below a threshold.
- Any tenant on a high-MRR plan drops to score 2.
- More than X% of tenants drop a band in a given month.

Alerts route to the Customer Success team or to a Slack channel.

## Common signal flags

| Signal | What it means | What to do |
|---|---|---|
| **No login 30+ days** | Owner / admin haven't logged in for a month | Email check-in: "everything OK?" |
| **Transactions dropped 50%+** | Usage is collapsing | Call to understand why |
| **Single module use** | Only using invoices, no other modules | Onboarding nudge to discover what they're missing |
| **High error rate** | Frequent failed actions | Engineering investigation, not just CS |
| **Failed payment** | Most recent billing attempt failed | Billing follow-up; if not resolved → suspension at next cycle |
| **Open critical ticket** | They have an unresolved P0 / P1 ticket | Already on the list — escalate if not progressing |
| **Plan limit hit repeatedly** | Hitting cap on users / transactions | Upsell opportunity, or quick add-on enable |

## What it draws from

| Source | What it contributes |
|---|---|
| Audit log | Login frequency, action counts |
| Tenant transactions | Volume by module, week over week |
| Support tickets | Open count, severity |
| Error log | Failed actions per tenant |
| Billing records | Payment status, failed payment count |

All signals are computed nightly with a 24-hour rolling window — the dashboard isn't real-time but is fresh-enough for daily CS rhythm.

## FAQ

**A tenant has a low score but their owner says everything is fine.**
Trust them, but probe. The owner might not know that one of their team is hitting errors, or that no one has logged in for two weeks. Ask "have you noticed your team using PettahPro less?" — sometimes it surfaces things the owner didn't know.

**Should I always reach out to score 1–2 tenants?**
For high-MRR tenants, yes. For lower-MRR tenants, weigh the cost of CS time vs. the value of a save. Many platforms find that proactive outreach pays back at all MRR levels — but if your CS team is small, focus on the top of the revenue table.

**Can the score be wrong?**
Yes — the score is a heuristic, not a verdict. A tenant who uses PettahPro intensively for one week per month around invoicing might score 1–2 but be perfectly healthy. The signal flags help you interpret — "no logins for 30 days but very high transactions in their last week" is a pattern, not a problem.

**A tenant who scored 1 yesterday is now 5 — what gives?**
Their score reacts to recent activity. If they had a long quiet period and then a burst of activity (lots of logins, lots of transactions), they bounce up. The trend over time is more meaningful than a single day's score.

**Can I customise the scoring weights?**
Yes — **Platform → Settings → Health scoring**. Be careful: changing weights changes the historical trend interpretation. Most platforms find the defaults work and don't need much tweaking.

**The dashboard says someone is healthy but they just churned.**
Sometimes it happens. Health is a leading indicator, not a guarantee. After-the-fact, drill into their last 90 days to see what was missed. Often there was a signal that should have fired earlier — that's a chance to tune the scoring.

## Related

- [Tenants](./tenants.md) — drill into a specific tenant's details.
- [Revenue](./revenue.md) — top-line health (where tenant health translates).
- [Impersonation](./impersonation.md) — investigating a tenant's actual usage.
