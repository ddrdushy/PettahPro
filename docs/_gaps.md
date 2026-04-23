# PettahPro — Untracked Gaps (Parking Lot)

Things that are **real gaps but not on `_roadmap.md`**. The roadmap tracks features that were spec'd and are being executed against. This file tracks what's missing from the specs themselves, or from the operational picture around them — stuff we've explicitly agreed to come back to *later*, not forget.

Surfaced during the gap analysis on 2026-04-23 (post-PR #64). Discuss, prioritize, and promote to `_roadmap.md` when the time comes.

**This is a parking lot. If something here becomes urgent, it should be lifted into `_roadmap.md` as a numbered item with a size and a PR, not worked on out of this file.**

---

## A. Security gaps

Real risk surface for a system holding payroll, bank, and tax data.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| A1 | **MFA / 2FA** (TOTP minimum, WebAuthn ideal) — zero code exists today; session cookie + password is the whole auth story. | Payroll + bank data sensitivity. Compliance audit checkbox. First question from any enterprise-shaped prospect. | M |
| A3 | **Session management UI** — users can't see their active sessions or sign-out-elsewhere. | After A1 lands, this closes the loop. | S |
| A4 | **IP allow-listing per tenant** — admins can't lock app access to office IPs. | Nice-to-have until we have a tenant requesting it; then urgent. | S |
| A5 | **CSRF belt-and-braces** — we rely on SameSite=Lax + same-origin, which is fine but not double-layered. | Low-probability but easy to add once we have time. | S |

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
| D1 | **Email delivery for regular notifications** — only the monthly customer statement email uses SMTP. "Invoice posted," "payment received," "journal pending approval" are all in-app bell only. | Users who aren't actively in the app miss everything. | M |
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
| L1 | **Super-Admin Layer 1 console** (`super-admin-layer1-spec.md`) — tenant directory, billing ops, impersonation, revenue analytics. Zero code. | Today we can't see all tenants, suspend one, or run a platform query without `psql`. Required before we onboard the first paying customer. | L |
| L2 | **Pricing plan engine** (`pricing-plan-architecture-spec.md`) — tiers, feature gating, metering, dunning. Zero code. Every tenant gets every feature today. | **Biggest monetization blocker.** Can't meter, gate, or bill. Blocks paid launch. | L–XL |
| L3 | **Landing page → signup provisioning funnel** — marketing site exists under `apps/web/`, but needs real signup → tenant bootstrap → billing setup wiring. | Conversion-critical. | M |

---

## Promotion discipline

When any of the above gets promoted to `_roadmap.md`:

1. Give it a number continuing the roadmap sequence (the next free number as of this writing is **#49**).
2. Lift the description into the roadmap table under the right section (Must-have if compliance, Should-have if convenience, Nice-to-have otherwise).
3. Delete the row from this file in the same PR. This file should shrink over time.
