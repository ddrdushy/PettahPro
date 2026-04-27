---
title: Number series
sidebar_position: 4
---

# Number series

## What it does

Each document in PettahPro (invoice, bill, payment, payslip, journal, GRN, etc.) gets its number from a **series** — a prefix combined with a counter. By default, each document type has one series with a sensible default — `INV-2026-0001`, `BILL-2026-0001`, and so on. The series page is where you customise the format if your business needs something different.

For most SMEs, the defaults work fine. Customisation is for businesses with multiple branches, separate fiscal-year resets, special draft / posted prefixes, or specific format requirements (e.g. an auditor wants invoice numbers in a particular pattern).

## How a series works

Each series defines:

- **Prefix** — a fixed string (e.g. `INV-`, `INV-2026-`).
- **Counter** — the running number, padded to a fixed width (e.g. `0001`).
- **Suffix** — an optional fixed string at the end (rare).
- **Reset rule** — when (if ever) the counter resets to 0001.

Combined, they produce the document number: `INV-2026-0001`.

Once a number is allocated, it's allocated. PettahPro doesn't reuse numbers from voided drafts; the audit trail stays gap-aware.

## Walkthrough

Open **Settings → Number series**. The list shows every series for every document type.

### Editing an existing series

Click a series → **Edit**. Change the prefix, counter format, reset rule. Save.

The change applies to **future** documents. Already-numbered documents keep their numbers — number changes don't retroactively rewrite history.

### Adding a new series for a document type

Most document types support multiple series. Click **+ New series for invoices** (for example). Configure prefix, counter, reset, and which contexts use it.

Common reasons to add a series:

- **Per-branch** — Branch A invoices use `INV-A-`; Branch B uses `INV-B-`.
- **Separate draft prefix** — Drafts use `D-INV-`; posted use `INV-`.
- **Different document subtypes** — Cash invoices use `CINV-`; credit invoices use `INV-`.

### Picking which series applies

If you have multiple series for one document type, you assign them to contexts:

- **Per branch / cost centre** — invoices created at Branch A automatically get the A series.
- **Per user** — specific users default to a specific series.
- **Per document subtype** — e.g. cash invoices use one, credit invoices another.

Set defaults via **Settings → Number series → Routing rules**.

### Reset rules

Three options:

- **Continuous** — the counter never resets. `INV-0001`, `INV-0002`, `INV-9999`, `INV-10000`, etc.
- **Fiscal year** — counter resets to 0001 at the start of each financial year. Common in SL — invoice numbers re-include the year (`INV-2026-0001`, `INV-2027-0001`).
- **Calendar year** — same as fiscal-year reset, but on 1 January regardless of FY. Less common in SL where FY is April-March.

## Common tasks

### Set up per-branch invoice numbering

Each of three branches numbers its invoices independently. Create three series: `INV-COL-`, `INV-KAN-`, `INV-GAL-`. Assign each to its branch (cost centre) in routing rules. Now invoices created at Colombo get `INV-COL-0001`, etc., independent of other branches.

### Fiscal-year reset

Change the existing series's reset rule from Continuous to Fiscal year. From the next FY start (1 April), the counter restarts at 0001. Invoices issued in the current year keep their numbers; April 1's invoice is `INV-2027-0001`.

### Differentiate cash and credit invoices

Create a `CINV-` series for cash invoices, keep `INV-` for credit invoices. Assign based on document subtype. Helps when reconciling bank receipts (cash invoices appear in a known number range).

### Voided draft — does the number get reused?

No. If a draft was allocated the next number and is then voided, that number is "used" — it doesn't appear on any posted document, but the next document gets the next-higher number. This keeps the audit trail straight.

If you genuinely need to fill a gap (e.g. you discovered an unrecorded invoice that should have been numbered earlier), add it manually and acknowledge the out-of-sequence in the audit log.

### Printable label series

For physical label printing (warehouse barcodes, shelf tags), you might want a separate series with a distinct prefix. Same configuration; the labels module knows to use the series.

### Changing format mid-year

Common scenario: starting on PettahPro mid-year, you want the new invoices to continue from where your old system left off (e.g. last invoice was 4523; PettahPro should continue from 4524). Edit the series's **starting counter** to 4524. The next invoice gets that number.

### Leading zeros

The counter format determines padding. `0001` is 4-digit; `00001` is 5-digit. Most businesses use 4-digit (allows up to 9,999 documents per period) — switch to 5 if you have higher volume.

## What gets posted

Number series themselves don't post — they're a numbering rule.

What's affected:
- **Every new document allocated a number** uses the series active for its document type / context.
- **Audit trail** — each document records which series allocated its number.

## FAQ

**Can I edit an already-allocated number?**
No. Once a document has a number, that number stays. Edit attempts are rejected. Audit trails depend on number stability.

**Two documents got the same number — what happened?**
Shouldn't — PettahPro guarantees uniqueness per series. If you see this, contact support immediately. Most likely cause: someone forced a manual entry that bypassed the system.

**Auditor wants invoice numbers in a specific format we don't have.**
Configure the series prefix / counter to match. Existing invoices keep their old numbers; future invoices follow the new format. The auditor can see both periods in the GL.

**My old system had 4-digit numbers; PettahPro is showing 6-digit.**
Edit the counter format to 4-digit. Caveat: if your business hits 9,999 documents in a year, you'd need to expand. Most SMEs are well below.

**Can a series include the customer's reference?**
Some businesses do "INV-\[Customer Code\]-0001" — but it makes per-customer series messy. Better practice: keep the document number business-wide unique, store the customer reference separately. The customer's PO number can go on a custom field on the invoice.

**Calendar-year reset would create gaps if our FY is April-March.**
Right — pick fiscal-year reset, not calendar. Or continuous if you don't want any reset.

## Related

- [Document templates](./document-templates.md) — number prints on the document per the template.
- **Each document type** — the relevant series allocates the number at posting.
