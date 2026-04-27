---
title: Roles
sidebar_position: 7
---

# Roles

## What it does

A role is a bundle of permissions — what a user can see and do in PettahPro. Every user account is assigned at least one role. Their role(s) determine which screens they can access, which actions they can take, and what data they can read.

PettahPro ships with built-in roles covering common patterns. For most businesses these are enough; for businesses with more nuanced access control needs, you can define custom roles by combining specific permissions.

## Built-in roles

| Role | What they can do |
|---|---|
| **Owner** | Everything, including billing, plan changes, account deletion. The first signup user is the Owner. |
| **Admin** | Everything except billing and account-level changes. |
| **Accountant** | Full GL, AR, AP, reports. No HR or payroll. No settings other than reading. |
| **Sales** | Quotations, invoices, customer payments, customer records. Read-only on accounting and inventory. |
| **Purchase** | Bills, purchase orders, GRNs, supplier payments, supplier records. Read-only on accounting. |
| **Inventory** | Items, stock counts, transfers, bundles. Read-only on documents. |
| **HR** | Full payroll and HR. No accounting outside what payroll posts. |
| **Cashier (POS)** | POS sales only. Read-only on customers, items. |
| **Read-only** | View everything, change nothing. Useful for auditors / consultants. |

For most SMEs, picking from this set is sufficient.

## Walkthrough

### Assigning roles to a user

Open **Settings → Users → \[user\] → Roles**. Pick from the available roles. A user can have multiple roles — their effective permission is the union (more permissive than each alone).

### Creating a custom role

For more nuanced needs (e.g. "Sales lead — like Sales but can also see other reps' invoices"):

**Settings → Roles → + New role**.

1. **Name** — what to call it.
2. **Base role** — start from an existing role's permissions, then customise.
3. **Permission catalogue** — turn permissions on or off.
4. Save.

### The permission catalogue

Permissions are grouped by module:

- `sales.*` — view-invoice, post-invoice, void-invoice, edit-customer, etc.
- `purchase.*` — view-bill, post-bill, void-bill, edit-supplier, etc.
- `inventory.*` — view-item, edit-item, post-grn, post-stock-count, etc.
- `accounting.*` — view-gl, post-journal, lock-period, etc.
- `payroll.*` — view-employee, post-payroll-run, approve-payroll, etc.
- `settings.*` — manage-roles, manage-templates, manage-tax-codes, etc.
- `reports.*` — view-pl, view-bs, view-trial-balance, view-payroll-reports, etc.
- `platform.*` — only relevant on the platform admin side, ignore for tenant roles.

Hover any permission for a description of what it gates.

### Cost-centre and branch scoping

Custom roles can be scoped to specific cost centres / branches. E.g. "Branch A Sales" — sees only Branch A's invoices and customers. Useful for multi-branch businesses where you don't want each branch seeing other branches' data.

Configure on the role: **Restrict to cost centre = Branch A**. Documents tagged with that cost centre are visible; everything else is hidden.

## Common tasks

### Add a new staff member

**Settings → Users → + New user**. Name, email. Send invitation. They set a password from the email link, then log in. Until you assign them a role, they can't see anything — assign roles immediately after the invitation is accepted.

### Promote a user to Admin

Open the user → roles → tick **Admin**. Save. Their next login uses the new role. Their existing role remains — now they have both. To remove the old role, untick it.

### Restrict approvers to specific document types

Approvers are users with the relevant `*.approve-*` permission. To make user X an approver for invoices but not for bills: custom role with `sales.approve-invoice = true`, `purchase.approve-bill = false`.

### Audit who has access to what

**Settings → Users → Permission map** shows every user and every permission they have, in a matrix. Useful for periodic security reviews.

### Revoke access immediately

User leaves, departure is imminent. **Settings → Users → \[user\] → Suspend**. Their session is killed; they can't log in. Don't delete the user — keep the audit trail; suspend deactivates without deleting.

If the departure is friendly and they'll be back, **Suspend** is reversible.

### See what a role can actually do

Open the role's detail page. Shows every permission turned on. If the catalogue is overwhelming, pick a built-in role and view its permissions as a baseline; adapt from there.

### Permission inheritance

When permissions are turned on at "module" level (e.g. `sales.*`), every sub-permission is enabled. To deny one sub-permission while keeping the rest, turn off the module-level and individually enable the ones you want.

## What gets posted

Roles and users don't post to your books — they're access control, not transactions.

What's logged:
- **Audit log** — every role / user change is recorded.
- **Login history** — per user, every login with timestamp and IP.

## FAQ

**Can a user have no role?**
They'd be locked out of everything. The system requires at least one role assignment to be useful. Users with no roles are effectively suspended.

**Can the Owner role be assigned to multiple users?**
Yes — multiple Owners is supported and recommended (avoid single-owner risk if that person leaves the company unexpectedly). Both have full Owner permissions.

**A user has both Sales and Purchase roles. What's the effective permission?**
Union — they can do everything either role allows. So they can post both invoices and bills. Multi-role assignments are how you cover users with cross-functional responsibilities.

**Can I lock down a specific report — say, profitability per branch — to just senior management?**
Yes. The reports module has its own permission set. Custom role with `reports.view-cost-centre-pl = false`; assign to roles that shouldn't see this. Or use the `reports.view-summary-only = true` override which strips out drill-down.

**What about the customer portal — same role system?**
No — the customer portal is for external customers, not internal staff. Customer-portal users don't have roles in the internal sense; they have access to their own data and that's it. Configure the portal in **Settings → Portal**, not here.

**An ex-employee's account still appears active.**
Find them in **Users**, **Suspend**. If you're sure the account isn't needed for audit any longer (typically only after multi-year retention), you can delete; otherwise keeping suspended preserves the audit trail.

## Related

- [Security](./security.md) — passwords, 2FA, sessions for users.
- [Approvals](./approvals.md) — approver roles for workflow.
- **Audit log** — tracks role assignments and changes.
- [Platform admin overview](../platform/overview.md) — for the operator-side roles (separate system).
