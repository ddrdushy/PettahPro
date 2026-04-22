# PettahPro Build Roadmap

Live tracker of what's shipped, what's next, and what's backlog — cross-checked against the 23 spec files in `/docs/` (see [`_summary.md`](./_summary.md) for a per-file digest).

**Three-doc triangle:** this file says what's shipped; [`_status.md`](./_status.md) says what's broken, fragile, or at-risk right now; [`_gaps.md`](./_gaps.md) is the parking lot for real gaps that aren't on the roadmap yet (security, cost-centers, bank feeds, e-filing, observability, platform workstreams). Promote items from `_gaps.md` into this file when it's their turn.

Last updated: 2026-04-23 after shipping #44 FX revaluation at period close in PR #65. **All must-haves, all original should-haves, and #42 / #44 follow-ups all shipped.** Remaining tracked backlog: two follow-ups from PR #63 (#43 approval engine wiring, #45 notification digests) plus the Nice-to-have list.

---

## ✅ Shipped (PRs #1 – #64)

### Platform foundation
- Multi-tenant Postgres with RLS (`current_tenant_id()` + `SET LOCAL app.tenant_id`), enforced at a non-superuser `pettahpro_app` role so dev and prod both actually exercise the policies (PR #48)
- Cross-tenant auth reads go through SECURITY DEFINER helpers (`auth_find_user_by_email`, `auth_find_user_by_id`, `auth_email_in_use`, `auth_touch_last_login`) — same pattern as the recurring-invoice worker (PR #48)
- Auth: signup / login / logout / me / session cookies
- Branches (multi-location), warehouses (schema)
- `tenant_settings` JSONB store with `GET/PATCH /settings` (knobs: `salaryDaysPerMonth`, `stockRelieveOn`)
- Settings page replaces the old "Soon" placeholder
- BullMQ worker + Redis, hourly cron scaffold
- Notifications (header bell + red-dot badge, in-app only, routed per `refType`)
- Audit columns (created_at/updated_at, deleted_at, created_by_user_id)
- **Build status tracker** (`docs/_status.md` + PR template) — known bugs, typecheck debt baseline (47 → 32 errors after PR #47), fragile areas, regression log, module health; PR template forces every PR to declare modules touched + regression surface + test plan
- **Shared helpers for repeated patterns** — `pdfResponse(buffer, filename)` (apps/web) funnels every PDF route through one BodyInit-safe Response builder; `nextDocumentNumber(tx, kind)` (packages/db) wraps `SELECT next_document_number(...)` with typed kinds and undefined-guard so call sites can't silently destructure `undefined` (PR #47)

### Sell
- Customers (CRUD, statements, aging)
- Quotations (CRUD, send/accept/reject/expired/convert, **PDF**)
- Sales orders (CRUD, confirm, cancel, convert-to-invoice)
- Delivery notes (CRUD, deliver, cancel, **PDF** with signature block, optional stock relief at deliver time)
- Invoices (CRUD, post, void, duplicate, **PDF**, stock relief at post by default)
- Recurring invoices (monthly templates, hourly BullMQ cron → draft invoices, pause/resume/generate-now)
- Credit notes (CRUD, post, **PDF** with draft banner — PR #46)
- Customer payments (cash/cheque/bank-transfer, cheque lifecycle linkage)
- **Proforma invoices** — pre-sale preview document for advance payments / customs purposes. CRUD + send → accepted → converted workflow; converts to a live invoice one-to-one (one proforma → one real invoice, idempotent). Separate `PRO-YYYY-NNNN` number series. **PDF** with clear non-fiscal banner and "proforma invoice — not a tax invoice" footer so it can't be mistaken for a live invoice (PR #51)
- **Customer statement email delivery** — on-demand send from the customer statement page plus a monthly cron that fires on day-1 for every customer with outstanding balance. `send_statements` per-customer opt-out, `customer_statement_emails` log table with success/failure per send, SMTP retries on transient failure. Bulk send summary shown in the customer list so AR can see at a glance who's been notified this cycle (PR #55)
- **Batch / consolidated invoicing** — roll multiple delivered delivery notes into one invoice per customer in one run. `POST /invoices/batch-from-delivery-notes` groups eligible DNs by customer, generates one draft invoice per group with all lines merged, and returns a per-customer success/skip summary. `/app/invoices/batch` web page lets AR pick the date window + customer filter, preview groupings, and fire the batch. Keeps one-invoice-per-customer atomicity so partial failures never strand a DN in a half-consumed state (PR #62)
- **Multi-currency on sales & purchases** — invoices, credit notes, bills, debit notes, and both payment sides carry optional `currency` + `fx_rate` + `foreign_total_cents` alongside the ledger-in-LKR `amount_cents`. Rate captured at document date from the `fx_rates` table (`/app/settings/fx-rates` CRUD for USD/EUR/GBP daily rates). v1 semantic: ledger stays in LKR (no dual-book revaluation yet), foreign fields drive document display only — PDFs show "USD 1,200.00 @ 305.50 = LKR 366,600.00". Unrealized FX revaluation at period close is a follow-up (see backlog). Realized FX gain/loss COA (4900 / 5900) seeded. Works transparently for single-currency tenants: if `currency` is null, everything behaves exactly as before (PR #61)

### Buy
- Suppliers (CRUD, statements)
- Purchase orders (CRUD, send/acknowledge/cancel/convert-to-bill, **PDF**)
- Goods received notes / GRNs (CRUD, receive, cancel, links to PO and bill)
- Bills (CRUD, post, void, **PDF** — draft banner on unposted bills so AP approvers can preview before posting)
- Debit notes (CRUD, post, **PDF** with draft banner — PR #46)
- Supplier payments (cash/cheque/bank-transfer, cheque lifecycle)
- **Recurring bill templates** — bills equivalent of recurring invoices. Template captures supplier + items + amount + frequency (weekly / monthly / quarterly / annual) + start/end dates + auto-post-vs-review flag. Hourly BullMQ cron generates drafts; review-queue variant lands in the bills list as draft, auto-post variant posts directly. Pause / resume / edit / end-date supported; variable-amount templates keep the structure fixed and prompt for the per-cycle amount (PR #51)
- **Supplier statement reconciliation** — upload (or paste CSV of) the statement your supplier sends you and reconcile it against what's on our bills/payments ledger. `POST /suppliers/:id/reconcile` returns a four-way classification per line: `matched` (exact ref + amount), `amount_mismatch` (ref match, different amount — likely their data entry error or a missed credit note), `only_in_ours` (we've booked it, they haven't — typical when we've posted a recent bill they haven't received), `only_in_theirs` (they claim it, we don't — investigate: lost bill, cleared cheque not yet in our system, or a dispute). `/app/suppliers/[id]/reconcile` web page for the workflow. AP finally has a tool for the monthly "what does the supplier statement say vs us" exercise without hand-ticking spreadsheets (PR #62)
- **Landed cost allocation** — freight / insurance / customs / clearing / loading / other charges captured as extra lines on a supplier bill. At post time those amounts allocate pro-rata across the bill's inventory lines (by `value` default, or by `quantity`) and fold into each item's unit cost before the stock receipt posts, so WAVG reflects the true landed cost. Largest-remainder rounding keeps the cents balanced; journal stays balanced (DR Inventory grows by base + allocated, CR AP matches). Charges on a bill with no inventory lines expense to a fallback `5130 Freight & handling` account (rare clearing-agent-only path). Client-side preview mirrors the server allocation algorithm. V2 follow-ups explicitly deferred (see #9b once scoped): post-GRN retrospective landed-cost bills, pro-rata by weight, per-line manual override, FX-tied landed cost (PR #59)

### Inventory
- Items (CRUD, WAVG valuation, reorder_point)
- Stock on-hand + stock ledger per item (inbound in-transit qty surfaced on the on-hand page)
- Low-stock report + crossing notifications
- **Stock counts (physical / cycle counts)** — blind-count workflow (counter can't see system qty until after entry), scope = full warehouse / category / specific items. Draft → in-progress → review → posted state machine; variance review shows System qty vs Counted qty vs Variance (qty + LKR) with per-line reason code (damage / theft / expiry / shrinkage / miscount / system-error / other). Tiered approval per inventory-module-spec §17.3: absolute variance ≤ 1% of counted value posts direct; > 1% routes to Owner per the SOD rule that the count executor ≠ variance approver. Post books the adjustment journal (Inventory adjustment ↔ Inventory) and writes `stock_count_adjustment` ledger entries; the count record becomes immutable once posted (PR #50)
- **Stock transfer between warehouses** — two-step draft → dispatched → received state machine; dispatch deducts source + writes `transfer_out` ledger + allocates transfer number; receive adds to destination at dispatch-time unit cost (preserving WAVG across warehouses) + writes `transfer_in` ledger; short receipts flag `has_discrepancy` on the header for later reconciliation; draft cancel supported (post-dispatch cancellation = reverse transfer); printable driver's note **PDF** with source/destination route and dispatched/received signatures

### Accounting
- Chart of accounts, tax codes (VAT, SSCL, WHT)
- Journal entries (manual + auto-posted from every module)
- Fixed assets (CRUD, monthly depreciation run)
- Bank reconciliation (CSV import, auto-match to customer/supplier payments + cleared cheques, reconcile)
- Cheques (9-state lifecycle: issued → handed-over → deposited → presented → cleared | bounced | stopped | cancelled | stale, with legal-action flag)
- Stale cheque auto-flag (PR #66) — daily cron transitions past-6-month cheques to `stale`, emits per-cheque notifications, offers reissue for issued-direction (new cheque linked via `replaced_by_cheque_id`, original JE untouched)
- **Period lock** (soft_closed / closed) enforced at `postJournal` choke point; month-end and year-end close with P&L→retained-earnings transfer; reopen audit trail
- **WHT** withheld at supplier-payment time; `/app/accounting/wht` dashboard with per-month balance, by-supplier totals, remittance history, and remit-to-IRD action
- **Opening balance** import for onboarding tenants from BUSY/Tally (TB grid with paste-CSV + one-shot posting guardrails)
- **Customer credit enforcement** — credit_hold hard block + credit_limit soft block at invoice post; auto-flag on 2+ bounced cheques
- **Bad debt write-off with VAT relief** — give up on collection cleanly, claim SL VAT Act §26 relief on 12+ month-old invoices, reverse if they pay later; `/app/reports/bad-debts` tallies it
- **Journal entry approval workflow** — tenant-set threshold above which manual JEs go to a drafts queue for second-pair-of-eyes approval; SOD-enforced (approver ≠ creator); `/app/journals/approvals` pending + recent queue
- **Recurring journal templates** — balanced-entry templates with variable prompts (amount placeholders resolved per cycle); auto-post variant books directly, review-queue variant lands in `/app/recurring-journals` for HR/accountant to adjust before posting. Per-template frequency (monthly / quarterly / annual) + next-run date; hourly cron fires due templates; every generated entry carries template provenance for audit (PR #52)
- **Number series config** — customise per-document prefix templates with token substitution (`INV-{YYYY}-{####}`, `FS-{YYYY}-{####}`, etc.) and reset period (yearly / monthly / continuous). Live preview before save; tenant-level override of the default per-kind template via `document_sequences.template`; default-template trigger on insert keeps existing kinds backfilled. Every callsite allocates via `nextDocumentNumber(tx, kind)` so changes here flow through uniformly (PR #53)
- **Audit log viewer** — append-only `audit_events` stream covering identity (login/logout), posting (journal.post/void, approve/reject), period (close/reopen/close_year), void (invoice/bill/payment), AR hygiene (bad_debt writeoff/reverse, credit hold/release), HR (exit, confirm probation, payroll post/void, final-settlement lifecycle), and settings (update, number_series.update) events. Viewer at `/app/audit-log` with filter-by-kind, date range, actor, and deep-link back to the affected entity (journal_entry / invoice / bill / employee / period / customer). `recordAuditEvent` never throws — a failed audit write doesn't break the primary action (PR #54)
- **FX rates catalogue** — `fx_rates` table keyed by `(tenant_id, currency, rate_date)` with `rate_cents_per_unit` storing LKR × 10⁴ per foreign unit for four decimals of precision. Admin page `/app/settings/fx-rates` to enter daily rates manually for USD/EUR/GBP (auto-fetch from CBSL / exchangerate.host is a v2 follow-up). Document capture uses the latest `rate_date ≤ document_date`, so back-dated documents pick up the contemporaneously-valid rate. Underpins the multi-currency fields on invoices/bills/payments shipped in PR #61
- **FX revaluation at period close** — standard LKAS 21 / IFRS re-measurement of open foreign AR (invoices) and AP (bills) to the closing rate on a user-picked `as_of_date`. `/app/accounting/fx-revaluation` drives a draft → posted → voided lifecycle: compute a draft to preview per-document deltas, post to book the Unrealized FX gain (4510) / loss (5510) journal against the AR (1100) / AP (2000) control accounts, or void to post a reversing JE. Incremental-delta semantics — each line records `cumulative_delta_cents` (vs issue-date rate) and `previous_cumulative_delta_cents` (the last posted run's cumulative for the same document), so the JE only books the incremental change. New runs naturally supersede prior ones without a month-start reversal. Unique `(tenant, as_of_date)` index where `status <> 'voided'` blocks duplicate active runs. Open foreign-outstanding computed proportionally from `amount_paid_cents / total_cents` — a pragmatic v1 approximation until the realized-FX-on-settlement path lands. v1 scope: invoices + bills (credit / debit notes float outside the "open balance" concept until explicitly allocated). Gated by `accounting.manage`; JE posts dated as-of so period-lock is enforced by `postJournal` (PR #65)

### HR / Payroll
- Employees (CRUD + salary structure assignments)
- Salary components (CRUD, earnings/deductions, EPF/ETF/PAYE flags)
- Payroll runs (create, post, pay; EPF 8% employee / 12% employer, ETF 3%, PAYE)
- NP leave auto-deduction via `NOPAY-LV` component (pro-rated by tenant `salaryDaysPerMonth`)
- Paid + unpaid leave days shown on payslip + **PDF**
- Leave types (AL/CL/SL/ML/PL/NP seeded), requests (submit/approve/reject/cancel), allocations per year
- Statutory filings summary + remit (EPF, ETF, PAYE)
- **Salary revisions with auto-arrears** — HR records a back-dated rate change, the live basic updates immediately, the next payroll run auto-computes (new − previous) × intervening months as an ARREARS earning line (counts for EPF/ETF/PAYE); period-lock enforced on revision effective dates so you can't quietly rewrite closed months
- **Staff loan module** — apply → approve (SOD-enforced) → disburse (DR 1150 Employee loans receivable / CR bank); flat-rate amortization with installment schedule; EMIs auto-deduct as LOAN-REC on the next payroll run, atomically claimed at draft, principal and interest split on post (CR loans receivable / CR interest income); write-off moves outstanding to bad debt and waives remaining installments. Five SL-typical types (festival, salary advance, emergency, housing, vehicle) seeded per tenant with caps + defaults
- **Mid-period payroll events (pro-rata)** — mid-period joiners and leavers now earn for days actually worked. Exit workflow (`POST /employees/:id/exit`) stamps `exit_date` + `last_working_day` + notice period and flips status to resigned/terminated/retired/deceased. Probation confirmation (`POST /employees/:id/confirm-probation`) promotes status to active. Payroll compute expands eligibility to include in-period leavers, computes `daysWorked / daysInPeriod` and scales every earning by the ratio (basic, from_basic, percent_of_basic, fixed earnings); deductions stay unscaled (fixed obligations). Payslip shows an "N/M days" chip so HR can explain the smaller basic at a glance
- **Bonus schemes library** — tenant-configured bonus programs (Avurudu, Christmas, 13th-month, performance) with four formula types: `flat_amount` (cents), `percent_of_basic` (bps), `days_of_basic` (e.g. 15 days = half-month), or `manual` (HR enters per employee). Per-scheme eligibility (minimum tenure, employment types, statuses) + tax flags (counts for EPF / ETF / PAYE). Bulk bonus run workflow draft → posted → void: creating a draft filters eligible employees and seeds per-person amounts from the formula; HR can adjust any line before post; post books the journal (DR Salaries & wages / DR EPF+ETF employer / CR EPF+ETF payable / CR PAYE / CR Salaries payable) reusing the sl-tax compute engine for consistency with regular payroll; void reverses the entry. Four SL-typical schemes (AVURUDU, CHRISTMAS, 13TH_MONTH, PERFORMANCE) seeded at tenant signup
- **Employee expense claims** — five-state lifecycle (draft → submitted → approved | rejected → paid | void) for reimbursable out-of-pocket employee spend (travel, meals, fuel, communication, misc seeded as defaults; tenants can add more). Each claim links to a category that maps to a GL expense account (CoA 5210 / 5220 / 5230 / 5240 / 5290 seeded, `account_subtype='reimbursement'`). Two disbursement paths chosen at claim time: **direct** posts DR category expense / CR bank at approve-and-pay time; **payroll** leaves the row `approved` for the next payroll run to atomically claim via `applied_in_run_id` (same pattern as staff-loan EMIs and bonus scheme runs — column plumbing is in place, payroll-compute integration is a mechanical follow-up). SOD enforced: submitter ≠ approver, submitter ≠ rejecter. Category snapshot on submit (`category_name`, `expense_account_id`, `is_taxable`) so re-mapping the category later doesn't rewrite history for already-paid claims. Rejected claims can be edited (resets to draft) and re-submitted. Receipt-file attachments and per-category approval caps explicitly deferred to v2. Separate `EXP-YYYY-NNNN` number series via `nextDocumentNumber`, allocated on first submit (PR #60)
- **Employee notification preferences** — per-user opt-out for notification kinds (invoice.posted, payment.recorded, journal.pending, low_stock, cheque.bounced, loan.applied, leave.submitted, etc.). `notification_preferences (tenant_id, user_id, kind, enabled)` with "absence of row = enabled" semantics so existing users keep receiving everything until they explicitly opt out. `/app/settings/notifications` lists all emitted kinds with a per-kind toggle. `emitNotification()` checks prefs before inserting directed notifications; broadcasts still bypass (e.g. "posting lock active" doesn't get muted by a stray preference row). Daily-rollup digest window is a follow-up (see backlog) (PR #63)
- **Approval workflow designer (storage)** — tenant admin UI at `/app/settings/approvals` to author linear approval chains per document type (`journal_entry`, `expense_claim`, `bill`, `purchase_order`, `bonus_run`, `final_settlement`). Each policy carries a JSON `trigger_rule` (`{minAmountCents}` or `{submitters: [userIds]}`, composable via `{and: […]}`) and an ordered `steps[]` array where each step is `{approvers: [{kind: "role"|"user", id}], anyOf: bool}`. v1 is designer + storage only — actual routing into domain transitions is a follow-up (see backlog); existing per-domain approval columns (journal_entries.status = pending_approval, expense_claims approved_by_user_id, etc.) keep working unchanged, so nothing regresses (PR #63)
- **Custom roles + user role assignment** — `roles (tenant_id, name, permissions jsonb, is_system)` + `user_roles (user_id, role_id)` many-to-many. Permissions is a flat string→bool map (`{"invoices.create": true, "bills.void": false, ...}`). Five system templates seeded per tenant at bootstrap: Owner, Admin, Accountant, Sales, Read-only — cloneable + editable but `is_system=true` marks them. `/app/settings/roles` lists roles, lets admins create/clone/edit, and assign one or more roles per team member. `users.is_owner` stays the super-admin bypass — owners can't have permissions stripped beneath them (PR #63)
- **Role enforcement middleware** — `requirePermission(req, reply, "invoices.post")` in `apps/api/src/lib/permissions.ts` gates the high-leverage write routes: posts/voids for invoices/bills/credit+debit notes, journal-entry post/approve/reject, period close/reopen/close-year, payroll/bonus/final-settlement post, settings PATCH, approval-policy CRUD, role CRUD + assignments. Three pass rules: (1) `users.is_owner=true` bypass, (2) tenant has zero `user_roles` rows → enforcement dormant (deploy-safe — existing tenants keep working until an admin assigns the first role), (3) caller holds a role whose permissions JSON grants the key (union across roles). Creates + reads stay at "authenticated in tenant" for v1 — real-world SoD is almost always about posting, not creating. `GET /auth/me` now returns `permissions: {isOwner, enforcementActive, granted}` so the web can hide buttons it knows will 403; `hasPermission(perms, key)` client helper in `apps/web/lib/api.ts` mirrors the server decision (PR #64)
- **Final settlement worksheet** — full gross-to-net exit calculation for resigned/terminated/retired employees. Compute pro-rata salary for days worked in settlement month, unused paid-leave encashment (basic × days ÷ salaryDaysPerMonth), gratuity per SL Payment of Gratuity Act (14 days basic × completed years, min 5 years; excluded from EPF/ETF/PAYE per v1 simplification), notice pay-in-lieu (terminated without serving) or notice shortfall (resigned mid-notice), outstanding loan recovery in full (principal + accrued interest), and final EPF employee/employer + ETF + PAYE on eligible portion. Workflow draft → approved → posted (GL): post books the journal (DR Salaries & wages / DR Gratuity expense / DR EPF+ETF employer / CR EPF+ETF payable / CR PAYE / CR Loans receivable / CR Interest income / CR Gratuity payable / CR Salaries payable) and waives all pending loan schedule rows with `closed_reason='final_settlement'`. Settlement letter **PDF** with earnings/deductions breakdown, declaration clause, and dual signature blocks. Document number FS-YYYY-NNNN via the number-series pipeline. Gratuity COA (6003 Gratuity expense + 2250 Gratuity payable) seeded per tenant. Partial unique index `(tenant_id, employee_id) WHERE status <> 'cancelled'` enforces one active settlement per employee

### Reports
- Trial balance, P&L (with compare), balance sheet, general ledger, VAT return, cash flow
- AR aging detail (grouped by customer)
- AP aging detail (grouped by supplier)
- 3-way matching (PO ↔ GRN ↔ bill variance report)

---

## 🛠️ Active Backlog (ranked)

Each item has a spec reference, one-sentence description, and rough sizing (**S** = half-day, **M** = 1–2 days, **L** = 3+ days).

### Must-have (compliance + core workflows)

🎉 **All must-haves are now shipped.** The compliance foundation is complete — period lock, WHT, opening balance, credit enforcement, bad debt + VAT relief, and JE approvals. Previously tracked here, now in the shipped list above:

- **Period lock + year-end close** (PR #32)
- **WHT auto-derivation & remittance** (PR #33)
- **Opening balance upload** (PR #34)
- **Customer credit enforcement** (PR #35)
- **Bad debt write-off with VAT relief** (PR #36)
- **Journal entry approval workflow** (PR #37)

### Should-have (convenience/polish)

🎉 **All original should-haves shipped + #42 role enforcement closed in PR #64 + #44 FX revaluation closed in PR #65.** Two deferred follow-ups remain — the shipped work is usable as-is, these close the remaining edges.

| # | Feature | Spec | What it does | Size |
|---|---|---|---|---|
| 43 | Approval engine wiring | tenant-admin §7 | Route documents (journal entries, expense claims, bills, POs, bonus runs, final settlements) through the `approval_policies` designed in #26 at submit time. Today the designer persists policies but nothing consumes them — existing per-domain `pending_approval` columns keep working but don't know about the new engine. Follow-up to PR #63. | L |
| 45 | Notification digest windows | tenant-admin §10.2 | Opt in to daily / weekly rollup of kinds where per-event noise is too much (low_stock summary, pending-approval summary). v1 shipped per-kind on/off — digest is orthogonal. Follow-up to PR #63. | M |

### Nice-to-have (advanced/niche)

| # | Feature | Spec | What it does | Size |
|---|---|---|---|---|
| 28 | POS screen | sell §5 | Hardware-integrated cash-sale register, offline capable, shift Z-report. | L |
| 29 | Commission engine | sell §10 | Tiered rules, on-collection variant, payroll integration. | L |
| 30 | Purchase requisition | buy §3 | PR creation → approval → convert to PO (tenant-toggle). | M |
| 31 | Customer portal | sell §14 | Email+OTP login, view invoices/statements, pay online. | L |
| 32 | Document attachments | sell §20, buy §21 | Multiple files per transaction, S3-backed, 7-year retention. | M |
| 33 | Document templates builder | sell §19, buy §20, tenant-admin §4 | Drag-drop PDF layout per tenant, multi-language. | L |
| 34 | Item batch / serial / expiry tracking | inventory §2.7 | Per-item toggle, FIFO by batch, recall capability. | L |
| 35 | Kit / bundle items | inventory §9 | Sale consumes components, bundle priced < sum of components. | M |
| 36 | Inventory category hierarchy | inventory §2.4 | Unlimited-depth tree with inherited defaults. | S |
| 37 | ~~Stale cheque auto-flag~~ | business-tenant-layer2 §6.2 | **Shipped in PR #66.** Daily cron flips active cheques past their 6-month `stale_at` date to `status='stale'` with per-cheque notifications. Issued-direction cheques get a Reissue action that mints a new cheque linked via `replaced_by_cheque_id` (preserves the original JE; AP stays the same). Manual `POST /cheques/flag-stale` for ad-hoc triggers. | ~~S~~ |
| 38 | Petty cash float | business-tenant-layer2 §7 | Per-branch ceiling, top-up workflow, EOD reconciliation. | M |
| 39 | Attendance capture | business-tenant-layer2 §5 | QR / biometric file import / geofence+photo / manual muster. | M |
| 40 | Dual depreciation (book vs tax) | accounting §8 | Parallel schedules for tax filing alongside management books. | M |
| 41 | ~~Credit note PDF + debit note PDF~~ | — | **Shipped in PR #46.** Bill PDF shipped in PR #45. Document PDF set is now complete: invoice / bill / credit note / debit note / delivery note / GRN / PO / quotation / stock transfer / payslip. | ~~S each~~ |

---

## Platform/Admin (separate from tenant app)

Specified but out of scope for the main tenant app:

- **Super Admin Layer 1 console** (`super-admin-layer1-spec.md`) — platform-owner surface: tenant directory, billing ops, impersonation (consent-gated), revenue analytics.
- **Pricing plan engine** (`pricing-plan-architecture-spec.md`) — tier matrix, feature gating, add-ons, dunning.
- **Landing page** (`landing-page-design-spec.md`) — marketing site.

These are their own workstreams — track separately from this roadmap.

---

## Build cadence

One PR = one feature. Ship, merge, move on. Batched PRs allowed when features are clearly related (e.g. DN + PO PDFs were batched because they follow the same pattern).

Current recommendation: compliance + convenience + role enforcement + FX revaluation all done. Nothing user-visible is a hard gap. Next work falls in two camps:

1. **Close the remaining loops** — two deferred follow-ups (#43, #45). **#45 notification digest windows** is M-sized and independent — daily / weekly rollup opt-ins that ride alongside the per-kind prefs shipped in PR #63. **#43 approval engine wiring** is the architecturally heavier option (L) — route documents through the policies stored by #26 at submit time, replacing the existing per-domain `pending_approval` columns.
2. **Pick from Nice-to-have** — the S-sized ones are cheap wins: **#37 stale cheque auto-flag** (SL banking compliance — 6-month presentment rule) and **#36 inventory category hierarchy** (organization for tenants with >50 SKUs).

Leaning toward **#37 stale cheque next** — S-sized, real SL compliance check that tenants with any cheque volume will hit, and the cheque 9-state lifecycle we already have makes the addition a small schema + daily-job delta rather than a new subsystem. Larger architectural work (#43 approval engine) is still on the table but #37 keeps momentum while covering a compliance edge.
