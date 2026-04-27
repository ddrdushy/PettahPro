---
title: Document templates
sidebar_position: 3
---

# Document templates

## What it does

Every PDF that PettahPro generates — invoice, bill, payslip, settlement letter, purchase order, the lot — uses a template that controls the layout. The template engine is what lets you customise how a document looks: which sections appear, in what order, with what wording, what fonts, what spacing. You can either use the templates we ship (the **Classic** library) or clone and edit them.

Document templates aren't free-form HTML editing — you build them by composing **sections** (Header / Bill-to / Line items / Totals / Sign block / etc.). Each section has parameters; you tweak them; the output rendering takes care of the typography. This is much more reliable than hand-editing HTML.

## How it works

Each document type (invoice, bill, payslip, etc.) has its own list of templates. At any time, **one template per document type is active** — that's the one used when a document is rendered.

PettahPro ships with the **Classic** library: clean, conservative-looking templates suitable for most businesses. They're activated by default. If you never visit this page, your documents look like the Classic templates — which is fine.

If you want customisation:

1. Browse the library to see what's available.
2. Clone a template into your business.
3. Edit the cloned version.
4. Set the cloned version as active.

Original library templates can never be edited or deleted (they stay as the reference). Your clones are yours to modify or remove.

## Walkthrough

### Browsing templates

Open **Settings → Document templates**. The list shows every template, grouped by document type. For each:

- **Name**.
- **Source** — Library (Classic) or Custom (your clone).
- **Active for** — which document type it's currently active for, if any.
- **Last edited** — for custom templates.

Click any template to preview — sample document rendered with the template's layout.

### Cloning a template

Click a Classic template → **Clone**. The clone appears in your custom list with the suffix " (copy)". Edit the name to something meaningful ("Invoice — minimal", "Invoice — detailed").

### Editing a custom template

Click into your clone → **Edit**. You see the section list:

- **Header** — your logo, business details (registered name, address, TIN, contact).
- **Document title** — "INVOICE", "TAX INVOICE", "PROFORMA INVOICE", etc.
- **Meta row** — invoice number, date, due date.
- **Bill-to / Bill-from** — customer / supplier details.
- **Line items table** — the body — items, quantities, prices.
- **Charges table** — discounts, other charges.
- **Totals** — subtotal, VAT, total.
- **Sign block** — for documents that need signature lines.
- **Disclaimer / Footer** — bank details, terms, etc.

For each section, you can:

- **Toggle visibility** — hide a section you don't want.
- **Reorder** — drag to reposition.
- **Edit parameters** — wording, alignment, fonts, what fields show.

The preview pane shows live updates as you edit.

Save when done.

### Setting a template as active

On the template list, click **Set as active for: \[document type\]**. The previously-active template stays in your list but is no longer used. You can switch back any time.

### Per-customer or per-document templates

Some businesses want different templates for different customers (e.g. one customer needs the invoice in their format) or for different document subtypes (cash invoice vs credit invoice). Use **per-customer template assignment** on the customer record, or **per-subtype** on the document type.

## Common tasks

### Add company tagline below the logo

Edit the active invoice template → Header → enable **Tagline** → enter your tagline. Save. Future invoices show the tagline.

### Hide the WHT line on invoices that don't have WHT

WHT only applies to bills (you withhold from suppliers). The invoice template doesn't show WHT by default. If somehow showing, edit the template → Totals → uncheck WHT.

### Match an existing pre-printed format

Some businesses have pre-printed invoice paper (logo and footer pre-printed; PettahPro fills the body). Edit the active template → reduce the header height to a few mm of padding (so it doesn't overlap the pre-printed logo). Reduce the footer to match.

### Bilingual documents

For documents that need to show both English and Sinhala / Tamil, the template engine supports per-section bilingual labels. Edit the section → enable bilingual → enter the second language. Renders side-by-side or below.

### Use a different logo on payslips

Per-template logo override. Open the payslip template → Header → upload alternative logo. (Useful if HR has its own brand variant.)

### Restore a Classic template

If you've heavily edited a custom template and want to start over, clone the Classic again — you get a fresh copy with all defaults. Discard the broken custom one.

### Test before committing

The preview pane shows a sample. For a more thorough test, generate a real document (e.g. post a draft invoice as a test) — the live render is the most accurate check.

## What gets posted

**Nothing.** Templates are presentation, not transactions.

What templates affect:
- **PDF rendering** — every PDF generated uses the active template for its document type.
- **Email previews** — emails with PDF attachments include the rendered PDF per the template.
- **Customer portal** — the customer-facing PDF download uses the same template.

## FAQ

**My customer wants their logo on my invoice (white-label).**
That's not what the template engine does — it always shows your branding. For genuine white-label arrangements (you're an agent / subcontractor billing under their brand), they'd send their own invoices, not yours.

**Can I have a template with embedded JavaScript / dynamic content?**
No — templates are static at render time. Dynamic content (e.g. "show this line only if X") is configurable via section visibility rules, but no scripting. Keeps the rendering reliable.

**Can I export my template to share with another business?**
The template library is internal to PettahPro. To share with a peer business (e.g. a sister company), they'd recreate by cloning Classic and editing. There's no template-export-import for now.

**A template renders fine for one customer but breaks for another.**
Almost always a data issue — one customer has unusually long fields (a long business name, a multi-line address). The template should handle it; if it doesn't, edit to allow more space.

**Can I A/B test two invoice templates?**
Not formally. You can have one active and another as draft / inactive. To genuinely A/B test, you'd switch active periodically and compare customer feedback / portal payment rates — manually.

**Why are some templates marked "Library" and uneditable?**
Library templates are PettahPro-maintained references. They get updated occasionally (e.g. if a statutory requirement changes the format). You can clone them and edit your clone freely; the library stays as a stable reference.

## Related

- [Branding](./branding.md) — logo and colour applied to templates.
- **Each document type** — the active template determines its rendering.
- **Customer portal** — uses the same templates for customer-facing PDFs.
