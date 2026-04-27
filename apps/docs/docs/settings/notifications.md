---
title: Notifications
sidebar_position: 5
---

# Notifications

## What it does

Notifications is where you set up two things:

1. **Outbound email** — how PettahPro sends emails on your behalf (invoice emails to customers, payslips to employees, statements, reminders). Includes the SMTP configuration, default subject and body for each email type, and a log of every email sent so you can see deliveries and bounces.
2. **In-app alerts** — what events ping which users inside PettahPro (the bell icon in the header). E.g. "approval pending", "low stock", "new customer signed up via portal".

Both are essential for a smooth operation — if outbound email is misconfigured, customers don't get their invoices; if in-app alerts are missing, important events go unnoticed.

## Outbound email

### Setting up SMTP

**Settings → Notifications → Email → SMTP**.

You need an SMTP server — either:

- **PettahPro-hosted** — the default, no setup needed. Emails come from a PettahPro address with your business as the sender name. Suitable for most small businesses.
- **Your own domain** — if you want emails to come from `invoices@yourbusiness.lk` (more professional, better deliverability), configure your SMTP server (Google Workspace, Microsoft 365, your hosting provider's SMTP, or a transactional email service like SendGrid / Postmark / Resend).

For your own domain, also set up SPF and DKIM records — without them, your invoice emails likely land in spam. PettahPro shows the DNS records you need to add.

### Email templates per type

Each email type has its own template:

- **Invoice email** — sent when you click "Send" on an invoice. Default body: "Dear \[customer name\], please find attached invoice \[number\] for \[amount\]. Payment due by \[due date\]."
- **Payslip email** — sent when you "Send payslips" on a payroll run.
- **Statement email** — sent when you "Send statement" to a customer.
- **Reminder email** — for overdue invoices, recurring schedule reminders, etc.
- **Receipt email** — confirmation when a customer payment is received.
- **Welcome email** — to new customer-portal users.
- **Approval-needed email** — to approvers when an item lands in their queue.

Edit each template's subject, body, and tone. Variables like `{{customer.name}}`, `{{invoice.number}}`, `{{invoice.total}}` get replaced at send time.

### Outbound log

**Settings → Notifications → Email → Log** shows every email sent — recipient, subject, send time, delivery status (sent / bounced / failed). Useful for "the customer says they didn't get it" troubleshooting.

If a delivery failed, the log shows the error (recipient unknown, mailbox full, server rejected, etc.).

### Bulk-disable email for testing

When testing PettahPro (e.g. trying things during onboarding), you don't want test invoices going to real customer email addresses. Toggle **Test mode** in **Settings → Notifications**. Outbound emails are diverted to a single test recipient (e.g. your address) instead of going to the real recipient.

Off by default in production.

## In-app alerts

### What gets alerted

Out of the box, PettahPro alerts on:

- **Approval needed** — pings the relevant approver.
- **Approval result** — pings the submitter when their item is approved or rejected.
- **Low stock** — pings inventory manager when an item drops below reorder level.
- **Payment received** — pings finance when a customer payment lands.
- **New customer portal signup**.
- **Failed payroll run / disbursement**.
- **High variance on stock count**.
- **Overdue customer (past X days)**.

For each event, you configure which roles (or specific users) get alerted, and how (in-app only / in-app + email / email only).

### Reading and managing alerts

The bell icon in the header shows unread alerts with a red dot. Click to see the list; click any alert to navigate to the related document. Alerts auto-archive after a configurable period (default 30 days).

### Slack / Teams integration

If your team lives in Slack or Microsoft Teams, you can route alerts there. **Settings → Notifications → Integrations** lets you connect a Slack workspace or Teams channel; alerts post as messages.

Useful when your operations team isn't logged into PettahPro all day but is always in Slack.

## Common tasks

### Configure your-domain emails

Go to **Settings → Notifications → Email → SMTP**, switch to "Your own domain". Enter SMTP host, port, credentials. Set sender email (e.g. `invoices@yourbusiness.lk`). Save and **Test** — PettahPro sends a test email; if it arrives, you're good. Don't forget to update SPF/DKIM DNS records.

### Customise the invoice email body

Most businesses tweak the default body to match their tone — friendlier, more formal, with bank details for direct transfer, etc. **Settings → Notifications → Email → Invoice template**. Edit the body using available variables. Save; the next invoice email uses the new template.

### Disable a noisy alert

If "low stock" alerts fire too often (e.g. for items where reorder is fine to delay), either raise the threshold per item, or turn off the alert globally for now. **Settings → Notifications → In-app → Low stock → Disable**.

### Set up Slack alerts for finance

Connect Slack workspace, pick a `#finance` channel. Configure: route "Payment received", "Approval needed (finance)", "Failed disbursement" alerts to Slack. Now finance sees these in their normal channel; less back-and-forth into PettahPro.

### Reminder cadence for overdue invoices

Out of the box, reminder emails fire 7 days before due, on the due date, and 7 days after due. Configurable. **Settings → Notifications → Email → Invoice reminder schedule**. Adjust the cadence and the wording (politer at first, firmer later).

### Bounce handling

When a customer email bounces, the **Outbound log** records it. PettahPro doesn't auto-retry — you check the email address with the customer and update their record. The bounce stays as a flag on the customer's record so you don't keep sending to a broken address.

### Whitelist your sender domain

Most ISP / corporate spam filters trust SPF + DKIM but some still flag unfamiliar senders. Tell large customers to whitelist your invoice-sender domain on their end; reduces "didn't get it" incidents.

## What gets posted

**Nothing.** Notifications are communication, not transactions.

What gets logged:
- **Outbound emails** — every send recorded with status.
- **In-app alerts** — every alert generated, who saw it, when.
- **Audit log** — settings changes recorded.

## FAQ

**Customer says they didn't get the invoice. How do I confirm?**
Check the outbound log for that invoice's email. If sent and delivered: customer's spam filter is the culprit. If sent and bounced: invalid address. If never sent: the email might have been disabled, the customer might not have an email on their record, or your SMTP wasn't configured. Each diagnosis has a different fix.

**Is the PettahPro-hosted email good enough?**
For small businesses, usually yes. Larger businesses with high invoice volumes typically benefit from their own domain — better deliverability, more professional appearance, no shared-domain reputation issues. The break-even point is usually around 100-200 invoices/month.

**Can a single user get alerts via both email and in-app?**
Yes — per alert type, configure both channels. Some users prefer email (always with them), some prefer in-app (less noise in inbox). Different events for different staff.

**SMTP credentials test fails — what next?**
Most common: wrong port (use 587 for TLS, 465 for SSL, 25 only for non-secure), wrong password (paste fresh from your provider), or the SMTP server requires an app-specific password (Google Workspace, etc., often need 2FA app passwords rather than account password).

**Can alerts be muted on weekends?**
Yes — per alert type, set quiet hours. E.g. "low stock" doesn't alert during weekends; "failed payment" alerts always. Useful to avoid waking people up for non-urgent things.

**How do I send a one-off custom email?**
Outside the standard email types, no built-in flow. Use your own email client. The notifications module is for the recurring, system-driven emails.

## Related

- [Branding](./branding.md) — branding affects email design.
- [Sell → Invoices](../sell/invoices.md) and [Customer payments](../sell/customer-payments.md) — common email triggers.
- [Approvals](./approvals.md) — approval flows trigger many alerts.
