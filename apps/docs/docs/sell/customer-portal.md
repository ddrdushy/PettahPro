---
title: Customer portal
sidebar_position: 9
---

# Customer portal

## What it does

The customer portal is a self-service area for your customers. They log in (with their own account, separate from your team's) and can:

- See every invoice you've issued them — paid and unpaid.
- See their statement and current balance.
- Download invoice PDFs.
- Pay an open invoice online (LankaQR, card, bank transfer).
- See their delivery notes and order status.
- Update their contact details.

The portal lives at a separate URL from your tenant area — typically `portal.\[your domain\].lk` or similar. Your customers never see your accounting screens; they only see what's relevant to them.

For a B2B business with regular customers, the portal massively reduces "send me a copy of invoice X" emails. For a B2C-style business, it's the difference between customers calling in for balances and customers serving themselves.

## Walkthrough

### Enabling the portal for a customer

1. Open the customer's record → **Portal access**.
2. Set the customer's login email (defaults to their primary email).
3. Click **Send portal invitation**. PettahPro emails the customer a link to set their password and log in.

### What the customer sees

After logging in, the customer lands on their dashboard:

- **Outstanding balance** — total they owe.
- **Recent invoices** — last 5, with status (paid / unpaid / overdue).
- **Pay now** — quick link to settle outstanding invoices.

From there, they can navigate to:

- **All invoices** — full history with filters and download.
- **Statement** — full statement of account, downloadable as PDF.
- **Profile** — their contact details (editable for non-critical fields like phone, email; locked for things like business name and tax number).
- **Payments** — every payment they've made you, for their own records.

### Paying online

If you've enabled portal payments, the **Pay now** flow:

1. Customer picks which invoice(s) to pay.
2. Picks the payment method — LankaQR, card, bank transfer.
3. Completes the payment via the gateway.
4. PettahPro receives the payment confirmation, posts a customer payment, allocates against the chosen invoices, sends the customer a receipt.

All happens without you doing anything.

## Common tasks

### Bulk invite customers to the portal

For going-live with the portal across all your customers: **Customers → Bulk action → Send portal invitations**. Every selected customer gets the email. Track who's logged in via **Customers → Portal usage**.

### Reset a customer's portal password

Customer says "I forgot my password". Either: (a) ask them to use the portal's own "forgot password" link; or (b) on the customer record, click **Reset portal password** to send them a new reset email.

### Disable portal access for a specific customer

Open the customer → **Portal access → Disable**. They can't log in anymore. Useful for customers who've left or accounts in dispute.

### Set up portal payments

**Settings → Portal → Payment methods**. Pick which methods you want to accept (LankaQR, card via Stripe / PayHere, bank transfer with reference). Each requires its own integration setup.

### Customise what customers see

**Settings → Portal → Visible features**. Toggle: invoices on/off, statement on/off, delivery notes on/off, online payment on/off. Most businesses leave everything on; some hide delivery-note tracking if they don't ship goods.

### Brand the portal

**Settings → Portal → Branding**. Upload a logo, set the primary colour, set the support email. The portal then shows your brand to your customers, not PettahPro's.

## What gets posted

The portal itself doesn't post anything — it's a read-and-pay surface. What posts is the **payment** when a customer pays online:

| Account | Debit | Credit |
|---|---|---|
| Bank — primary (or gateway clearing) | Amount | |
| Accounts receivable | | Amount |

Same as any other customer payment. The fee charged by the payment gateway (if any) is booked as a separate expense at the gateway's settlement date.

## FAQ

**Can I see when a customer last logged into the portal?**
Yes — on the customer record, the **Portal access** section shows last login. For aggregate stats, **Settings → Portal → Usage** shows logins and active customers across the portal.

**Customer says "I can see invoice X but not invoice Y."**
Check whether invoice Y is **posted** (drafts don't appear on the portal). Also check that both invoices belong to the same customer record (sometimes multiple customer records exist by accident).

**Can the portal show the customer their open quotations?**
Yes — turn on **Quotations on portal** in the visibility settings. Customer can view, accept, or reject quotations directly. If they accept, the system can auto-convert to a sales order.

**My customer wants their head office to see invoices for all branches.**
Use the **Multi-customer linking** feature: link multiple customer records (one per branch) to a single portal user. The user sees a switcher on login: "View as: HQ / Branch A / Branch B". Each customer's data stays isolated; the user with permission sees all.

**Is the portal available in English only?**
Currently English. Sinhala / Tamil are on the roadmap.

**Can I send a portal-only customer (no email contact) a paper statement?**
Yes — paper statements work the same as for any customer. The portal is additive, not exclusive.

## Related

- [Invoices](./invoices.md) — what shows on the portal.
- [Customer payments](./customer-payments.md) — how online payments record.
- **Customer statements** — printable statement of account.
- [Settings → Branding](../settings/overview.md) — including portal branding.
