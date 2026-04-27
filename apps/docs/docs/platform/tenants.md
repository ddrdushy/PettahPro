---
title: Tenants
sidebar_position: 2
---

# Tenants

## What it does

The Tenants directory is the master list of every business using PettahPro. It's the entry point for almost everything in Platform admin — when you need to do something for a specific tenant (look up their plan, support a ticket, check why they haven't logged in for a week), you start by finding them in the directory.

## How to use it

Open **Platform → Tenants**. The list shows every tenant with:

- **Tenant name** — the business name.
- **Owner email** — the primary owner's email.
- **Plan** — current subscription plan.
- **Status** — Active / Trial / Past due / Cancelled / Suspended.
- **Signed up** — date they joined.
- **Last activity** — when an owner or admin last logged in.
- **Country** — for support routing.

The filter bar lets you narrow by plan, status, signup date range, or free-text search across name and email.

Click any row to open the tenant's detail page.

## The tenant detail page

For one tenant, you see:

### Profile

- Business name, owner email, country, sign-up date.
- TIN, BR number, business type (if filled).
- Editable: name, owner email, country, support tier.

### Subscription

- Current plan and add-ons.
- Trial expiry (if on trial).
- Next billing date.
- Payment method on file.

### Activity

- Last 30 days of meaningful activity — logins, key transactions, integrations connected.
- Counts: users, invoices this month, customers, items.

### Operations

- Buttons to: change plan, apply coupon, suspend tenant, restore from suspension, delete tenant (with confirmation).
- Impersonate button (audit-logged).
- View audit log for this tenant.

### Notes

- Free-text notes operators can leave for each other ("called about VAT return on 5 April, will follow up").

## Common tasks

### Onboard a new enterprise customer manually

A salesperson closed a deal that needs custom setup — bigger plan, specific add-ons. Use **+ New tenant** to create the account, set the plan, send the welcome email, then hand off to the customer for them to invite their team.

### Find a tenant by partial name

The search box matches on tenant name and owner email. Substrings work — "samp" matches "Sampath Enterprises".

### Suspend a tenant for non-payment

Open the tenant → **Suspend**. PettahPro disables logins for all their users (with a message explaining why and how to resolve), keeps their data intact, and stops billing them. Restore via the same screen when payment is sorted.

Suspension is reversible and data-safe. **Delete tenant** is the irreversible nuclear option — only use it for proven duplicate accounts or fraud cases.

### Promote a trial to paid

When a trial converts, **Change plan → \[paid plan\]**. The tenant's trial flag is removed; their next billing date is set; they get an email. From their side, nothing visible changes — they just stop seeing the trial banner.

### See every tenant on a specific plan

Filter the list by **Plan = X**. Useful for impact analysis when you're considering plan changes ("how many tenants is this affecting?").

### Bulk export

Export the full list to CSV for analysis in a spreadsheet. Includes all columns plus subscription details. Useful for ad-hoc reports the dashboard doesn't cover.

### Change owner email

Sometimes a customer wants to transfer ownership. Open the tenant → **Edit → Owner email**. The change takes effect immediately; the new owner's email gets a "you've been made owner" notification.

## What you can't do here

- Read the tenant's business data — invoices, customers, etc. The only way to see that is via [impersonation](./impersonation.md).
- Edit the tenant's business data.
- Run cross-tenant queries on business data.

These limits are enforced at the platform-database-role level — even Platform owner can't bypass them.

## FAQ

**A tenant says they can't log in. How do I check?**
Open the tenant → Activity. If "last login" is recent, the issue is account-specific (password reset, role change). If logins are failing across the board, check the **Status** — they may have been suspended (auto-suspended for non-payment, etc.).

**The tenant wants their data exported / deleted.**
For export: use the tenant-side **Settings → Data export** (the customer initiates it). For deletion: GDPR/regulatory deletion goes through a separate compliance flow — never just hit "Delete tenant" without going through that flow first.

**A tenant has been on trial for ages — should I extend?**
There's a default trial length but you can extend per tenant via **Subscription → Extend trial**. Document the reason in Notes; it shows up in audit logs.

**Can I see how many tenants signed up last month?**
Filter by **Signed up** date range. The result count at the top of the table is the answer. For trends over time, the [Revenue](./revenue.md) dashboard has a signups-by-month chart.

**The tenant directory is slow.**
Most likely you're loading the full list when you only need a slice. Use filters — by plan, by status — to narrow before scrolling.

## Related

- [Impersonation](./impersonation.md) — the way to see a tenant's actual screens.
- [Plans](./plans.md) — assigning plans to tenants.
- [Coupons](./coupons.md) — applying discount codes.
- [Tenant health](./tenant-health.md) — operational signals across tenants.
