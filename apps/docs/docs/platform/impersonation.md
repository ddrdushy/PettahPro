---
title: Impersonation
sidebar_position: 3
---

# Impersonation

## What it does

Impersonation lets a PettahPro operator log in as a tenant user — to see what they see, to reproduce a problem they're reporting, or to fix something on their behalf. Critically, every impersonation session is **audit-logged**, **requires a stated reason**, and is **visible to the tenant** in their own audit log. There's no covert support — the tenant always knows when an operator was logged into their account.

Impersonation is the **only** way operators can see a tenant's business data. Platform admin reports never expose tenant transactions. If you need to look at a customer's actual numbers to support them, you impersonate.

## How to use it

### Starting an impersonation session

1. Open the tenant in **Platform → Tenants → \[tenant\]**.
2. Click **Impersonate**.
3. Pick **which user to impersonate**:
   - **Owner** — full access to everything.
   - **Specific user** — you'll see exactly what that user sees (their permissions only).
   - **Read-only impersonation** — even if you're impersonating an Owner, your session is forced to read-only. Useful for "I just want to look".
4. Enter a **reason** — what you're doing and why. This is mandatory; no reason, no impersonation. Examples:
   - "Customer reported invoice #INV-2026-0412 not emailing — investigating"
   - "Reproducing the bug ticket #1234"
   - "Customer asked us to clean up duplicate items they can't delete"
5. Click **Start session**.

You're now logged into the tenant area as that user. A persistent banner at the top of the screen reminds you that you're impersonating, with the tenant name and a **End session** button.

### Doing the work

While impersonating, you see exactly what the user sees — their dashboard, their invoices, their reports. You can navigate everywhere their permissions allow.

If you need to make changes (e.g. fix a stuck invoice), think hard before doing it: changes show up in the tenant's audit log as "made by \[your operator account\] while impersonating \[user\] for reason X". The tenant will see exactly what you did. Do only what you've discussed with them; don't go beyond the stated reason.

### Ending the session

Click **End session** in the impersonation banner. The session terminates and you're returned to the platform console. The session's start time, end time, actions taken, and reason are recorded in the audit log.

Sessions also auto-end after 60 minutes of inactivity, or if you log out, or if the tenant is suspended.

## Common tasks

### Reproduce a bug a customer reported

Customer says "when I click X, Y happens, but it shouldn't". Impersonate, click X, see whether Y happens. If it does, screenshot, file a bug, end session. If it doesn't, ask the customer for more detail — there may be data-specific factors.

### Help a customer find a transaction

Customer says "I posted a payment last month but I can't find it". Impersonate (read-only), search for the payment, share the URL or screenshot. End session. Whole thing takes 2 minutes.

### Fix something the customer can't fix themselves

Customer wants to delete an item they accidentally created but it has linked transactions. You impersonate Owner, go through the proper deletion flow (or do the journal-based cleanup), end session. The tenant's audit log shows what you changed and why.

### Restricted impersonation for support tier 1

Tier 1 support gets impersonation but only with **read-only** option enabled. They can investigate and explain but can't change data — escalation to tier 2 or 3 is required for changes. Configured per operator role in **Platform → Roles**.

### Review what was done in a session

Open the tenant's audit log. Filter by **Source = Impersonation**. Each session shows the operator, the impersonated user, the reason, the start/end times, and the actions. Click into any action to see what was changed.

## What's logged

Every impersonation creates entries in two audit logs:

### Tenant-side audit log

The tenant sees, in their own logs:

- "Operator \[email\] impersonated \[user\] from \[time\] to \[time\] — reason: \[text\]"
- Each action they took, attributed to the operator (not disguised as the user).

### Platform-side audit log

Operators (and operators' managers) see:

- Same session record, plus the operator's IP and device.
- Cross-referenced with the support ticket if linked.

Both logs are immutable and exportable.

## FAQ

**A customer said someone impersonated them without permission.**
Open the audit log, find the session, see who started it. If the reason was bogus or the actions exceeded the stated reason, that's a serious operator-side issue — it goes through the operator review process. Tenants can always file a complaint against an impersonation session.

**Can I impersonate to bypass a permission they don't have?**
No. Impersonating a user gives you that user's permissions, no more. To do something they can't do, you'd need to impersonate someone with higher permission (typically the Owner) — and the audit log shows that you did, which is visible to the tenant.

**Can I read tenant data from the platform console without impersonating?**
No. Tenant business data is invisible from the platform console. Impersonation is the only path. This is a deliberate hard rule.

**What if a tenant can't log in at all and asks us to look?**
Impersonation works regardless of whether the tenant's users can log in (since you're using your operator account, not theirs). Useful for "I forgot my password and I'm locked out, help me find my accountant's contact" cases — though for password issues, the password reset flow is usually the better answer.

**Can I impersonate a suspended tenant?**
Only if the suspension reason permits it (e.g. "billing dispute, paused account"). Suspensions for fraud or compliance lock out impersonation too — only Platform owner can override, and the override is heavily logged.

**The impersonation banner is intrusive — can I hide it?**
No. The banner is non-removable by design. It's there to remind you that what you're seeing belongs to a customer, not to you, and that everything you do is being logged.

## Related

- [Tenants](./tenants.md) — find the tenant first, then impersonate.
- [Platform admin overview](./overview.md) — for the broader operator-side picture.
