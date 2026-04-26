---
title: Settings overview
sidebar_position: 1
---

# Settings overview

Settings is where you tune PettahPro for your business — your logo, document layouts, tax codes, number series, notifications, approvals, and access control. Most businesses set this up once during onboarding and only come back here when something changes (a new branch, a new staff member, a new statutory rate).

This page is the map. Each subsection has its own page with the details.

## Branding

**Settings → Branding**

Upload your **logo** (PNG, JPEG, or WebP, up to 2 MB). It appears on every PDF — invoices, bills, payslips, settlement letters — and on the customer portal.

You can also set:
- **Primary brand colour** — used for accents on the portal and on selected document templates.
- **Trading name** — what shows on documents if it differs from your registered business name.

(SVG isn't supported for logos for security reasons. PNG with a transparent background is the right format if you want your logo to look good on different background colours.)

## Document templates

**Settings → Document templates**

Every PDF that PettahPro generates — invoices, bills, payslips, settlement letters, purchase orders, the lot — uses a template that you can customise.

You can:
- Browse the **library** of pre-built templates we ship with PettahPro.
- **Clone** any of them into your business.
- **Edit** the layout — reorder sections, hide things you don't need, tweak the wording.
- **Set a template as active** — the active template is the one used when a document of that type prints or emails.

If you've never customised anything, the default templates are active and you don't need to do anything.

## Tax codes

**Settings → Tax codes**

The Sri Lankan tax system — VAT 18%, SSCL 2.5%, WHT 5/10% — comes pre-configured. Statutory rates are updated centrally when the budget changes them, so you don't manage them yourself.

What you **do** manage here:
- **Custom tax codes** for industry-specific cases (e.g. a hospitality service charge that you handle as a tax-style line).
- **Effective dates** if a rate changes part-way through the year — the new code can take effect from a specific date so historical documents stay correct.
- **Exemption codes** for customers in tax-free zones or with specific exemptions.

## Number series

**Settings → Number series**

Each document type (invoice, bill, payment, payslip, etc.) gets its number from a **series** — a prefix plus a counter, e.g. `INV-2026-0001`. By default each document type has one series, but you can add more if you need:

- **Per-branch series** — each branch numbers its invoices separately.
- **Per-financial-year reset** — counter restarts at 0001 each new FY.
- **Separate draft and posted series** — drafts use one prefix, posted documents use another.

Once a number is used, it's used. Numbers from voided drafts are not reused, so there are no gaps in the audit trail.

## Notifications

**Settings → Notifications**

Two things live here:

- **Outbound email** — your SMTP settings, the default subject and body for each email type (invoice email, payslip email, statement email), and an outbound log so you can see what was sent and whether the recipient's mail server bounced it.
- **In-app alerts** — the bell icon in the top bar. Configure which events ping which roles (e.g. "low stock" pings the inventory manager, "approval pending" pings the approver).

If you've signed up but no emails are going out, this is the first place to check.

## Approvals

**Settings → Approvals**

Optional review steps you can put in front of certain documents. Out of the box, anyone with permission to post can post anything they have access to. Turn approvals on if you want a separate person to sign off above a threshold:

- **Invoice approval** — invoices over a chosen amount need approval before they post.
- **Bill approval** — same on the buying side.
- **Payment approval** — outbound payments above a threshold.
- **Manual journal approval** — for journal entries above a threshold.

Approvals are matrix-style: you set the threshold and which roles can approve at each level.

## Roles

**Settings → Roles**

PettahPro comes with these built-in roles:

- **Owner** — everything, including billing and account deletion. The first person to sign up is the Owner.
- **Admin** — everything except billing.
- **Accountant** — full accounting, AR, AP, and reports. No HR or payroll. No settings.
- **Sales** — quotations, invoices, customer payments, customer records. Read-only on accounting.
- **Purchase** — bills, purchase orders, GRNs, supplier payments.
- **Inventory** — items, stock counts, transfers. Read-only on documents.
- **HR** — full payroll and HR. No accounting outside what payroll posts.
- **Read-only** — view everything, change nothing.

You can also build **custom roles** by combining specific permissions. The full permission catalogue is grouped by module — hover any permission to see what it does.

## Security

**Settings → Security**

- **Password policy** — minimum length, complexity, how often passwords need to change.
- **Active sessions** — see who's logged in from where, and revoke a session.
- **Two-factor auth** — optional, can be required for specific roles (typically Owner and Admin).
- **API keys** — for connecting other systems to PettahPro.
- **Audit log** — every privileged action (post, approve, login, settings change) is logged here. Searchable, and exportable as CSV for compliance reviews.

## Demo data

**Settings → Demo data**

A one-click button that loads a realistic month of sample data — five customers, four suppliers, eight items, six invoices, four bills, three payments — so you can see what the dashboards and reports look like with real content. The same screen has a one-click button to clear it again.

Demo data only loads and clears its own records — anything you've created yourself stays put.

Loading and clearing demo data is restricted to Owners and Admins.

## Related

- [Glossary](../concepts/glossary.md) — definitions for the terms used on settings pages.
- **Roles & permissions** — the page above explains the built-in roles; the detail page goes through every permission.
