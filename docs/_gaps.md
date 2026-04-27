# PettahPro — Untracked Gaps (Parking Lot)

Things that are **real gaps but not on `_roadmap.md`**. The roadmap tracks features that were spec'd and are being executed against. This file tracks what's missing from the specs themselves, or from the operational picture around them — stuff we've explicitly agreed to come back to *later*, not forget.

Updated 2026-04-27 after the **trial-conversion + template-engine batch** — twelve PRs that closed B1, B2, B5, G1, I1, I2, I3, M9, M2 plus two L1 sub-items in one continuous run. **B1 cost-centers** shipped (PR #130 + follow-ups in #132 — first dimension on journal lines, hierarchical category tree, manual-JE wiring, per-doc cost-center pickers, cost-center-aware P&L). **B2 budgets** shipped (PR #133 — header + lines + budget-vs-actual variance report with proration). **B5 rolling trends** shipped (PR #135 — 12-month sparklines on `/app/reports/trends`). **G1 executive dashboard** shipped (PR #129 — DSO / DPO / margin / runway KPI cards). **I1 demo data** shipped (PR #136 — `seed_demo_data` / `clear_demo_data` SQL functions + `/app/settings/demo-data` toggle). **I2 guided first-setup checklist** shipped (PR #139 — derived-state checklist on the dashboard, auto-suppresses when complete). **I3 CoA customisation wizard** shipped (PR #138 — section-grouped editor on `/app/coa` with rename / deactivate / delete and SOD on system accounts). **M9 tenant logo** shipped (PR #137 upload via MinIO + PR #140 wiring into all 12 PDF renderers including the customer-portal invoice). **M2 PDFs → template engine** shipped (PRs #141–#150 — bill, quotation, credit_note, debit_note, delivery_note, proforma_invoice, purchase_order, stock_transfer, payslip, settlement_letter all now route through the template engine; ten Classic library entries; ~28 new section types like `billFrom`, `chargesTable`, `validity`, `linkedDocument`, `partiesRow`, `signBlock`, `disclaimer`, `instructions`, `warehouseRow`, the payslip cluster, and the settlement cluster). L1 sub-items closed: **tenant health score + at-risk dashboard** (PR #134 — daily sweep computing 4 sub-scores, `/platform/tenant-health` console) and **revenue / MRR / churn analytics** (PR #131 — `/platform/revenue` with cohorts, trial-conversion, failed-payment trend). Earlier in the same arc: PR #128 signup-flow coupon redemption (closes pricing-spec §8 entry point); PRs #126 / #127 platform CLI + UI fix-ups.

Earlier 2026-04-25 / 2026-04-26 — pause-subscription, renewal cron, coupon engine, add-ons engine, plan versioning + grandfathering, configurable plan catalogue (#118), and the L1 v1 third slice (operator impersonation). **CI pipeline (K5)** shipped on `chore/ci-typecheck-build`. Original 2026-04-23 surfacing covered everything since PR #64.

**This is a parking lot. If something here becomes urgent, it should be lifted into `_roadmap.md` as a numbered item with a size and a PR, not worked on out of this file.**

The next free roadmap number is **#151**.

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
| B3 | **Inter-company / tenant-group consolidation** — each tenant is an island. | Group companies with 2+ subsidiaries need consolidated reporting. Niche but real. | L |

---

## C. Banking + payments gaps

The actual "move money" layer.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| C1 | **Bank feed auto-import** — reconciliation is CSV-only. No API integration with Sampath / Commercial / HNB / DFCC / BOC / NSB / NDB / Seylan. | Biggest single productivity win available. Manual CSV upload is the #1 reason bank rec slips. | L (per bank) |
| C2 | **Online payment gateway** — PayHere / FriMi / LankaQR / Genie appear in landing copy, zero integration code. Customers can't pay invoices online, and **subscription billing also short-circuits via `SUBSCRIPTION_PAYMENT_STUB=1`** (see L2). | Affects AR collections. Required for customer portal pay-online (#31, sell §14 §3, deferred from #71) and now blocking paid launch via L2. | M per gateway |
| C3 | **Standing order / direct debit push to banks** — can't automate recurring collections. | Subscription-style businesses will ask. | L |

---

## D. Communication channels

Notifications now do in-app bell + immediate email + daily/weekly digest emails (D1 shipped in PR #53, #45, #70). What's still missing:

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| D2 | **SMS gateway** (Dialog / Mobitel bulk SMS) for payment reminders, cheque-bounce alerts. | Real SL business practice — SMS still outperforms email for payment chasing. | M |
| D3 | **WhatsApp Business integration** — customer statements, payment reminders via WhatsApp. | Table-stakes channel in SL. Landing copy promises it. | M |

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
| G2 | **Custom report builder** — every report is a hand-coded route. Pricing spec lists this as a Scale-tier feature. | Long-term escape valve from the "can you add one more column?" treadmill. | L |

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

Sample-data toggle (I1), guided first-setup checklist (I2), CoA customisation wizard (I3), opening-balance wizard, and the demo-data + checklist together cover the whole new-tenant arc. Nothing currently parked here.

---

## J. Multi-user collaboration

Roles + permissions enforce (PR #64); collaboration UX doesn't exist.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| J1 | **@mentions in notes / memos** | Table-stakes for team workflow. | M |
| J2 | **Document-scoped activity timeline** — who touched this invoice when. Today's audit log is global. | Real productivity gain for accountants reviewing history. | M |
| J3 | **Targeted approval routing** — "assign this draft JE to Nimal" vs today's "anyone with the permission can approve." | Follow-up once the #43 approval engine has a routing dimension. | M |

---

## K. Platform / operational gaps

Stuff a live production deployment needs that no spec file addresses.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| K3 | **Secrets rotation story** — `SESSION_SECRET` / `MFA_ENCRYPTION_KEY` are baked in at deploy; rotating invalidates all sessions / decryption. Need a versioned-key + dual-read window. | Real ops need; required before any production rotation cadence. | S–M |
| K4 | **Staging / pre-prod env in repo** — no staging config, no migration-dry-run script, no seeded demo tenant for QA. | Every change currently hits main without a safety net. | M |
| K5 | **CI pipeline** — PR template mentions it, but `.github/workflows/` is empty. PR #114 made prod docker images buildable end-to-end (`pnpm --filter @pettahpro/web build` + `pnpm --filter @pettahpro/api build`), so the wire is unblocked — needs a workflow that runs typecheck + build on PR + main, fails on baseline regressions. | Prerequisite for landing changes with confidence. | S |
| K6 | **API versioning** — everything is implicit v1 at root. | Foresight for breaking changes. | S |
| K7 | **Typecheck baseline → 0** — `apps/api/package.json` build was changed to `tsc --noCheck` in PR #114 to unblock the prod image; the underlying ~27 baseline errors in `_status.md §2` are still live. CI needs the real `tsc` once the baseline is cleared. | Hides real type breakages from the build. | M |
| K8 | **VPS / production runbook** — repo has docker images but no deploy doc (host provisioning, env vars, TLS, backups, log rotation, disaster recovery). | Required before any tenant signs up. | M |

---

## L. Platform-separate workstreams

Already flagged on the roadmap as separate; putting here for completeness so they're in one place.

### L1 — Super-Admin Layer 1 console (`super-admin-layer1-spec.md`)

Mostly shipped: tenant directory, suspend/reactivate, audited reveal, CLI bootstrap, platform-user MFA, multi-role staff (super_admin / support / billing), **operator impersonation** (PR #57), **revenue / MRR / churn analytics** (PR #131), and **tenant health score + at-risk dashboard** (PR #134).

**Still parked from the spec:**

| Item | Spec ref | Why it matters | Blocker |
|---|---|---|---|
| Billing operations dashboard — failed-payment dunning, manual retry, apply credit, issue refund, extend trial, override pricing, pause subscription | §9 | Required before any tenant pays | **Blocked by L2 pricing engine** |
| Support operations console — ticket inbox, KB authoring, broadcast email/banner, per-ticket privacy-respecting context | §14 | Required before scaled support | Independent of L2 |
| Migration operations queue — active migrations, stage breakdown, stuck-migration flagging, technician assignment | §16 | Real once we run an Assisted/White-glove migration | Independent |
| Industry templates editor — edit/add/clone the COA + tax-code + expense-category seeds applied at tenant signup | §12.2 | Currently we seed at signup but have no platform UI to evolve the seeds | Independent |
| Platform-wide tax-rate config with effective dates — VAT/SSCL/WHT/PAYE updated platform-wide once, historical periods retain old rates | §12.1 | Required when the next IRD rate change lands | Independent |
| Landing page CMS — WYSIWYG editor for hero/pricing/feature blocks, scheduled publish, version history, EN/TA/SI translations | §13 | Required before marketing iteration | Tied to L3 |
| Email-template library — welcome / dunning / payment-receipt / broadcast templates, same WYSIWYG | §13.3 | Required before scale | Independent |
| In-app announcements + changelog + banner targeting | §13.3 | Real once we have a public release cadence | Independent |
| Infrastructure monitoring — API uptime, queue depth, alerts/incidents, scheduled-maintenance modes, read-only mode | §15 | We have observability (#46 Prometheus + Loki + Grafana + GlitchTip) but not the alert / maintenance-mode / RCA workflow on top | Partially covered by #46 |

### L2 — Pricing plan engine (`pricing-plan-architecture-spec.md`)

**Zero code today. Every tenant gets every feature, no metering, no billing, no enforcement.** Biggest single monetization blocker — without this we cannot launch paid.

The architecture principle from the spec is critical and currently violated: **structure locked in code, values configurable via Super Admin** (§1.1). Today nothing is configurable because nothing exists. The build needs to deliver a *configurable* engine, not hardcoded constants.

| Component | Spec ref | What it does | Notes |
|---|---|---|---|
| `plans` + `plan_versions` tables — plan name, monthly/annual price (LKR), module access, usage limits, feature toggles, support tier, trial duration | §7.1 | The configurable shape. Every value editable in Super Admin without code deploy. | Plan **versioning** is mandatory — when Starter goes from 2K → 2.5K, existing tenants stay on the old version until renewal |
| Plan management UI — CRUD plans, edit prices/limits/feature toggles, archive (≠ delete, grandfathered), custom Enterprise plans per-tenant | §7.2 | Where the configurability happens | Super-admin-only |
| Feature gating runtime — `tenantHasFeature(tenantId, key)` checked on every gated route + module load | §3, §4 | The enforcement layer. Hybrid model: core / tier-gated / add-on-available | Wire into existing `requirePermission` chain |
| Usage metering + limits — counts per (tenant, metric, month): users / branches / invoices / GRNs / payslips / storage / API calls | §5, §8 | Hard-block metrics (users, branches, storage) vs auto-overage metrics (invoices, GRNs, payslips, API) | Spec §8.1 vs §8.2 |
| Overage billing engine — auto-bill on next cycle for operational metrics, with tenant overage-cap protection | §8.3 | Prevents bill shock | Tenant-set max overage |
| Add-ons engine — per-tenant entitlement for individual features (Payroll-on-Starter, multi-branch, batch tracking, quotation+SO, manufacturing, e-store, loyalty, extra users, extra storage) | §7 | "Buy individual features without full tier upgrade." Add-on auto-removed on tier upgrade that includes it | Pro-rated charge for remainder of cycle |
| Coupon engine — % off / LKR off / first N months free / extended trial; eligibility + validity window + usage limits + attribution tracking | §8 (super-admin) | Acquisition lever | Tied to billing |
| Trial machinery — 30-day full-feature, no card, auto-downgrade to Starter on expiry with data preserved, 7d/3d/expiry-day notifications, 14-day post-expiry read-only grace | §9 | Required before public signup | No freemium ever per §9.2 |
| Billing cycle handling — monthly + annual (20% off), pro-rated upgrade charges, downgrade-takes-effect-at-renewal, pause (90-day max), cancel-at-renewal, refund policy | §10, §11 | Core subscription mechanics | Annual refund pro-rates minus the discount |
| Dunning workflow — configurable per plan: retry count + intervals (e.g. day 1/3/7/14), email cadence, in-app banner, grace period before suspension, recovery on card update | §10 (super-admin) | Failed-payment handling | Super-admin overrides: pause dunning / skip to suspension / mark paid manually |
| Grandfathering — price-increase grandfather to next renewal + 60-day notification, price-decrease auto-apply, additive features free for existing tenants, restrictive features grandfathered, plan-discontinuation 6-month notice | §12 (pricing) | Customer trust during pricing changes | Spec is detailed; build to spec |
| Migration tier pricing — Self-serve (free) / Assisted (LKR 25-50K) / White-glove (LKR 100-300K), Discovery Form → quote workflow | §13 (pricing) | Wedge offering | Tier independence: any subscription plan can buy any migration tier |

**Build order for L2** (suggested, not yet sized): plans + plan-versions schema → admin UI → feature gating runtime → trial machinery → usage metering → add-ons → billing cycles + invoicing → dunning → coupons → grandfathering → migration-tier ops.

### L3 — Landing page → signup provisioning funnel

Marketing site exists under `apps/web/`, but signup → tenant bootstrap → plan selection → trial start → billing setup is not wired. Conversion-critical.

Tied to L2 (signup needs to know which plan / trial config to apply) and L1 (landing CMS in §13 of super-admin spec).

---

## M. Spec-level deferrals from shipped features

Items explicitly carved out of shipped PRs and flagged for follow-up. The roadmap's per-PR notes capture these inline; this section surfaces them so they don't get lost in the prose.

| # | Gap | Source | Rough size |
|---|---|---|---|
| M1 | **Document template builder Phase 2 — drag-drop WYSIWYG** | Deferred from #33 (sell §19.1 calls for it explicitly) | M |
| M3 | **Phase 2 template library** — payment advice / GRN / thermal POS receipts (80mm + 58mm) starters. Note: bill / quotation / credit note / debit note / delivery note / proforma / PO / stock transfer / payslip / settlement-letter "Classic" entries all shipped in #141–#150. | Deferred from #33 | S |
| M4 | **Batch/serial/expiry tracking integration on DN, stock count, credit note, stock transfer** | Deferred from #34 (v1 wired bill post + invoice post only) | M |
| M5 | **Credit-note stock reversal** — mirror the bundle explosion in reverse; pre-existing limitation predating #35 | Deferred from #35 | M |
| M6 | **Payroll ↔ attendance integration** — convert `total_minutes` from `attendance_records` into wage calc | Deferred from #39 (capture-only in v1) | M |
| M7 | **Customer portal pay-online** — invoice payment via PayHere/FriMi/LankaQR from the customer portal | Deferred from #71 (sell §14 §3); blocked by **C2** | M (after C2) |
| M8 | **Variable-amount recurring journals** — currently amount placeholders are resolved per cycle but only via review queue, not parameterised | Deferred from #52 | S |
| M10 | **XLSX parsing + live device API polling for biometric attendance** | Deferred from #39 (CSV-only in v1, per spec §5.4 Phase 2) | S–M |
| M11 | **Bonus from-attendance / OT-from-attendance** — once M6 lands, OT and absence-driven bonuses can derive automatically | Cascade from M6 | S |
| M12 | **Geo-IP enrichment + named-device labels** on the active-sessions card | Deferred from #52 | S |
| M13 | **Per-kind email templates beyond the generic single-event format + per-user quiet hours window** | Deferred from #53 | S |
| M14 | **Password-reuse prevention** — `password_history` table + retention policy | Deferred from #49 | S |
| M15 | **Tenant-wide "require MFA for all users" toggle + admin-driven MFA reset** | Deferred from #51 | S |
| M16 | **Customer / supplier payment detail page** — both surfaces are list-only today, blocking GL → source-doc deep-link from #48 | Deferred from #48 | S |
| M17 | **Petty-cash transaction detail page** — needed to deep-link from GL when source is `petty_cash_transaction` | Deferred from #48 | S |
| M18 | **Realized FX on settlement** — the open-balance FX revaluation in #65 used a proportional approximation; a true realized-on-settlement path needs separate plumbing | Deferred from #65 | M |
| M19 | **Post-GRN retrospective landed-cost bills + pro-rata by weight + per-line manual override + FX-tied landed cost** | Deferred from #59 | M |
| L1 | ~~**Super-Admin Layer 1 console** (`super-admin-layer1-spec.md`) — tenant directory, billing ops, impersonation, revenue analytics. Zero code.~~ **Substantially shipped.** v0 (PR #54) tenant directory + detail + suspend/reactivate + CLI bootstrap. v1 first slice (PR #55) platform-user MFA. v1 second slice (PR #56) multi-role staff. v1 third slice (PR #57) operator impersonation. Platform overview (#58), tenants ops density (#59), system-health (#60), plan + subscription columns (#66 + #72) all live. **Revenue / MRR / churn analytics shipped (PR #131)** — `/platform/revenue` with cohorts, trial-conversion, failed-payment trend. **Tenant health score + at-risk dashboard shipped (PR #134)** — daily sweep computing 4 sub-scores, `/platform/tenant-health` console. **Dunning ops console shipped (PR #164)** — `/platform/dunning` with manual retry / mark-paid / suspend / pause overrides + tenant banner differentiation. **L1 v1 still parked:** real charge/refund flow (refunds, invoice issuance — `SUBSCRIPTION_PAYMENT_STUB=1` short-circuits charges today). | v0 unblocks tenant-ops triage. Remaining L1 items now blocked on real payment gateway (C2). | M (remainder) |
| L2 | ~~**Pricing plan engine** (`pricing-plan-architecture-spec.md`) — tiers, feature gating, metering, dunning. Zero code. Every tenant gets every feature today.~~ **Substantially shipped in PRs #61–73**: pricing-plan engine foundation (#61), plan-gate enforcement (#62), trial expiry + grace-period handling (#63), self-serve plan change (#64), plan quotas on invoice + branch creation (#65), plan + subscription columns on platform tenants list (#66), plan-aware sidebar (#67), page-level upgrade CTA (#68), inline upgrade CTA on quota-exceeded errors (#69), app-wide trial/grace/cancelled banner (#70), per-tenant quota overrides for custom contracts (#71), tenant-side custom-contract overrides on settings (#72), plan-aware error banner on POS terminal (#73). **Plan catalogue is now configurable** — super-admins can add / edit / archive plans, prices, caps, and feature toggles from `/platform/plans` without a deploy; archived plans wind down cleanly with grandfathered subscribers. **Plan versioning + grandfathering shipped** — `plan_versions` table snapshots each edit; `tenant_subscriptions.plan_version_id` binds existing subscribers to the version they bought; price/cap/feature edits create a new version while existing subscribers stay on theirs (no surprise bills). Super-admin can bulk-migrate grandfathered subs to current via `/platform/plans/:id/migrate-subscribers`; version history visible at `/platform/plans/:id/versions`. **Add-ons engine shipped** — `addons` catalog + `tenant_addons` per-tenant subscriptions; tenants buy individual gated features (Payroll on Starter, etc.) without a tier upgrade. Gate unions active add-on features into the effective set. Auto-removal on tier upgrade so a Starter tenant who upgrades to Growth doesn't get double-charged for the Payroll add-on. Self-serve purchase + scheduled-removal at `/app/settings/plan`; platform admin catalog editor at `/platform/addons` and per-tenant grant/cancel via `POST /platform/tenants/:id/addons`. **Dunning workflow shipped (PRs #163 / #164 / #166)** — `dunning_policies` (per-plan retry intervals + grace + email cadence + suspend-after) + `subscription_charge_attempts` (full attempt history) + daily sweep cron driving the `trial → active → past_due → cancelled` state machine. Stub gateway today (`SUBSCRIPTION_STUB_FAILURE_TENANTS` env var forces failures for testing); plugs into the real charge call once C2 lands. Ops console at `/platform/dunning` with retry-now / mark-paid / suspend / pause overrides; tenant banner differentiates dunning past-due from trial-expiry past-due; transactional emails for `charge_failed` / `final_warning` / `suspended` / `recovered`. **What's still stubbed:** real charge/refund flow — `SUBSCRIPTION_PAYMENT_STUB=1` in `apps/api/src/modules/subscription/routes.ts` no-ops the gateway call. | Monetization no longer blocked, but paid launch is blocked on payment gateway (C2). | M (remainder) |
| L3 | **Landing page → signup provisioning funnel** — marketing site exists under `apps/web/`, but needs real signup → tenant bootstrap → billing setup wiring. | Conversion-critical. | M |

---

## Promotion discipline

When any of the above gets promoted to `_roadmap.md`:

1. Give it a number continuing the roadmap sequence (next free number is **#151**).
2. Lift the description into the roadmap table under the right section (Must-have if compliance, Should-have if convenience, Nice-to-have otherwise).
3. Delete the row from this file in the same PR. This file should shrink over time.

For L1 / L2 / L3 promotions, lift sub-items individually rather than the whole workstream — they're each a multi-PR build of their own.
