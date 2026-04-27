---
title: Coupons
sidebar_position: 6
---

# Coupons

## What it does

Coupons are discount codes you can apply to a tenant's subscription — temporary or permanent, percentage or fixed-amount, on the whole bill or specific plans / add-ons. Used for sales promotions, retention deals, partner referrals, and one-off goodwill credits.

A coupon doesn't change a plan's price for everyone — it's applied to specific tenants who use the code (or whom you assign it to manually).

## How to use it

Open **Platform → Coupons**. The list shows every coupon with:

- **Code** — what the customer types (`LAUNCH50`, `LOYAL2026`).
- **Discount** — percent or fixed amount.
- **Applies to** — Plan / Add-on / Whole subscription.
- **Duration** — number of cycles the discount applies, or "forever".
- **Status** — Active / Expired / Disabled.
- **Redemption count** — how many tenants have used it.

### Coupon detail

Click into a coupon to see / edit:

- **Code, discount type, discount value**.
- **Scope** — what it applies to (entire subscription, specific plan, specific add-on).
- **Duration** — first month only, first 3 months, first year, forever.
- **Max redemptions** — global cap (e.g. "first 100 customers only").
- **Eligibility** — new tenants only / existing only / both.
- **Valid from / Valid until** — date range when the coupon can be redeemed.
- **Tenants who've redeemed** — full list with dates.

## Common tasks

### Run a launch promotion

Create a coupon `LAUNCH50` — 50% off, 3 months, all plans, max 100 redemptions, valid until end of June. Customers see the field on signup; they enter the code, it's validated, the discount is applied for the first 3 cycles. After 100 redemptions or end of June, whichever comes first, the coupon stops working.

### Apply a goodwill credit to a frustrated customer

Open the tenant → **Subscription → Apply coupon**. Pick or create a one-off coupon. Common pattern: 100% off for 1 month as a goodwill gesture after a major bug or outage.

### Partner referral

Create a coupon for the partner — `PARTNER_X20` — 20% off forever. Partner shares with their referrals; referrals enter at signup; both partner and customer get a record. (For partner commissions, you'd typically also have an automatic credit applied to the partner's billing — separate setup.)

### Time-limited retention

A tenant is about to cancel. Offer "30% off for 6 months". Create the coupon (or use a generic retention coupon), assign manually. Customer agrees to stay; the discount applies; they're a happier customer for 6 months.

### See whether a campaign is performing

Open the coupon detail. Redemption count over the campaign's duration tells you the conversion. Compare to your target. Useful for marketing post-mortems.

### Disable a coupon mid-campaign

Set status to **Disabled**. Existing redemptions continue (the discount keeps applying for their duration); new redemptions are blocked. Use when a code has leaked publicly or when the promotion needs to end early.

### Bulk export coupons + redemptions

Useful for marketing reporting. Click **Export** on the list page; the CSV includes one row per redemption with date, tenant, coupon code, discount applied.

## FAQ

**Two coupons at once on the same tenant — does that work?**
Most coupons are exclusive (one at a time). Multi-coupon stacking is configurable on the coupon, but mostly avoided because it complicates billing reconciliation. Default: one at a time, the more recent overriding.

**A tenant says their coupon stopped applying.**
Check the duration. A "first 3 months" coupon stops on month 4 — that's working as intended. If they want it longer, you'd issue a new coupon. (Or, if it's a goodwill case, a one-off credit might be cleaner — see Revenue page for adjustments.)

**Can coupons stack with annual-vs-monthly discounts?**
Yes — the annual discount is plan-pricing, the coupon is on top. So a 20%-off-annual plan with a 10%-off coupon ends up at the same effective discount as if the coupon was applied to the monthly equivalent.

**Can I create a coupon for one specific tenant only?**
Yes — set **Eligibility = Specific tenants** and pick the tenant. The code can't be redeemed by anyone else. Useful for negotiated deals.

**Can a coupon discount the platform fee but not the tenant's transaction-volume add-on?**
Yes — set the **Scope** to specific plans/add-ons. The discount only applies to the matching line items on the invoice.

**An expired coupon is still showing on a tenant's bill.**
Most likely the tenant redeemed before expiry, and they're still within the duration. The redemption keeps applying for its duration even if the coupon's redemption window has closed for new redemptions.

## Related

- [Plans](./plans.md).
- [Add-ons](./addons.md).
- [Tenants](./tenants.md) — applying coupons to specific tenants.
- [Revenue](./revenue.md) — net revenue after coupons applied.
