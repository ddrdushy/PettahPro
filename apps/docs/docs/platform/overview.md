---
title: Platform admin overview
sidebar_position: 1
---

# Platform admin overview

## What it does

Platform admin is the operator-side console for PettahPro — what the team running PettahPro uses to manage the businesses (called **tenants**) using it. If you're an end customer running your business on PettahPro, you don't see Platform admin. It's a separate area, accessed through `/platform/*`, with its own login and its own permissions, visible only to PettahPro operators.

This area covers the tenant lifecycle (signup, billing, support, retention) plus the operational tooling needed to run a multi-tenant SaaS — pricing plans, feature add-ons, coupons, revenue reporting, tenant health monitoring, and the impersonation flow used to support customers.

This page is the map. Each subsection has its own page with the details.

## Who sees Platform admin

Only PettahPro operators — the team running the platform. Three built-in operator roles:

- **Platform owner** — everything, including operator account management.
- **Platform admin** — everything operational, no operator account management.
- **Support** — read-most, write-only on the support workflows (impersonation, plan changes, support tickets). No revenue or operator management.

Operator accounts are entirely separate from tenant accounts. An operator account has no business books — they only access the platform console, never the tenant areas (except briefly via impersonation, audit-logged).

## What's covered here

| Page | What it does |
|---|---|
| [Tenants](./tenants.md) | The directory of every business on PettahPro — search, filter, drill into any tenant's status. |
| [Impersonation](./impersonation.md) | Logging in as a tenant user to support them. Always audit-logged, with a reason required. |
| [Plans](./plans.md) | The pricing tiers tenants subscribe to. |
| [Add-ons](./addons.md) | Feature toggles enabled per tenant on top of their plan. |
| [Coupons](./coupons.md) | Discount codes for plans and add-ons. |
| [Revenue](./revenue.md) | The MRR / ARR / churn dashboards. |
| [Tenant health](./tenant-health.md) | Operational signals — login activity, transaction volume, error rates, support tickets. |

## How operator actions are tracked

Everything an operator does in Platform admin is recorded:

- **Audit log** — who did what, when, against which tenant, with what reason.
- **Impersonation log** — every login-as-tenant session, with start time, end time, and what was done while impersonating.
- **Plan change log** — every plan, add-on, or coupon change, with the operator who made it.

This is non-negotiable. The audit trail is what a tenant sees if they ask "who made this change?" and what a regulator sees if they ask about access controls. Every operator role has read access to the audit logs for everything they can do.

## What you don't do here

A few things deliberately aren't in Platform admin:

- **Read tenant business data**. Operators cannot read invoices, customers, or any tenant business records from the platform console. The only way to see those is via impersonation, which is logged. (This is a hard rule — even Platform owner can't bypass it.)
- **Edit tenant data**. Same. Operators can't post journals into a tenant or change their numbers. Support requests that need data changes go through tenant-side users.
- **Cross-tenant queries**. Reports in Platform admin show plan, billing, and operational metrics — never aggregated business numbers across tenants.

The reason: PettahPro operators need to support tenants without seeing their books. That's what the customers expect when they trust us with their data.

## Related

- [Glossary](../concepts/glossary.md) — definitions for the terms used across the platform console.
- **Operator roles** — configured in the platform realm's own settings.
