# PettahPro Build Roadmap

Live tracker of what's shipped, what's next, and what's backlog — cross-checked against the 23 spec files in `/docs/` (see [`_summary.md`](./_summary.md) for a per-file digest).

**Roadmap says what's shipped. [`_status.md`](./_status.md) says what's broken, fragile, or at-risk right now.** Read both before picking up work.

Last updated: 2026-04-22 after PR #44. **All must-haves shipped.**

---

## ✅ Shipped (PRs #1 – #44)

### Platform foundation
- Multi-tenant Postgres with RLS (`current_tenant_id()` + `SET LOCAL app.tenant_id`)
- Auth: signup / login / logout / me / session cookies
- Branches (multi-location), warehouses (schema)
- `tenant_settings` JSONB store with `GET/PATCH /settings` (knobs: `salaryDaysPerMonth`, `stockRelieveOn`)
- Settings page replaces the old "Soon" placeholder
- BullMQ worker + Redis, hourly cron scaffold
- Notifications (header bell + red-dot badge, in-app only, routed per `refType`)
- Audit columns (created_at/updated_at, deleted_at, created_by_user_id)
- **Build status tracker** (`docs/_status.md` + PR template) — known bugs, typecheck debt baseline (43 errors frozen), fragile areas, regression log, module health; PR template forces every PR to declare modules touched + regression surface + test plan

### Sell
- Customers (CRUD, statements, aging)
- Quotations (CRUD, send/accept/reject/expired/convert, **PDF**)
- Sales orders (CRUD, confirm, cancel, convert-to-invoice)
- Delivery notes (CRUD, deliver, cancel, **PDF** with signature block, optional stock relief at deliver time)
- Invoices (CRUD, post, void, duplicate, **PDF**, stock relief at post by default)
- Recurring invoices (monthly templates, hourly BullMQ cron → draft invoices, pause/resume/generate-now)
- Credit notes (CRUD, post)
- Customer payments (cash/cheque/bank-transfer, cheque lifecycle linkage)

### Buy
- Suppliers (CRUD, statements)
- Purchase orders (CRUD, send/acknowledge/cancel/convert-to-bill, **PDF**)
- Goods received notes / GRNs (CRUD, receive, cancel, links to PO and bill)
- Bills (CRUD, post, void)
- Debit notes (CRUD, post)
- Supplier payments (cash/cheque/bank-transfer, cheque lifecycle)

### Inventory
- Items (CRUD, WAVG valuation, reorder_point)
- Stock on-hand + stock ledger per item (inbound in-transit qty surfaced on the on-hand page)
- Low-stock report + crossing notifications
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

| # | Feature | Spec | What it does | Size |
|---|---|---|---|---|
| 8 | Stock count / cycle count | inventory §4.4 | Blind count with tiered auto-post vs approval (1% auto, >1% approve). | M |
| 9 | Landed cost allocation | buy §5.4, inventory §5.4 | Freight/insurance/customs captured at GRN, allocated to item cost. | L |
| 11b | Final settlement worksheet | payroll §14.2 | Leave encashment, loan recovery on exit, gratuity, notice pay-in-lieu, "exit run" document. Mid-period pro-rata shipped in PR #41; this is the richer settlement layer on top. | M |
| 14 | Expense claims | payroll §8 | Employee submit with receipt → manager approve → bundle with payroll or pay direct. | M |
| 15 | Proforma invoices | sell §2.5 | Advance/customs preview, convert to live invoice. | M |
| 16 | Batch / consolidated invoicing | sell §2.5 | Multi-customer batch run; roll up multiple DNs into one invoice per customer. | M |
| 17 | Multi-currency FX on sales | sell §17 | Rate capture per invoice/bill, LKR-for-ledger + foreign-for-customer. | M |
| 18 | Multi-currency bank accounts | accounting §4.1 | USD/EUR/GBP accounts with LKR reporting conversion. | M |
| 19 | Recurring expense templates | buy §11.5 | Bills equivalent of recurring invoices. | M |
| 20 | Supplier statement reconciliation | buy §13.2 | Parse supplier-sent statement vs our bill record, flag differences. | M |
| 21 | Customer statement email delivery | sell §15 | Scheduled auto-email + bulk run. | M |
| 22 | Audit log viewer | tenant-admin §11 | Who-changed-what + login + impersonation, with deep-links. | M |
| 23 | Number series config | tenant-admin §8 | Customize prefix template, reset period (monthly/yearly), live preview. | M |
| 24 | Recurring journal templates | accounting §9 | Auto-post vs review-queue, variable prompts. | M |
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
| 41 | Bill PDF + credit note PDF + debit note PDF | — | Round out the document PDF set. | S each |

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

Current recommendation: compliance foundation is complete. The remaining backlog is convenience / polish — no hard compliance gaps left. Pick from should-haves based on what real users start asking for. Top-of-mind candidates: **stock count** (blind count workflow, complements stock transfer shipped in PR #43), **proforma invoices** (pre-sale flow), **multi-currency FX on sales** (exporters), or **audit log viewer** (governance).
