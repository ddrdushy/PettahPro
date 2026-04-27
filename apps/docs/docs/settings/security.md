---
title: Security
sidebar_position: 8
---

# Security

## What it does

Security is where you configure how users log in and how their access is protected — password policy, two-factor authentication, active sessions, API keys, and the audit log. Each piece exists to reduce the chance of unauthorised access to your books.

For most SMEs, the defaults are reasonable. Customise when your business has stronger requirements (regulatory, contractual, or just internal policy).

## Password policy

**Settings → Security → Password policy.**

Configure:

- **Minimum length** — defaults to 10. Don't go below 8.
- **Complexity** — require uppercase, lowercase, digit, special character. Defaults to "uppercase + lowercase + digit"; many businesses also require special character.
- **Rotation** — must change every N days. Defaults to "never". Some businesses require 90-day rotation, though current best practice is to drop rotation in favour of strong unique passwords + 2FA.
- **History** — can't reuse the last N passwords. Defaults to 5.
- **Account lockout** — after N failed login attempts, lock the account for X minutes. Defaults to 5 attempts, 15-minute lockout.

The password policy applies to all users. Stricter on Owners / Admins than on cashiers? Use 2FA enforcement instead — see below.

## Two-factor auth (2FA)

Adds a second login factor — a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password) or an SMS to the user's phone.

**Settings → Security → 2FA.**

Per-role configuration:

- **Required** — users with this role must set up 2FA before their next login.
- **Optional** — users can choose to enable 2FA on their own.
- **Not allowed** — 2FA can't be enabled for this role (rare; useful for shared / kiosk accounts).

Most businesses **require** 2FA for Owner and Admin roles, **optional** for everyone else.

### Setting up 2FA (user-side)

1. Open **My profile → Security → Enable 2FA**.
2. Scan the QR code with an authenticator app.
3. Enter the code shown by the app to verify.
4. Save the **recovery codes** — these are one-time use, for when you don't have access to your authenticator app. Store them somewhere safe.

### Recovery

User lost their phone, no recovery codes. **Settings → Users → \[user\] → Reset 2FA**. Their 2FA is reset; they'll set it up again on next login. Permission-restricted (typically only Owner/Admin can do this).

## Active sessions

**Settings → Security → Sessions** lists every active session — who's logged in, from what IP, what device, when they last did something. Click any session to **Revoke** — that session is killed; the user has to log in again.

Useful for:

- "Did I leave myself logged in at the office computer?" — revoke the office session from your phone.
- "Suspicious login from an IP I don't recognise" — revoke and change password.
- "Departing employee" — revoke all their sessions during the exit process.

## API keys

For connecting other systems to PettahPro (your bank for auto-feeding statements, your payment gateway for portal payments, custom integrations), you create API keys.

**Settings → Security → API keys**.

Each key has:

- **Name** — what it's for ("Bank of Ceylon statement feed", "PayHere webhook").
- **Permissions** — what the key can do. Typically narrower than any user's role (e.g. read-only, or limited to specific endpoints).
- **Expiry** — optional. Forces rotation; required for some compliance contexts.
- **Last used** — when the key last successfully called the API.

Keys are shown once at creation. After that, the value is hashed and unrecoverable; lost keys must be rotated, not retrieved.

### Rotating a key

If you suspect a key was leaked: **Revoke** the old one, **Create new**, update wherever the key is used. The old key stops working immediately.

## Audit log

The audit log records every privileged action — logins, posting, approvals, settings changes, role assignments, file uploads, sensitive reports run. Searchable and filterable by user, by date, by event type.

**Settings → Security → Audit log.**

Each entry shows:

- **Who** — user.
- **What** — action.
- **When** — timestamp.
- **From where** — IP address, device.
- **What changed** — the before/after of any data change.

Exportable as CSV for compliance reviews and audits.

The audit log is **append-only** — even Owner can't delete entries. Tampering would require database access (which only PettahPro itself has, with its own audit).

## Walkthrough

### Initial security setup (after signup)

1. Set the password policy. 10+ characters, complexity = uppercase + lowercase + digit + special.
2. Require 2FA for Owner and Admin roles.
3. Owner: enable 2FA on your own account.
4. Add Admin users; require they enable 2FA on first login.
5. Configure session timeout (default 8 hours; sensitive businesses use 30 minutes).
6. Set up audit-log retention — 7 years is a common minimum for SL business records.

### Periodic security review

Quarterly:

- Review **Active sessions** — anyone unusual?
- Review **Users** — anyone who left the company still active?
- Review **API keys** — any unused for 90+ days? Rotate or delete.
- Review **Audit log** — any suspicious patterns? Login from unusual IPs? Unusual permission changes?

Annual:
- Review password policy — tighten if not strict enough.
- Review 2FA enforcement.
- Review who has Owner / Admin roles — minimise the set.

## Common tasks

### Lock out a compromised user

Suspect an account is compromised. **Users → \[user\] → Suspend** (locks them out). Also **Sessions → Revoke all for this user** (kills any active sessions). They can't log back in until you unlock and they reset their password.

### Force-rotate all passwords

Imagine a major security incident. **Settings → Security → Force password reset → All users**. Everyone must change password on next login. Combined with revoking all sessions = clean slate.

### Restrict logins to specific IP ranges

For very sensitive deployments. **Settings → Security → IP allowlist**. Logins only allowed from listed IP ranges (your office, VPN, etc.). Block everything else. Powerful but inconvenient for remote workers.

### Configure SSO

For larger businesses with corporate identity providers (Google Workspace, Microsoft 365, Okta), single sign-on is supported. **Settings → Security → SSO**. Configure SAML or OIDC; once enabled, users log in via the IdP rather than with PettahPro passwords.

### Check who logged in after-hours

**Audit log → Filter to login events → Filter to weekend / after 6pm**. See if anyone logged in outside business hours; investigate any that look anomalous.

### Export audit log for an auditor

**Audit log → Export → CSV**. Pick date range. Auditors typically want 12 months. Export, hand over.

## What gets posted

**Nothing.** Security is access control, not transactions.

What gets logged:
- Every action affecting access (login, password change, role change, key rotation) is in the audit log.
- The audit log itself is append-only.

## FAQ

**Why don't you require password rotation by default?**
Industry best practice has shifted — frequent rotation tends to push users toward weaker, predictable passwords ("Password123!" → "Password124!"). Strong unique passwords + 2FA give better security than rotation.

If your compliance / regulatory framework requires rotation, configure it; if not, leave it off.

**Can I see failed login attempts?**
Yes — the audit log records both successful and failed logins. Filter to "Login failed" to see attempts. Repeated failures from one source can indicate a brute-force attempt; consider adding an IP block.

**A user enabled 2FA but lost their phone and didn't save recovery codes.**
Admin can reset their 2FA (forces them to set up again on next login). The risk is whoever has access to the user's email can also reset 2FA — so good email security is a prerequisite.

**Can I restrict POS terminals to specific devices?**
Yes — **Settings → Security → Trusted devices**. Set up the POS terminal as a trusted device; only those devices can do POS sales. Stops someone using POS credentials from a personal phone.

**What's the retention period for the audit log?**
Default is 7 years (matches SL statutory record retention). Configurable. Don't go below the regulatory minimum.

**Does PettahPro store passwords in plain text?**
No — passwords are hashed (bcrypt). Even if our database is compromised, passwords aren't recoverable. The same applies to API keys.

## Related

- [Roles](./roles.md) — defines what authenticated users can do.
- **User management** — creating / suspending / removing users.
- [Notifications](./notifications.md) — security alerts can route to the team.
