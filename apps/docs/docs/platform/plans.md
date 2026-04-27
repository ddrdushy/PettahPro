---
title: Plans
sidebar_position: 4
---

# Plans

## What it does

A plan is a pricing tier — what a tenant pays per month and what they get for it. Plans cap things like number of users, transactions per month, branches, and which modules they can use. PettahPro has a small set of standard plans, plus the ability to define custom plans for enterprise customers.

The Plans page in Platform admin is where you configure those plans, change prices, set limits, and assign which modules each plan unlocks.

## How to use it

Open **Platform → Plans**. The list shows every plan with:

- **Plan code** — a short identifier (`STARTER`, `GROWTH`, `BUSINESS`, etc.).
- **Display name** — what tenants see (e.g. "Starter", "Growth").
- **Monthly price** — in LKR (the default for SL-focused plans).
- **Annual price** — typically 10–20% discount vs. paying monthly.
- **Tenant count** — how many tenants are currently on this plan.
- **Status** — Active / Hidden / Legacy.

### Plan detail

Click into a plan to see / edit:

- **Caps** — users, transactions/month, customers, items, branches, warehouses.
- **Modules included** — which modules tenants on this plan can use (Sell, Buy, Inventory, Payroll, etc.).
- **Storage** — total file storage allocation.
- **Add-ons available** — which add-ons can be purchased on top of this plan.
- **Trial settings** — default trial length when this is the trial plan.

### Status meanings

- **Active** — visible on the public pricing page, available for new sign-ups.
- **Hidden** — not on the public pricing page, but tenants can be assigned it manually (custom enterprise plans).
- **Legacy** — closed to new sign-ups but existing tenants stay on it. Used when retiring a plan but grandfathering existing customers.

## Common tasks

### Change a plan's price

Open the plan → **Edit price**. The change applies to **new sign-ups immediately**, and to **existing tenants at their next billing cycle** (with email notice 30 days before, automatic). Existing tenants can't be hit with a surprise price change mid-cycle.

### Add a new plan

Click **+ New plan**. Fill in the code, name, prices, caps, and modules. Save. New plans default to **Hidden** so you can review before exposing.

### Retire a plan

Set status to **Legacy**. Existing tenants are unaffected; new sign-ups can't pick this plan anymore. After 6–12 months, when most legacy tenants have moved off (or been migrated), set to **Hidden** to remove from internal lists.

### Build an enterprise custom plan

Use **+ New plan** with status = **Hidden**. Set the prices and caps to whatever was negotiated. Then go to **Tenants → \[the enterprise tenant\] → Change plan** and assign the custom plan. Other tenants can never be assigned it because it's hidden from the picker (admins explicitly assigning it always works).

### Audit who's on which plan

Filter the **Tenants** list by plan to see exactly who's on it. The plan detail also shows the count and links through to the filter automatically.

### Compare two plans side by side

Open both plans in two browser tabs. The plan-detail layout is consistent across plans, so seeing them side by side makes the differences obvious.

## What you don't change here

- **Statutory tax rates** (VAT, EPF, ETF, PAYE) — these are wired in centrally; not a per-plan thing.
- **Per-tenant feature flags** — those go in [Add-ons](./addons.md), not Plans.
- **One-off discounts** — those are [Coupons](./coupons.md).

## FAQ

**A customer wants a plan that's between two of our standard plans.**
Don't make a plan-detail edit for one customer — that affects every other tenant on that plan. Either: (a) put them on the higher plan with a coupon to bridge the price difference; or (b) create a hidden custom plan and assign it.

**Can I change a plan's modules without affecting existing tenants?**
Module changes apply at the next billing cycle, and tenants are notified 30 days before. If you're removing a module, tenants who've been using it lose access at the cycle. Better practice: don't remove modules from active plans — create a new plan and migrate.

**A plan's tenant count went down — what happened?**
Check the **plan change log** at the bottom of the plan-detail page. It shows every tenant who joined or left the plan, with the date and the destination plan (if they switched). Common causes: cancellations, downgrades, upgrades to a higher plan.

**Can plans bundle add-ons?**
Yes. On the plan detail, **Default add-ons** are switched on automatically when a tenant joins this plan. Useful for "Plan X includes the Multi-warehouse add-on for free".

**Is the pricing page on the marketing site auto-generated from this?**
Yes — the public pricing page reads from the active plans. So changing a plan's price here changes the marketing site too. Make sure you're ready before switching status to Active.

## Related

- [Tenants](./tenants.md) — assigning plans to specific tenants.
- [Add-ons](./addons.md) — feature toggles on top of plans.
- [Coupons](./coupons.md) — discounts on plans.
- [Revenue](./revenue.md) — MRR/ARR rolled up across plans.
