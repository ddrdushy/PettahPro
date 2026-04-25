# PettahPro — Untracked Gaps (Parking Lot)

Things that are **real gaps but not on `_roadmap.md`**. The roadmap tracks features that were spec'd and are being executed against. This file tracks what's missing from the specs themselves, or from the operational picture around them — stuff we've explicitly agreed to come back to *later*, not forget.

Updated 2026-04-25 after the L1 v1 third slice (Operator impersonation — request → approve → start → end with dual-actor audit, time-boxed sessions, super-admin force-end, owner-revoke from `/settings/security`) in PR #57. **CI pipeline (K5)** shipped on `chore/ci-typecheck-build` (typecheck + build + test on every PR) — promoted out of the parking lot. Earlier the same week: D1 email delivery (#53), L1 v0 super-admin console (#54), L1 v1 first slice platform MFA (#55), L1 v1 second slice multi-role staff (#56).
Surfaced during the gap analysis on 2026-04-23 (post-PR #64). Discuss, prioritize, and promote to `_roadmap.md` when the time comes.

Updated 2026-04-26 after the **subscription renewal cron** PR — daily sweep that handles the lifecycle bookkeeping accumulated by the addons + coupons + versioning work. Three steps run back-to-back idempotently: (1) addon `pending_removal` → `cancelled` once `current_period_end` elapses (delivers the spec §7.1 promise that tenants keep features through their cancellation cycle); (2) coupon redemption ticking — `applies_for='once'` flips to `consumed` after the first billing period, `applies_for='months'` increments `months_applied` and consumes when target met, `applies_for='forever'` just increments; (3) subscription period rollover advances `current_period_start/end` by the billing cycle for active/past_due rows whose period has elapsed. Wired into the BullMQ scheduled worker as `subscription-renewal-sweep` (24h cadence, fires after `expire-trials`). Manual trigger at `POST /platform/subscription/renewal-sweep` (super_admin only) returns the sweep counts inline so ops can verify behaviour without waiting 24h. All transitions write `platform_audit_log` rows with the system sentinel email. Earlier today: **coupon engine** PR — closes pricing-spec §8 / super-admin §8.1. New `coupons` catalog + `coupon_redemptions` per-tenant snapshot table. v1 supports `percent_off` (bps) and `amount_off_cents` discount types; `once` / `forever` / `months` durations; eligibility filters by plan code, validity window, max-redemptions cap, one-per-tenant flag. Platform admin catalog CRUD at `/platform/coupons` (super-admin edits, billing role views) with redemptions drill-down. Tenants redeem at `/app/settings/plan` via lookup → confirm → apply and see their redemption history. Two seeded examples: `AVURUDU2026` (20% off × 3 months, 500 max) and `WELCOME5K` (LKR 5,000 off first invoice, new signups only on Growth/Scale). The discount itself is recorded but not applied to billing yet (still `SUBSCRIPTION_PAYMENT_STUB=1`); the renewal worker will consume `active` redemptions when real billing wires up. Earlier today: **add-ons engine** PR — closes pricing-spec §7. New `addons` catalog table + `tenant_addons` per-tenant subscriptions, both with platform-admin CRUD; super-admin can grant/cancel on any tenant. Tenants self-serve purchase / schedule-removal at `/app/settings/plan` (gated on `SUBSCRIPTION_PAYMENT_STUB=1` like change-plan). Gate unions active add-on features into the effective set. Auto-removal on tier upgrade — when a tenant moves to a plan whose features already cover an active add-on, that add-on is auto-cancelled (`auto_removed_at` stamped). Two seed add-ons mapped to existing `requireFeature()` gates: **Payroll add-on** (LKR 2,000/mo, grants `payroll`, eligible for Starter) and **Approval workflows add-on** (LKR 1,500/mo, grants `approval_workflows`, eligible for Starter+Growth). Earlier today: **plan versioning + grandfathering** PR — closes pricing-spec §7.2 + §12.1. New `plan_versions` table holds immutable value snapshots; `tenant_subscriptions.plan_version_id` binds each subscriber to the version they bought; editing a plan creates a new version (catalog-level changes like `sortOrder`/`isPublic` mutate in place — no version bump). New endpoints: `GET /platform/plans/:id/versions` (history with subscriber counts), `POST /platform/plans/:id/migrate-subscribers` (bulk move grandfathered subs to current). The signup flow now creates a 30-day Growth trial subscription bound to the current version (closing a latent gap where new tenants previously had no subscription row at all). Editor drawer surfaces "Saving will create v3 — N grandfathered subscribers stay on v2" so price changes can't surprise existing tenants. Earlier today: configurable plan catalogue PR (PR #118). Earlier: PR #115 docs-sync sweep that documented PRs #61–73 (L2 pricing-plan engine — foundation, gating, trial/grace, self-serve change, quotas, plan-aware sidebar, page-level + inline upgrade CTAs, app-wide trial/grace banner, per-tenant quota overrides, custom-contract surface on settings, plan-aware POS error banner) and #57 (L1 v1 third slice — operator impersonation: consent-gated, time-boxed, dual-actor audit). Earlier: PR #56 L1 v1 second slice (multi-role platform staff), PR #55 L1 v1 first slice (platform-user MFA), PR #54 L1 v0 (super-admin console), PR #53 D1 (email delivery for immediate notifications).

**This is a parking lot. If something here becomes urgent, it should be lifted into `_roadmap.md` as a numbered item with a size and a PR, not worked on out of this file.**

The next free roadmap number is **#58**.

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
| B2 | **Budget / forecast tables + budget-vs-actual report** — no budgets table exists. | Any finance team past the sole-proprietor tier wants this. Pricing spec lists "Budgeting module" as a Scale-tier feature. | M |
| B3 | **Inter-company / tenant-group consolidation** — each tenant is an island. | Group companies with 2+ subsidiaries need consolidated reporting. Niche but real. | L |
| B5 | **Rolling 12-month trend views, sparkline dashboards** — P&L-compare shipped but no trend view. | Dashboard credibility. | M |

---

## C. Banking + payments gaps

The actual "move money" layer.

| # | Gap | Why it matters | Rough size |
|---|---|---|---|
| C1 | **Bank feed auto-import** — reconciliation is CSV-only. No API integration with Sampath / Commercial / HNB / DFCC / BOC / NSB / NDB / Seylan. | Biggest single productivity win available. Manual CSV upload is the #1 reason bank rec slips. | L (per bank) |
| C2 | **Online payment gateway** — PayHere / FriMi / LankaQR / Genie appear in landing copy, zero integration code. Customers can't pay invoices online. | Affects AR collections. Required for customer portal pay-online (sell §14 §3, deferred from #71). | M per gateway |
| C2 | **Online payment gateway** — PayHere / FriMi / LankaQR / Genie appear in landing copy, zero integration code. Customers can't pay invoices online, and **subscription billing also short-circuits via `SUBSCRIPTION_PAYMENT_STUB=1`** (see L2). | Affects AR collections. Required for customer portal (#31) and now blocking paid launch via L2. | M per gateway |
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
| G1 | **Executive dashboard with KPI cards** — DSO, DPO, gross margin %, inventory turns, cash runway. Today's `/dashboard` is mostly "recent docs." | Specs describe this; not built. | M |
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

Mostly shipped: tenant directory, suspend/reactivate, audited reveal, CLI bootstrap, platform-user MFA, multi-role staff (super_admin / support / billing), and **operator impersonation** (consent-gated, time-boxed, dual-actor audit) in PR #57.

**Still parked from the spec:**

| Item | Spec ref | Why it matters | Blocker |
|---|---|---|---|
| Billing operations dashboard — failed-payment dunning, manual retry, apply credit, issue refund, extend trial, override pricing, pause subscription | §9 | Required before any tenant pays | **Blocked by L2 pricing engine** |
| Revenue analytics dashboard — MRR / ARR / churn % / trial conversion / LTV / cohort retention / failed-payment trend / geo breakdown | §11 | Required before scaled support + paid launch | Blocked by L2 |
| Tenant health score + at-risk flagging | §4.10, §11, §14.5 | Proactive churn defence | Needs §11 |
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
| M2 | **Migrate the other 10 PDFs to the template engine** — bill, quotation, credit note, debit note, delivery note, proforma, PO, GRN, stock transfer, payslip, settlement letter | Deferred from #33 (one PR per doc type, mechanical) | M total |
| M3 | **Phase 2 template library** — PO / GRN / payment advice / quotation / thermal POS receipts (80mm + 58mm) starters | Deferred from #33 | S |
| M4 | **Batch/serial/expiry tracking integration on DN, stock count, credit note, stock transfer** | Deferred from #34 (v1 wired bill post + invoice post only) | M |
| M5 | **Credit-note stock reversal** — mirror the bundle explosion in reverse; pre-existing limitation predating #35 | Deferred from #35 | M |
| M6 | **Payroll ↔ attendance integration** — convert `total_minutes` from `attendance_records` into wage calc | Deferred from #39 (capture-only in v1) | M |
| M7 | **Customer portal pay-online** — invoice payment via PayHere/FriMi/LankaQR from the customer portal | Deferred from #71 (sell §14 §3); blocked by **C2** | M (after C2) |
| M8 | **Variable-amount recurring journals** — currently amount placeholders are resolved per cycle but only via review queue, not parameterised | Deferred from #52 | S |
| M9 | **Logo upload via MinIO on `tenant_settings`** — needed for proper template-builder branding | Deferred from #33 | S |
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
| L1 | ~~**Super-Admin Layer 1 console** (`super-admin-layer1-spec.md`) — tenant directory, billing ops, impersonation, revenue analytics. Zero code.~~ **v0 shipped in PR #54** (tenant directory, detail with anonymized users + audited reveal, suspend/reactivate with reason, CLI bootstrap, separate `platform_users` + `platform_audit_log` realm). **v1 first slice shipped in PR #55** (platform-user MFA). **v1 second slice shipped in PR #56** (multi-role platform staff — super_admin / support / billing roles, role-cached sessions, `/platform/staff` console, last-super-admin guardrails). **v1 third slice shipped in PR #57** (operator impersonation — consent-gated, time-boxed, dual-actor audit via `AsyncLocalStorage` stamping every `audit_events` insert; tenant-detail platform tab surfaces `platform.impersonation_*` events). Platform overview dashboard (#58), tenants ops density (#59), system-health dashboard (#60) and the per-tenant **plan + subscription columns + custom-contract overrides on platform tenants list** (#66 + #72) are also live. **L1 v1 still parked:** real billing ops (refunds, invoice issuance, dunning workflow — `SUBSCRIPTION_PAYMENT_STUB=1` short-circuits charges today), revenue / MRR / churn analytics dashboard (blocked by billing ops + a real payment gateway integration). | v0 unblocks tenant-ops triage. v1 required before scaled support + paid launch. | M (v1 remainder) |
| L2 | ~~**Pricing plan engine** (`pricing-plan-architecture-spec.md`) — tiers, feature gating, metering, dunning. Zero code. Every tenant gets every feature today.~~ **Substantially shipped in PRs #61–73**: pricing-plan engine foundation (#61), plan-gate enforcement (#62), trial expiry + grace-period handling (#63), self-serve plan change (#64), plan quotas on invoice + branch creation (#65), plan + subscription columns on platform tenants list (#66), plan-aware sidebar (#67), page-level upgrade CTA (#68), inline upgrade CTA on quota-exceeded errors (#69), app-wide trial/grace/cancelled banner (#70), per-tenant quota overrides for custom contracts (#71), tenant-side custom-contract overrides on settings (#72), plan-aware error banner on POS terminal (#73). **Plan catalogue is now configurable** — super-admins can add / edit / archive plans, prices, caps, and feature toggles from `/platform/plans` without a deploy; archived plans wind down cleanly with grandfathered subscribers. **Plan versioning + grandfathering shipped** — `plan_versions` table snapshots each edit; `tenant_subscriptions.plan_version_id` binds existing subscribers to the version they bought; price/cap/feature edits create a new version while existing subscribers stay on theirs (no surprise bills). Super-admin can bulk-migrate grandfathered subs to current via `/platform/plans/:id/migrate-subscribers`; version history visible at `/platform/plans/:id/versions`. **Add-ons engine shipped** — `addons` catalog + `tenant_addons` per-tenant subscriptions; tenants buy individual gated features (Payroll on Starter, etc.) without a tier upgrade. Gate unions active add-on features into the effective set. Auto-removal on tier upgrade so a Starter tenant who upgrades to Growth doesn't get double-charged for the Payroll add-on. Self-serve purchase + scheduled-removal at `/app/settings/plan`; platform admin catalog editor at `/platform/addons` and per-tenant grant/cancel via `POST /platform/tenants/:id/addons`. **What's still stubbed:** real charge/refund flow — `SUBSCRIPTION_PAYMENT_STUB=1` in `apps/api/src/modules/subscription/routes.ts` no-ops the gateway call. The supplier-portal feature flag exists in `plan-features.ts` + `sidebar.tsx` + `88-pricing-plans.sql` with **no app surface** (gates a non-existent route). Dunning workflow not implemented. | Monetization no longer blocked, but paid launch is blocked on payment gateway (C2) + real dunning. | M (remainder) |
| L3 | **Landing page → signup provisioning funnel** — marketing site exists under `apps/web/`, but needs real signup → tenant bootstrap → billing setup wiring. | Conversion-critical. | M |

---

## Promotion discipline

When any of the above gets promoted to `_roadmap.md`:

1. Give it a number continuing the roadmap sequence (next free number is **#58**).
2. Lift the description into the roadmap table under the right section (Must-have if compliance, Should-have if convenience, Nice-to-have otherwise).
3. Delete the row from this file in the same PR. This file should shrink over time.

For L1 / L2 / L3 promotions, lift sub-items individually rather than the whole workstream — they're each a multi-PR build of their own.
