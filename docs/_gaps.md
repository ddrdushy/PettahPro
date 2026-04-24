# PettahPro — Untracked Gaps (Parking Lot)

Things that are **real gaps but not on `_roadmap.md`**. The roadmap tracks features that were spec'd and are being executed against. This file tracks what's missing from the specs themselves, or from the operational picture around them — stuff we've explicitly agreed to come back to *later*, not forget.

Surfaced during the gap analysis on 2026-04-23 (post-PR #64). Discuss, prioritize, and promote to `_roadmap.md` when the time comes.

Updated 2026-04-24 after promoting L1 v1 second slice (Multi-role platform staff — super_admin / support / billing separation, role-cached sessions, staff-management console, last-super-admin guardrails) in PR #56. Earlier the same day: L1 v1 first slice (Platform-user MFA — TOTP two-step login + backup codes on `platform_users`, separate realm from tenant-side MFA) in PR #55, L1 v0 (Super-Admin Console — tenant directory + suspend/reactivate + audited reveal + CLI bootstrap) in PR #54. Earlier: D1 (email delivery for immediate notifications) in PR #53.

**This is a parking lot. If something here becomes urgent, it should be lifted into `_roadmap.md` as a numbered item with a size and a PR, not worked on out of this file.**

---

## A. Security gaps

Real risk surface for a system holding payroll, bank, and tax data.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| A4 | **IP allow-listing per tenant** — admins can't lock app access to office IPs. | Nice-to-have until we have a tenant requesting it; then urgent. | S |

---

## B. Accounting / data-model gaps

Things a real multi-branch or multi-project SME will ask for on day one.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| B1 | **Cost centers / projects / dimension tags on journal lines** — today every journal line is flat CoA. `branchId` is on document headers but doesn't flow into GL lines for reporting. | Any tenant with multiple branches who wants "P&L by branch" or "P&L by project" can't get it. Real ask from anyone beyond 1-location businesses. | L — `dimensions jsonb` on `journal_lines` + dimension-catalog table + reporting-layer updates + every post site needs to propagate. |
| B2 | **Budget / forecast tables + budget-vs-actual report** — no budgets table exists. | Any finance team past the sole-proprietor tier wants this. | M |
| B3 | **Inter-company / tenant-group consolidation** — each tenant is an island. | Group companies with 2+ subsidiaries need consolidated reporting. Niche but real. | L |
| B5 | **Rolling 12-month trend views, sparkline dashboards** — P&L-compare shipped but no trend view. | Dashboard credibility. | M |

---

## C. Banking + payments gaps

The actual "move money" layer.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| C1 | **Bank feed auto-import** — reconciliation is CSV-only. No API integration with Sampath / Commercial / HNB / DFCC / BOC / NSB / NDB / Seylan. | Biggest single productivity win available. Manual CSV upload is the #1 reason bank rec slips. | L (per bank) |
| C2 | **Online payment gateway** — PayHere / FriMi / LankaQR / Genie appear in landing copy, zero integration code. Customers can't pay invoices online. | Affects AR collections. Required for customer portal (#31). | M per gateway |
| C3 | **Standing order / direct debit push to banks** — can't automate recurring collections. | Subscription-style businesses will ask. | L |

---

## D. Communication channels

Notifications live in-app only.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| D2 | **SMS gateway** (Dialog / Mobitel bulk SMS) for payment reminders, cheque-bounce alerts. | Real SL business practice — SMS still outperforms email for payment chasing. | M |
| D3 | **WhatsApp Business integration** — customer statements, payment reminders via WhatsApp. | Table-stakes channel in SL. | M |

---

## E. Compliance / e-filing

We compute the numbers, tenants file manually.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| E1 | **IRD e-filing for VAT / PAYE / WHT returns** — remittance dashboards compute + display; no direct submission. | Real time-saver and correctness win. Requires IRD portal API access. | L |
| E2 | **EPF / ETF online submission** — same pattern. | Same story. | M each |

---

## F. Data lifecycle

GDPR/PDPA-shaped obligations.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| F1 | **Export-my-data** — tenants can't download a full archive. | Offboarding + backup + PDPA compliance. | M |
| F2 | **Data retention / archival policy** — everything stays hot forever. | At ~5 years, big tenants will feel it in query times. | M (schema + archive worker) |
| F3 | **Tenant-level backup / restore UI** — only implicit Postgres volume today. | Disaster recovery confidence. | M |

---

## G. Reports & analytics polish

Beyond the basic shipped reports.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| G1 | **Executive dashboard with KPI cards** — DSO, DPO, gross margin %, inventory turns, cash runway. Today's `/dashboard` is mostly "recent docs." | Specs describe this; not built. | M |
| G2 | **Custom report builder** — every report is a hand-coded route. | Long-term escape valve from the "can you add one more column?" treadmill. | L |

---

## H. Mobile

No native / no PWA / no offline.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| H1 | **PWA manifest + service worker + install prompt** — cheapest path to "app on home screen." | Field sales + POS + attendance want this. | S–M |
| H2 | **Offline mode for POS / DN-on-delivery / attendance** — requires local queue + sync. | Required by the #28 POS spec. | L |
| H3 | **Native app** — iOS + Android. | Only if PWA isn't enough. Probably over-building. | XL |

---

## I. Onboarding

Opening balance wizard exists; nothing else.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| I1 | **Sample-data / demo-tenant toggle** — new tenants start empty. | Trial-conversion killer. | M |
| I2 | **Guided first-setup tour** — "set up your first customer / item / tax code" walkthrough. | Trial-conversion win. | M |
| I3 | **Chart-of-accounts customization wizard** — we seed a default CoA, tenants take it or leave it. | Accountants want to tweak before the first transaction. | M |

---

## J. Multi-user collaboration

Roles + permissions enforce (PR #64); collaboration UX doesn't exist.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| J1 | **@mentions in notes / memos** | Table-stakes for team workflow. | M |
| J2 | **Document-scoped activity timeline** — who touched this invoice when. Today's audit log is global. | Real productivity gain for accountants reviewing history. | M |
| J3 | **Targeted approval routing** — "assign this draft JE to Nimal" vs today's "anyone with the permission can approve." | Follow-up once #43 approval engine lands. | M |

---

## K. Platform / operational gaps

Stuff a live production deployment needs that no spec file addresses.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| K3 | **Secrets rotation story** — `SESSION_SECRET` is baked in at deploy; rotating invalidates all sessions. | Real ops need. | S |
| K4 | **Staging / pre-prod env in repo** — no staging config, no migration-dry-run script, no seeded demo tenant for QA. | Every change currently hits main without a safety net. | M |
| K5 | **CI pipeline** — PR template mentions it; verify `.github/workflows/` actually runs typecheck + tests on PR. | Prerequisite for landing changes with confidence. | S (if missing) |
| K6 | **API versioning** — everything is implicit v1 at root. | Foresight for breaking changes. | S |

---

## L. Platform-separate workstreams

Already flagged on the roadmap as separate; putting here for completeness so they're in one place.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| L1 | ~~**Super-Admin Layer 1 console** (`super-admin-layer1-spec.md`) — tenant directory, billing ops, impersonation, revenue analytics. Zero code.~~ **v0 shipped in PR #54** (tenant directory, detail with anonymized users + audited reveal, suspend/reactivate with reason, CLI bootstrap, separate `platform_users` + `platform_audit_log` realm). **v1 first slice shipped in PR #55** (platform-user MFA — TOTP two-step login, authenticator-or-backup-code, enrol/disable card on `/platform/account`, separate realm from tenant-side MFA). **v1 second slice shipped in PR #56** (multi-role platform staff — super_admin / support / billing roles, role-cached sessions, `/platform/staff` console, role-aware suspend/reveal, last-super-admin guardrails, `create-platform-admin --role` CLI). **L1 v1 still parked:** operator impersonation (consent-gated, time-boxed, fully audited — next up as #57), billing ops (plan changes, refunds, invoice issuance — blocked by L2 pricing engine), revenue / MRR / churn analytics dashboard (blocked by billing ops). | v0 unblocks tenant-ops triage. v1 required before scaled support + paid launch. | L (v1 remainder) |
| L2 | **Pricing plan engine** (`pricing-plan-architecture-spec.md`) — tiers, feature gating, metering, dunning. Zero code. Every tenant gets every feature today. | **Biggest monetization blocker.** Can't meter, gate, or bill. Blocks paid launch. | L–XL |
| L3 | **Landing page → signup provisioning funnel** — marketing site exists under `apps/web/`, but needs real signup → tenant bootstrap → billing setup wiring. | Conversion-critical. | M |

---

## Promotion discipline

When any of the above gets promoted to `_roadmap.md`:

1. Give it a number continuing the roadmap sequence (the next free number as of this writing is **#57**).
2. Lift the description into the roadmap table under the right section (Must-have if compliance, Should-have if convenience, Nice-to-have otherwise).
3. Delete the row from this file in the same PR. This file should shrink over time.
