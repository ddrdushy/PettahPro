---
title: Add-ons
sidebar_position: 5
---

# Add-ons

## What it does

Add-ons are features that tenants can buy on top of their plan. Where a **plan** is the all-in-one bundle, an **add-on** is a specific capability — multi-warehouse support, advanced approvals, a higher branch cap, an integration to a specific bank — that not every tenant needs but some are willing to pay extra for.

Add-ons keep plans simpler (you don't need a "Growth + multi-warehouse" plan as well as "Growth + multi-warehouse + advanced approvals"). Tenants pay only for what they actually use.

## How to use it

Open **Platform → Add-ons**. The list shows every add-on with:

- **Add-on code** — short identifier (`MULTI_WAREHOUSE`, `ADVANCED_APPROVALS`, etc.).
- **Display name** — what tenants see.
- **Monthly price** — flat per-month, or per-unit (e.g. per-branch).
- **Available on plans** — which plans can purchase this add-on.
- **Tenant count** — how many tenants are currently subscribed.
- **Status** — Active / Hidden / Legacy.

### Add-on detail

Click into an add-on to see / edit:

- **What it unlocks** — the specific capability or limit raised.
- **Pricing model** — flat per month, per unit (e.g. per warehouse beyond plan's included), or one-time.
- **Plans it's available on** — usually only the higher plans.
- **Default for plan** — whether this add-on is automatically included on certain plans.

## Common tasks

### Add a new add-on

Click **+ New add-on**. Fill in the code, what it unlocks, the pricing model, the available plans. New add-ons default to **Hidden** so the team can review before customers can buy.

### Enable an add-on for a specific tenant

Open the tenant → **Subscription → Add-ons → + Add**. Pick the add-on, confirm. Charged at next billing cycle (or pro-rated if mid-cycle, depending on the pricing model).

### Disable an add-on for a tenant

Open the tenant → **Subscription → Add-ons** → toggle off. The add-on stops at the next billing cycle (so the tenant gets the rest of the period they paid for). At end of cycle, the feature locks; tenant gets an in-app notification a few days before.

### Bundle an add-on with a plan

On the plan, set the add-on as a **Default add-on**. Now every tenant joining that plan gets the add-on enabled automatically (charged or free, depending on plan economics).

### Discount an add-on

Coupons can target add-ons specifically — a "20% off Multi-warehouse for 3 months" coupon, for example. See [Coupons](./coupons.md).

### See who's using a specific add-on

Filter the **Tenants** list by **Add-on = X**. Useful for impact analysis when you're considering changing the add-on's behaviour or price.

### Retire an add-on

Set status to **Legacy**. Existing subscriptions continue; no new tenant can subscribe. After enough time, migrate or remove subscriptions and set to Hidden.

## Examples

### Multi-warehouse

Default plan includes 1 warehouse. Multi-warehouse add-on lifts it to unlimited (or to N, depending on tier). Pricing usually flat per month.

### Advanced approvals

Default plan has simple "single approver above threshold X". Advanced approvals add-on enables the multi-step matrix approvals (different approvers for different document types and thresholds). Flat per-month.

### Bank integrations

Each integration to a specific bank (auto-import bank statements, push payments) is its own add-on. Per-bank, per-month — so a tenant using two banks pays for two integrations.

### Higher user cap

For tenants whose plan caps users at, say, 5, the "Extra users" add-on is per-user-per-month above the included cap.

## FAQ

**A tenant wants an add-on but they're on a plan that doesn't allow it.**
Either upgrade their plan (preferable), or temporarily make the add-on available on their plan (slippery — affects every tenant on that plan, not just this one). Don't bend rules for individual customers.

**Can add-ons depend on each other?**
Yes — an add-on can require another add-on or a specific plan. Configured per add-on. The tenant's subscription UI prevents adding things in invalid combinations.

**Can an add-on's price be different per tenant?**
Officially no — pricing should be plan-and-add-on driven, not negotiated. For real one-off cases, use a coupon to discount rather than a custom price.

**A tenant asked for a feature that's effectively a new add-on. How do I prioritise?**
Add-ons should be features that **multiple tenants** would pay for. If only one tenant wants it, it's probably either: (a) something to build into a plan (free), (b) a custom development charge (one-off), or (c) not worth doing at all. Add-ons are a productisation pattern, not a custom-feature pattern.

**Are add-ons visible on the public pricing page?**
Active add-ons can be listed on the marketing pricing page (configurable). Hidden add-ons (custom enterprise) aren't.

## Related

- [Plans](./plans.md) — the base subscription tier.
- [Tenants](./tenants.md) — assigning add-ons per tenant.
- [Coupons](./coupons.md) — discounting add-ons.
- [Revenue](./revenue.md) — add-on revenue is broken out separately.
