---
title: Branding
sidebar_position: 2
---

# Branding

## What it does

Branding is where you put your logo, brand colour, and trading name into PettahPro. Once configured, your branding appears on every PDF the system generates (invoice, bill, payslip, settlement letter, statement, every receipt) and on the customer portal — so customers see your brand, not PettahPro's.

For a single-tenant business this is a one-time setup. Most businesses configure it during the first week and never come back, except when the logo gets refreshed every few years.

## Walkthrough

Open **Settings → Branding**.

### Logo

**Upload logo** to add the image. Constraints:

- **Formats** — PNG, JPEG, or WebP. SVG isn't supported (it's a script-execution risk inside PDFs and emails).
- **Max size** — 2 MB.
- **Recommended dimensions** — at least 600 px wide. The PDF and portal will resize as needed.
- **Background** — PNG with transparency works best, especially if the logo will appear on different backgrounds.

The logo preview shows how it'll appear on a sample document. Replace by uploading a new one; remove if needed.

### Primary colour

A single hex code that drives accent colour throughout the brand-facing surfaces:

- The customer portal uses it for buttons, headers, links.
- Selected document templates use it for header bars and headings.
- Email templates use it for buttons.

Pick something that matches your existing brand. The colour picker shows live previews.

### Trading name

If your registered business name is "Sampath Enterprises Pvt Ltd" but you trade as "Sampath", set the trading name to "Sampath" — it'll appear on documents instead of the long form. Useful when the registered name is unwieldy or differs from how customers know you.

The registered name is still used for legal documents (TIN, BR-numbered docs, statutory filings); the trading name is for display.

## Common tasks

### Refresh the logo

New logo design, new file. Upload, preview a sample doc, save. Existing posted documents (already-generated PDFs) keep their old logo because they were rendered at the time of posting; they won't auto-regenerate. New documents from the save point onwards use the new logo.

### Brand colour for the portal

The portal is the most visible brand surface to customers. Make sure your brand colour gives sufficient contrast for text — light brand colours can look fine but make button text hard to read. The colour picker has accessibility hints.

### Logo on a dark background

If a document template has a dark header (e.g. some Classic templates can be themed dark), upload a logo with transparent background or a light variant. PettahPro shows the logo against the template's background colour in the preview.

### Multi-business branding

Each business in PettahPro has its own branding — they don't share. If you run two related businesses, configure each separately.

### Different branding per document type

Currently no — branding is one set per business. The colour and logo apply across all PDFs. For per-document customisation (e.g. a special template for special documents), use a custom **Document template** with the customisation embedded.

### What happens to documents already sent

The PDFs you already emailed to customers don't change. The branding configuration only affects PDFs generated from now on. So if you change your logo in March, an April invoice has the new logo; the February invoice you re-print still has the old one. PettahPro doesn't retroactively re-render history.

## What gets posted

**Nothing.** Branding is presentation, not transactions.

What branding affects:
- **PDF generation** — every PDF generated after the configuration save uses the new branding.
- **Customer portal** — the portal applies the branding live.
- **Outbound emails** — the brand colour is used in email templates.

## FAQ

**Why isn't SVG allowed for logos?**
SVG can contain JavaScript and external references, which are security risks inside generated PDFs and emails. PNG / JPEG / WebP are static images with no executable content. The trade-off is a small file-size hit; for a logo, it's negligible.

**My logo looks blurry on the PDF.**
Probably uploaded a low-resolution image. PDFs are vector-rendered; the logo within is rendered at the size on the page. If the source was 200 px wide and the document scales it to 600 px wide, it'll look pixelated. Upload at least 600 px wide; ideally 1200 px for high-res rendering.

**Can I use my brand colour on tenant emails (the ones our customers receive from PettahPro)?**
Yes — the email templates use the brand colour for buttons and accent. **Settings → Notifications** is where you control the email content; **Branding** controls the colour applied.

**The customer portal looks "PettahPro" in style — can I make it look more like our brand?**
Logo, colour, and trading name are the customisable surfaces. The deeper layout (where buttons are, what fields are shown) is fixed. For full white-label or domain-on-our-domain (e.g. portal.\[your domain\].lk), set up a custom domain in **Settings → Portal** — then customers see your domain rather than PettahPro's URL.

**Why does the registered name still appear sometimes even though I set a trading name?**
Statutory documents need the registered name. So invoices to customers can use the trading name, but Form C (EPF), ETF schedules, and tax filings always use the registered name. PettahPro picks the right one based on the document type.

**Can I have multiple logos for different sub-brands?**
Currently no — one logo per business. For sub-brand needs, the cleanest approach is one PettahPro tenant per sub-brand. They're cheap to set up and keep books cleanly separate.

## Related

- [Document templates](./document-templates.md) — where the logo and colour are applied.
- [Notifications](./notifications.md) — where branding affects email design.
- **Customer portal** — the brand-facing surface.
