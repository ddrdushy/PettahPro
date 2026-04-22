# PettahPro Build Roadmap

Live tracker of what's shipped, what's next, and what's backlog — cross-checked against the 23 spec files in `/docs/` (see [`_summary.md`](./_summary.md) for a per-file digest).

**Roadmap says what's shipped. [`_status.md`](./_status.md) says what's broken, fragile, or at-risk right now.** Read both before picking up work.

Last updated: 2026-04-22 after shipping #11b final settlement worksheet + roadmap audit. **All must-haves shipped.** Eight should-haves (stock count, proforma invoices, recurring bills, recurring journals, number series, audit log, customer statement email, final settlement) now in the shipped list.

---

## ✅ Shipped (PRs #1 – #57)

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

### Buy
- Suppliers (CRUD, statements)
- Purchase orders (CRUD, send/acknowledge/cancel/convert-to-bill, **PDF**)
- Goods received notes / GRNs (CRUD, receive, cancel, links to PO and bill)
- Bills (CRUD, post, void, **PDF** — draft banner on unposted bills so AP approvers can preview before posting)
- Debit notes (CRUD, post, **PDF** with draft banner — PR #46)
- Supplier payments (cash/cheque/bank-transfer, cheque lifecycle)
- **Recurring bill templates** — bills equivalent of recurring invoices. Template captures supplier + items + amount + frequency (weekly / monthly / quarterly / annual) + start/end dates + auto-post-vs-review flag. Hourly BullMQ cron generates drafts; review-queue variant lands in the bills list as draft, auto-post variant posts directly. Pause / resume / edit / end-date supported; variable-amount templates keep the structure fixed and prompt for the per-cycle amount (PR #51)

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
- **Period lock** (soft_closed / closed) enforced at `postJournal` choke point; month-end and year-end close with P&L→retained-earnings transfer; reopen audit trail
- **WHT** withheld at supplier-payment time; `/app/accounting/wht` dashboard with per-month balance, by-supplier totals, remittance history, and remit-to-IRD action
- **Opening balance** import for onboarding tenants from BUSY/Tally (TB grid with paste-CSV + one-shot posting guardrails)
- **Customer credit enforcement** — credit_hold hard block + credit_limit soft block at invoice post; auto-flag on 2+ bounced cheques
- **Bad debt write-off with VAT relief** — give up on collection cleanly, claim SL VAT Act §26 relief on 12+ month-old invoices, reverse if they pay later; `/app/reports/bad-debts` tallies it
- **Journal entry approval workflow** — tenant-set threshold above which manual JEs go to a drafts queue for second-pair-of-eyes approval; SOD-enforced (approver ≠ creator); `/app/journals/approvals` pending + recent queue
- **Recurring journal templates** — balanced-entry templates with variable prompts (amount placeholders resolved per cycle); auto-post variant books directly, review-queue variant lands in `/app/recurring-journals` for HR/accountant to adjust before posting. Per-template frequency (monthly / quarterly / annual) + next-run date; hourly cron fires due templates; every generated entry carries template provenance for audit (PR #52)
- **Number series config** — customise per-document prefix templates with token substitution (`INV-{YYYY}-{####}`, `FS-{YYYY}-{####}`, etc.) and reset period (yearly / monthly / continuous). Live preview before save; tenant-level override of the default per-kind template via `document_sequences.template`; default-template trigger on insert keeps existing kinds backfilled. Every callsite allocates via `nextDocumentNumber(tx, kind)` so changes here flow through uniformly (PR #53)
- **Audit log viewer** — append-only `audit_events` stream covering identity (login/logout), posting (journal.post/void, approve/reject), period (close/reopen/close_year), void (invoice/bill/payment), AR hygiene (bad_debt writeoff/reverse, credit hold/release), HR (exit, confirm probation, payroll post/void, final-settlement lifecycle), and settings (update, number_series.update) events. Viewer at `/app/audit-log` with filter-by-kind, date range, actor, and deep-link back to the affected entity (journal_entry / invoice / bill / employee / period / customer). `recordAuditEvent` never throws — a failed audit write doesn't break the primary action (PR #54)

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

Numbers left as gaps below = shipped (see the bullets above). Keeps the "by number basis" picking order stable across audits.

| # | Feature | Spec | What it does | Size |
|---|---|---|---|---|
| 9 | Landed cost allocation | buy §5.4, inventory §5.4 | Freight/insurance/customs captured at GRN, allocated to item cost. | L |
| 14 | Expense claims | payroll §8 | Employee submit with receipt → manager approve → bundle with payroll or pay direct. | M |
| 16 | Batch / consolidated invoicing | sell §2.5 | Multi-customer batch run; roll up multiple DNs into one invoice per customer. | M |
| 17 | Multi-currency FX on sales | sell §17 | Rate capture per invoice/bill, LKR-for-ledger + foreign-for-customer. | M |
| 18 | Multi-currency bank accounts | accounting §4.1 | USD/EUR/GBP accounts with LKR reporting conversion. | M |
| 20 | Supplier statement reconciliation | buy §13.2 | Parse supplier-sent statement vs our bill record, flag differences. | M |
| 25 | Notification preferences (user-level) | tenant-admin §10 | Per-user channel + event opt-in, quiet hours. | M |
| 26 | Approval workflow designer | tenant-admin §7 | Visual multi-step chains with branching conditions. | L |
| 27 | Custom roles / granular permissions | tenant-admin §3.4 | Per-action permission matrix, Easy templates + Advanced granular. | M |

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
| 37 | Stale cheque auto-flag | business-tenant-layer2 §6.2 | 6-month-old cheques auto-flag + offer reissue (SL banking law). | S |
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

Current recommendation: compliance foundation is complete and the should-have convenience layer is thinning out — 8 of the original should-haves shipped, leaving 9. No hard compliance gaps. Pick from should-haves based on what real users start asking for. Top-of-mind candidates: **#9 landed cost allocation** (freight/insurance at GRN, missing piece of the buy-to-inventory costing story), **#14 expense claims** (completes the HR/payroll reimbursement loop), **#17/18 multi-currency** (exporters, the one remaining hole for non-LKR business), or **#20 supplier statement reconciliation** (AP hygiene — we have the supplier statement read-only but not the compare-to-statement flow).
