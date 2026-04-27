---
title: Demo data
sidebar_position: 9
---

# Demo data

## What it does

Demo data is a one-click button that loads a realistic month of sample data into your business — five customers, four suppliers, eight items, six invoices, four bills, three payments, plus matching journals. It exists for one reason: so you can see what PettahPro looks like with real content rather than empty dashboards, before you've entered anything.

Useful for:

- Trying things out during the trial — see how the dashboards, reports, and workflows feel with content.
- Training new staff — they can practice on demo data before working on real records.
- Showing the system to a colleague / accountant / investor — the screens look meaningful.

The same screen has a one-click button to **clear** the demo data once you're done with it. Your real records (anything you create yourself) stay put.

## Walkthrough

Open **Settings → Demo data**.

### Loading

Click **Load demo data**. PettahPro creates:

- **5 customers** — varied (one local Sri Lankan customer, one foreign, one with multiple branches, etc.).
- **4 suppliers** — similar variety.
- **8 items** — mix of products and services.
- **6 invoices** — across different customers, different dates within the last month.
- **4 bills** — across different suppliers.
- **3 payments** — partial for "this customer paid" / "we paid this supplier" patterns.
- **Matching journal entries** to make all of the above post correctly.

The data is dated within the last 30 days, so reports show recent activity. Items have stock; payroll has employees; the dashboards have numbers.

Loading takes 5-10 seconds.

### Clearing

When you're done with demo data (typically before going live with real data, or after a training session), click **Clear demo data**.

PettahPro reverses every demo record in the right order — clears journals, then payments, then invoices and bills, then customers / suppliers / items. The clear walks newest-first to avoid foreign-key conflicts; if anything blocks (e.g. a real document referencing a demo customer), it skips and reports.

After clearing, your real records (anything you've created yourself, not loaded by the demo button) stay completely untouched. The clear is **only** scoped to records flagged as demo.

## Common tasks

### Use demo data during onboarding

You're new to PettahPro and want to explore. Load demo data; click around — invoices, dashboards, reports, customer portal — to see what's there. When you're ready to start real work, clear and start clean.

### Train new staff with realistic content

Hired a new accountant. Have them practice on demo data: post a test invoice, run a report, do a payment. They get muscle memory without risk of breaking real records. Clear when they're confident.

### Demo to your accountant

Your external accountant wants to see what PettahPro looks like. Load demo data, give them a guided tour of the dashboards and reports. Clear afterwards.

### See how a feature behaves at scale

Some features (e.g. AR aging, sales-by-category) are more useful when there's lots of activity. Demo data gives you enough to feel the feature; for actual scale testing, you'd want more than the demo's modest volumes.

### Restore demo data after clearing

If you cleared and want it back, just **Load** again. PettahPro re-creates a fresh set of demo records (different customers / dates than last time, since the seed is randomised within bounds). They don't conflict with the previous load.

## What gets posted

Demo data **posts journals as if it were real**. So while it's loaded, your trial balance, P&L, balance sheet, AR aging — every report — reflects the demo activity.

Once cleared, all the demo journals are reversed, leaving your books exactly as they were before.

The implication: **don't load demo data on a tenant that has real data** unless you want demo numbers mixed with real ones (very confusing). Demo data is for fresh / training tenants.

## FAQ

**Can I run demo + real data in parallel?**
Possible but not recommended. Reports show both, which is misleading. If you want to demo for a specific audience, do it in a separate tenant (signup is free during trial).

**Will clearing demo data delete anything I've added?**
No. Clear only removes records that PettahPro flagged as demo when they were created. Anything you created yourself is independent and untouched.

**Demo data won't load — what's wrong?**
Most likely permission. Demo loading requires `settings.manage` (Owner / Admin only). If you're on a less-permissive role, you can't load.

If permission's right but it still fails: check whether demo data is **already** loaded (the button shows a different state). Or check whether PettahPro itself has an error in the loading process — see the audit log.

**Can demo data be customised?**
Currently no — the demo records are fixed (with light randomisation per load). For more elaborate sandboxing, just create your own test transactions on a separate tenant.

**Does demo data affect statutory filings?**
While loaded, yes — Form C, EPF, VAT return all reflect the demo employees / activity. **Don't file anything to the IRD while demo data is loaded.** Clear first.

**Demo data was loaded a year ago and the dates are old. Can I refresh?**
Clear and reload. The new load uses dates relative to today, so the demo activity is "recent" again.

## Related

- **Settings → Users** — load demo data is restricted to `settings.manage` permission.
- [Getting started](../getting-started.md) — referenced as a way to explore before entering real data.
