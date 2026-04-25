# PettahPro — Untracked Gaps (Parking Lot)

Things that are **real gaps but not on `_roadmap.md`**. The roadmap tracks features that were spec'd and are being executed against. This file tracks what's missing from the specs themselves, or from the operational picture around them — stuff we've explicitly agreed to come back to *later*, not forget.

Surfaced during the gap analysis on 2026-04-23 (post-PR #64). Discuss, prioritize, and promote to `_roadmap.md` when the time comes.

Updated 2026-04-25 after the docs-sync sweep that followed PRs #61–73 (the L2 pricing-plan engine — foundation, gating, trial/grace, self-serve change, quotas, plan-aware sidebar, page-level + inline upgrade CTAs, app-wide trial/grace banner, per-tenant quota overrides, custom-contract surface on settings, plan-aware POS error banner) and #57 (L1 v1 third slice — operator impersonation: consent-gated, time-boxed, dual-actor audit). Latest infra fix-ups: PR #113 (uuid[] ANY → IN+sql.join across 4 raw drizzle sites) and PR #114 (prod docker images buildable for both api and web). Earlier: PR #56 L1 v1 second slice (multi-role platform staff), PR #55 L1 v1 first slice (platform-user MFA), PR #54 L1 v0 (super-admin console), PR #53 D1 (email delivery for immediate notifications).

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
| C2 | **Online payment gateway** — PayHere / FriMi / LankaQR / Genie appear in landing copy, zero integration code. Customers can't pay invoices online, and **subscription billing also short-circuits via `SUBSCRIPTION_PAYMENT_STUB=1`** (see L2). | Affects AR collections. Required for customer portal (#31) and now blocking paid launch via L2. | M per gateway |
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
| K5 | **CI pipeline** — PR template mentions it, but `.github/workflows/` is empty. PR #114 made prod docker images buildable end-to-end (`pnpm --filter @pettahpro/web build` + `pnpm --filter @pettahpro/api build`), so the wire is unblocked — needs a workflow that runs typecheck + build on PR + main, fails on baseline regressions. | Prerequisite for landing changes with confidence. | S |
| K6 | **API versioning** — everything is implicit v1 at root. | Foresight for breaking changes. | S |
| K7 | **Typecheck baseline → 0** — `apps/api/package.json` build was changed to `tsc --noCheck` in PR #114 to unblock the prod image; the underlying ~27 baseline errors in `_status.md §2` are still live. CI needs the real `tsc` once the baseline is cleared. | Hides real type breakages from the build. | M |
| K8 | **VPS / production runbook** — repo has docker images but no deploy doc (host provisioning, env vars, TLS, backups, log rotation, disaster recovery). | Required before any tenant signs up. | M |

---

## L. Platform-separate workstreams

Already flagged on the roadmap as separate; putting here for completeness so they're in one place.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| L1 | ~~**Super-Admin Layer 1 console** (`super-admin-layer1-spec.md`) — tenant directory, billing ops, impersonation, revenue analytics. Zero code.~~ **v0 shipped in PR #54** (tenant directory, detail with anonymized users + audited reveal, suspend/reactivate with reason, CLI bootstrap, separate `platform_users` + `platform_audit_log` realm). **v1 first slice shipped in PR #55** (platform-user MFA). **v1 second slice shipped in PR #56** (multi-role platform staff — super_admin / support / billing roles, role-cached sessions, `/platform/staff` console, last-super-admin guardrails). **v1 third slice shipped in PR #57** (operator impersonation — consent-gated, time-boxed, dual-actor audit via `AsyncLocalStorage` stamping every `audit_events` insert; tenant-detail platform tab surfaces `platform.impersonation_*` events). Platform overview dashboard (#58), tenants ops density (#59), system-health dashboard (#60) and the per-tenant **plan + subscription columns + custom-contract overrides on platform tenants list** (#66 + #72) are also live. **L1 v1 still parked:** real billing ops (refunds, invoice issuance, dunning workflow — `SUBSCRIPTION_PAYMENT_STUB=1` short-circuits charges today), revenue / MRR / churn analytics dashboard (blocked by billing ops + a real payment gateway integration). | v0 unblocks tenant-ops triage. v1 required before scaled support + paid launch. | M (v1 remainder) |
| L2 | ~~**Pricing plan engine** (`pricing-plan-architecture-spec.md`) — tiers, feature gating, metering, dunning. Zero code. Every tenant gets every feature today.~~ **Substantially shipped in PRs #61–73**: pricing-plan engine foundation (#61), plan-gate enforcement (#62), trial expiry + grace-period handling (#63), self-serve plan change (#64), plan quotas on invoice + branch creation (#65), plan + subscription columns on platform tenants list (#66), plan-aware sidebar (#67), page-level upgrade CTA (#68), inline upgrade CTA on quota-exceeded errors (#69), app-wide trial/grace/cancelled banner (#70), per-tenant quota overrides for custom contracts (#71), tenant-side custom-contract overrides on settings (#72), plan-aware error banner on POS terminal (#73). **What's still stubbed:** real charge/refund flow — `SUBSCRIPTION_PAYMENT_STUB=1` in `apps/api/src/modules/subscription/routes.ts` no-ops the gateway call. The supplier-portal feature flag exists in `plan-features.ts` + `sidebar.tsx` + `88-pricing-plans.sql` with **no app surface** (gates a non-existent route). Dunning workflow not implemented. | Monetization no longer blocked, but paid launch is blocked on payment gateway (C2) + real dunning. | M (remainder) |
| L3 | **Landing page → signup provisioning funnel** — marketing site exists under `apps/web/`, but needs real signup → tenant bootstrap → billing setup wiring. | Conversion-critical. | M |

---

## Promotion discipline

When any of the above gets promoted to `_roadmap.md`:

1. Give it a number continuing the roadmap sequence (the next free number as of this writing is **#57**).
2. Lift the description into the roadmap table under the right section (Must-have if compliance, Should-have if convenience, Nice-to-have otherwise).
3. Delete the row from this file in the same PR. This file should shrink over time.
