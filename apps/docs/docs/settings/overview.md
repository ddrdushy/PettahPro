---
title: Settings overview
sidebar_position: 1
---

# Settings overview

Settings is where you tune PettahPro for your business — branding, document templates, tax codes, number series, notifications, approvals, and access control. Most tenants set this up once during onboarding and revisit it only when something changes (new branch, new role, new statutory rate).

This page is the map. Each subsection has its own page with the details.

## Branding

`/app/settings/branding`

Upload your **logo** (PNG, JPEG, or WebP, up to 2 MB). The logo appears on every PDF — invoice, bill, payslip, settlement letter, the lot — and on the customer portal.

You can also set:
- **Primary brand colour** (hex) — used for accent elements on the portal and selected templates.
- **Trading name override** — what appears on documents if it differs from your registered tenant name.

SVG isn't allowed for logos because it's a script-execution vector inside PDFs and HTML. PNG with transparency is the right format if you want your logo on dark backgrounds.

## Document templates

`/app/settings/document-templates`

Every PDF in PettahPro is rendered through the **template engine** — a section-based composition where each document type (invoice, bill, payslip, etc.) has a list of sections (header, billTo, lineItemsTable, signBlock, …) that compose into the final PDF.

You can:
- Browse the **library** of pre-built templates (Classic invoice, Classic bill, Classic payslip, etc.).
- **Clone** a library template into your tenant.
- **Edit** the section list — reorder, hide, or tweak the parameters of each section.
- **Set as active** — the active template for a doc type is what gets rendered when a document of that type prints or emails.

If you've never customised, the **Classic** templates are active by default — you don't need to do anything.

## Tax codes

`/app/settings/tax-codes`

The Sri Lankan tax stack — VAT 18%, SSCL 2.5%, WHT 5/10% — is wired in as defaults and updated centrally when statutory rates change. You generally don't configure these per tenant.

What you **do** configure here:
- **Custom tax codes** for industry-specific cases (e.g. a hospitality service charge that you handle as a tax-style line).
- **Effective dates** if a rate changes mid-year — the new code can take effect on a specific date so historical documents stay correct.
- **Exemption codes** for customers in tax-free zones.

## Number series

`/app/settings/number-series`

Each document type (invoice, bill, payment, payslip, etc.) gets its number from a **series** — a prefix + counter, e.g. `INV-2026-0001`. By default each doc type has one series; you can add more if you need:

- **Per-branch series** — each branch's invoices number separately.
- **Per-fiscal-year reset** — counter restarts at 0001 each FY.
- **Multiple draft/posted series** — drafts use one, posted use another.

The active series is what allocates the next number on post. Once a number is used it's used — gaps from voided drafts are not reused.

## Notifications

`/app/settings/notifications`

Two surfaces:

- **Outbound email** — SMTP configuration, default subject/body for each email type (invoice email, payslip email, statement email), and an outbound log so you can see what was sent and whether the SMTP server accepted it.
- **In-app alerts** — the bell icon in the header. Configure which events ping which roles (e.g. "low stock" pings `inventory.manager`, "approval pending" pings the approver).

If you've signed up but no emails are going out, this is where you check.

## Approvals

`/app/settings/approvals`

Optional workflow gates on documents. Out of the box, anyone with post permission can post anything they have access to. Turn on approvals to require a separate approver above a threshold:

- **Invoice approval** — invoices over X must be approved by a user with `sales.approve` before they post.
- **Bill approval** — same on the buy side.
- **Payment approval** — same for outbound payments.
- **Journal approval** — manual journals over X.

Approvals are matrix-style: you set the threshold and which roles can approve at each step.

## Roles

`/app/settings/roles`

PettahPro ships with these built-in roles:

- **Owner** — everything, including billing and tenant deletion. The first signup user is the Owner.
- **Admin** — everything except billing.
- **Accountant** — full GL, AR/AP, reports. No HR/payroll, no settings.
- **Sales** — quote, invoice, payment, customer. Read-only on accounting.
- **Purchase** — bill, PO, GRN, supplier payment.
- **Inventory** — items, stock counts, transfers. Read-only on documents.
- **HR** — full payroll and HR. No accounting outside payroll's posting.
- **Read-only** — view everything, change nothing.

You can also define **custom roles** by combining specific permissions. The permission catalogue is grouped by module: `sales.*`, `purchase.*`, `inventory.*`, `accounting.*`, `payroll.*`, `settings.*`, `platform.*`. Hover over each permission for what it gates.

## Security

`/app/settings/security`

- **Password policy** — minimum length, complexity, rotation period.
- **Sessions** — see all active sessions, revoke individually.
- **Two-factor auth** — optional, configurable per role (e.g. require for Owner and Admin).
- **API keys** — for the Buy/Sell API and webhook endpoints.
- **Audit log** — searchable log of every privileged action (post, approve, login, settings change, impersonation). Export as CSV for compliance reviews.

## Demo data

`/app/settings/demo-data`

A one-click button that loads a realistic month of seed data — 5 customers, 4 suppliers, 8 items, 6 invoices, 4 bills, 3 payments, plus matching journals — so you can poke around the reports and dashboards without entering data first. The same screen has a **Clear demo data** button that walks the deletions newest-first and skips anything the demo data doesn't own (your real records stay put).

Demo data is gated on `settings.manage` permission so only Owners/Admins can load or clear it.

## Related concepts

- [Multi-tenant and RLS](../concepts/multi-tenant-and-rls) — why settings and data never cross tenants.
- [Glossary](../concepts/glossary) — definitions for the terms used on every settings page.
