# Accounting Module Spec — Multi-Tenant Accounting SaaS (Sri Lanka)

> Full specification for the Accounting module. Target market: **Sri Lanka only**. Covers double-entry ledger, Chart of Accounts, tax engine, reports, period management, fixed assets, and integrations with other modules.

---

## 1. Scope & Context

### Non-negotiables
- **Full system, not MVP** — every feature a serious SL accounting product needs
- Single currency reporting: **LKR**
- FX supported on purchases AND sales (USD + others), tracked separately; realized on settlement, unrealized at period-end per SLFRS 21
- **No live bank integrations** — SL banks unreliable/closed. Upload-based reconciliation only.
- Operates within the Layer 2 (Business Tenant) governance from the parent spec

### What this module does
- Maintains the double-entry general ledger for every tenant
- Auto-generates journal entries from Sales, Purchase, Payment, Payroll, Stock movements
- Computes taxes per SL framework (VAT, SSCL, stamp duty, WHT)
- Produces financial statements, management reports, and tax returns
- Governs period close, year-end close, and audit trail

---

## 2. Core Architecture

### 2.1 Double-entry engine with dual UI
- **Engine**: strict double-entry. Every transaction = balanced debits + credits. Trial Balance must balance at all times.
- **UI Layer — Easy Mode** (default for Cashier, Sales, Stock Keeper, HR, Owners without accounting background): shows natural actions — *"record a sale"*, *"pay a bill"*, *"receive payment"*, *"transfer cash"*. Zero journal/ledger terminology.
- **UI Layer — Accountant Mode** (default for Accountant, Owners with accounting background): exposes full journal entry UI, trial balance, ledger inquiry, raw posting.
- Same engine — the two UIs are different presentations over the same data.

### 2.2 Chart of Accounts (COA)
- **Guided setup**: industry-specific COA templates (Textile Wholesale / Pharmacy / Grocery / Clinic / Salon / Restaurant / General SME) pre-loaded on tenant signup
- **System-required accounts** cannot be deleted or merged:
    - Cash, Bank (at least one), Petty Cash
    - Accounts Receivable (control), Accounts Payable (control)
    - VAT Input, VAT Output, VAT Control
    - Retained Earnings, Current Year Earnings
    - Customer Advances (liability), Supplier Advances (asset)
    - Bank-in-Transit (cheque clearing)
    - FX Gain/Loss (Realized, Unrealized)
    - Inventory control, COGS control
    - Bad Debt Expense, Bad Debt Recovery
- **Customization**: tenant can add, rename, merge their own accounts. Renames logged.
- **Groups**: 5 top-level groups — Assets / Liabilities / Equity / Income / Expenses. Sub-groups configurable.
- **Account code scheme**: hierarchical (1xxx Assets, 2xxx Liabilities, etc.), tenant-configurable prefix length.

### 2.3 Tax Engine (SL framework)

All SL tax rules baked in. Tenant configures which apply to their business.

| Tax | Current rate | How applied |
|---|---|---|
| **VAT** | 18% | Per-item or per-invoice tax code; auto-computed; maintains Input/Output registers |
| **SSCL** | 2.5% | Applies to certain B2B services/supplies; per-item toggle |
| **Stamp Duty** | Various (LKR 25 per receipt over LKR 25,000 typical) | Per-document rule, auto-added on eligible transactions |
| **WHT (Withholding)** | Varies (5% rent, 5–14% services) | Reverse charge — tenant deducts when paying supplier; WHT certificate generation |
| **PAYE** | Slab-based | Handled in Payroll module; posts to accounting |

Tenant registration configuration:
- VAT registered: yes/no (if no, hide VAT UI entirely)
- VAT filing frequency: monthly / quarterly
- SSCL applicable: yes/no
- WHT deductor: yes/no (are you the paying party who withholds?)
- PAYE employer: yes/no

**Rate changes** (e.g. govt changes VAT 18% → 15%): platform-level config. When pushed, all tenants update automatically. Historical transactions remain at their original rate (effective-dated rates).

**VAT automation scope:**
- Compute VAT on every invoice/bill based on item tax codes
- Maintain VAT Input/Output ledgers automatically
- Generate VAT return form data (boxes filled, ready to upload to IRD portal)
- Direct API filing to IRD — out of scope (IRD API not reliable/open enough)

---

## 3. Transaction Types & Journal Generation

Every user action in the product becomes a journal entry. The mapping is deterministic:

| User action (Easy Mode) | Journal impact |
|---|---|
| Record sale (invoice) | DR Customer / CR Sales Revenue + CR VAT Output. Perpetual COGS: DR COGS / CR Inventory. |
| Record credit note | Reverse of above |
| Receive payment — cash | DR Cash / CR Customer |
| Receive payment — cheque | DR Cheque-in-hand / CR Customer (then state-driven entries on deposit, clear, or bounce — see Cheque module) |
| Pay supplier bill | DR AP / CR Bank (or Cash/Cheque) |
| Record bill (purchase) | DR Expense or Inventory / CR Supplier + DR VAT Input |
| Purchase return / debit note | Reverse of bill |
| Stock transfer (intra-branch) | Stock ledger only; no GL |
| Stock adjustment (write-off, damage) | DR Stock Write-off / CR Inventory |
| Inter-account transfer | DR destination / CR source |
| Petty cash expense | DR Expense / CR Petty Cash |
| Payroll run | DR Salaries Expense / CR Salary Payable + CR EPF/ETF/PAYE Payable |
| Depreciation (auto-monthly) | DR Depreciation Expense / CR Accumulated Depreciation |
| Bad debt write-off | DR Bad Debt Expense / CR Customer + VAT bad-debt relief if applicable |
| Bad debt recovery | DR Bank / CR Bad Debt Recovery |
| FX revaluation (period-end) | DR/CR Unrealized FX Gain/Loss (reversed next period) |

Journal generation happens automatically — the Easy Mode user never sees it. Accountant Mode can view/drill the generated journals.

---

## 4. Multi-Currency & FX

### 4.1 Scope
- Reporting currency: **LKR** (fixed)
- Foreign currencies allowed on the **buy side**: Bills, Purchase Orders, Supplier master, supplier payments (full support).
- Foreign currencies allowed on the **sell side** (light FX-on-Sales support — aligned with `sell-module-spec.md §17`): Quotations, Sales Orders, Invoices, Credit Notes, Customer master, customer receipts. Intended primarily for exporters and hybrid USD-pricing scenarios common in SL tourism, BPO, and freight tenants.
- Reporting remains LKR-only. All foreign-currency amounts stored alongside LKR equivalents at transaction-date rate.
- Multi-currency bank accounts supported (one currency per bank account; separate accounts for separate currencies).

### 4.2 Exchange rates
- `ExchangeRate` table with effective-dated rates per currency pair (USD→LKR, EUR→LKR, INR→LKR, GBP→LKR, AUD→LKR, etc.) and rate type (spot / monthly / year-end / custom).
- Admin can set rate manually OR auto-import from CBSL daily (Phase 2).
- Rate captured at transaction date; FX gain/loss emerges on settlement date (receipt for sales, payment for purchases).

### 4.3 Realized FX gain/loss
Triggered on **settlement of a foreign-currency transaction** (symmetric for bills and invoices):
- **Bill paid**: bill booked at rate X (bill date), payment made at rate Y (payment date). LKR difference posted to FX Gain or FX Loss.
- **Invoice received against**: invoice booked at rate X (invoice date), customer receipt at rate Y (receipt date). LKR difference posted to FX Gain or FX Loss. Partial receipts compute proportional realized gain/loss per allocation.

### 4.4 Unrealized FX (period-end revaluation)
- At period-end (monthly or FY-end, tenant-configurable), system revalues **all open foreign-currency balances**: open bills, open invoices, open advances (both sides), and foreign-currency bank account balances.
- Posts single unrealized gain/loss entry per period (one per currency optional).
- **Reverses on 1st of next period** (standard SLFRS 21 treatment).

### 4.5 Display
- Supplier ledger and customer ledger: balance shown in original currency + LKR-converted.
- All reports: LKR only (with currency breakdown available as optional supplementary schedule).
- Bill PDF and Invoice PDF: original currency as primary amount; LKR in parenthesis when configured.
- Multi-currency customer statement supports single-currency or consolidated LKR view (tenant toggle per customer).

---

## 5. Dimensional Accounting — Tag

### 5.1 Model
- **One optional Tag per transaction line**
- Tenant defines their own tag master (e.g. *"Avurudu 2026"*, *"Colombo delivery route"*, *"Salesman Saleem"*, *"Retail channel"*)
- Tag applied at transaction entry; editable post-posting (non-financial field)

### 5.2 Reporting
- P&L by Tag (slice revenue + expenses by tag)
- Comparative tags
- Tag summary dashboard on request

Deliberately lightweight — not a substitute for enterprise cost-center accounting.

---

## 6. Financial Year & Period Management

### 6.1 FY configuration
- Fully user-configurable start month (any of 12)
- Default: April 1 – March 31 (SL standard)
- Mid-stream FY change requires Owner action + audit log entry + reason

### 6.2 Period lock — Two-tier
- **Soft lock** — posted but not closed: all users can see; transactions editable with normal permissions
- **Hard lock** — period closed:
    - Accountant/Owner can override with reason logged → audit trail entry
    - All other roles: hard blocked; must use reversal entries in current period
- Default monthly lock on completion of VAT return

### 6.3 Year-end close process (5 steps)

**Step 1 — Closing checks (system-enforced checklist)**
- All bank accounts reconciled
- All VAT returns filed
- All draft transactions posted or discarded
- Aging reports reviewed
- Stock count completed, variance posted
- Approval queue cleared
- Red/green status shown; mandatory items block close

**Step 2 — Adjustment entries (wizard-guided)**
- Depreciation (auto-generated from Fixed Asset register)
- Accruals (utility expenses accrued, income earned not invoiced)
- Prepayments (insurance, rent paid in advance — amortize over period)
- Provisions (bad debts, warranty, gratuity if applicable)
- Stock revaluation (if needed)
- Entries land in *"Adjustment journal"* distinct from regular transactions

**Step 3 — P&L transfer to Retained Earnings**
- System auto-computes net profit/loss
- Transfers to Retained Earnings account
- All income/expense accounts zeroed for new year
- Current Year Earnings account reset

**Step 4 — Lock the year**
- Full year becomes immutable (financial fields)
- New FY opens with Balance Sheet items as opening balances
- 2-year comparative reports now active

**Step 5 — Reopen exception**
- Owner + Accountant can reopen closed year with explicit reason
- **Always requires approval, no threshold override**
- Reopening logged immutably
- Forced re-close required afterward

### 6.4 Comparative reporting
- **2-year max**: current FY vs prior FY
- No 5-year trend dashboards (complexity/noise for SME users)

---

## 7. Opening Balances

### 7.1 Capture flow
New tenant on signup:
- Upload full **Trial Balance** as Excel/CSV (all account balances as of start date). Must balance (DR = CR) or import rejected.
- Per-module opening balance screens:
    - Debtors (customer-wise with optional invoice-level detail)
    - Creditors (supplier-wise with optional bill-level detail)
    - Stock (item-wise per warehouse with costs)
    - Fixed Assets (with accumulated depreciation, purchase date, remaining life)
    - Bank accounts (with unreconciled items)
    - Cheques on hand (post-dated + issued, states, dates)
- System computes TB from entered balances → cross-checks against uploaded TB → variance report before commit

### 7.2 Mid-year onboarding — two paths

**Path A — Cutover TB only**
- Enter TB as of signup date
- System treats signup date as fiscal start for data purposes
- Prior-year comparative reports empty until next FY

**Path B — Full historical import**
- Migrate historical transactions via migration flow (BUSY / Tally / QB / CSV)
- Preserves YTD continuity and comparative reports within current FY

**Suggestion logic at signup:**
- < 3 months since FY start → suggest Path B (full import)
- > 6 months since FY start → suggest Path A (cutover only)
- 3–6 months → let user choose

### 7.3 Immutability
- Opening balances editable during "onboarding" phase
- Once first live transaction posts → opening balances become frozen
- Post-freeze corrections via reversal entries only (with reason logged)

---

## 8. Fixed Assets & Depreciation

### 8.1 Asset master
- Asset code, description, category (Vehicle / Computer / Furniture / Machinery / Building / Land / Software / Other)
- Purchase date, cost, useful life (years), salvage value
- Location (branch + warehouse), assigned to (user/department)
- Linked to purchase bill (for audit)
- Photo/document attachments

### 8.2 Depreciation methods per category
- **Straight Line Method (SLM)** — most common
- **Written Down Value (WDV)** — accelerated, common for SL tax
- **Sum-of-Years-Digits (SOYD)** — rare but supported

### 8.3 Book vs Tax depreciation (both tracked in parallel)
- **Book depreciation** — tenant's accounting policy per SLFRS
- **Tax depreciation** — SL IRD rate schedule (often differs from book)
- System maintains both running balances
- Reports show both side-by-side
- CA uses tax depreciation for tax computation

### 8.4 Lifecycle events
- **Acquisition** — from purchase bill or manual entry
- **Additions/improvements** — capitalizable upgrades added to book value
- **Revaluation** — fair value adjustment, posts to Revaluation Reserve (SLFRS allowed)
- **Disposal** — sale, scrap, donation — triggers gain/loss calculation and posting
- **Impairment** — unlikely for SMEs but supported

### 8.5 Automatic depreciation journal
- Posts on configurable day (1st of month or month-end)
- User doesn't intervene
- Visible in Adjustment journal

### 8.6 Reports
- Fixed Asset Register (full list with status)
- Depreciation schedule (book + tax, parallel columns)
- Disposal register with gain/loss
- Asset movement log

---

## 9. Recurring Journals

### 9.1 Template-driven
- Accountant creates template: name, DR account, CR account, amount (fixed OR variable-prompt), frequency (daily/weekly/monthly/quarterly/annual), start date, end date (or indefinite)
- Tenant-defined templates — no platform-shipped defaults (too opinionated)

### 9.2 Per-template toggle
- **Auto-post mode** — system posts the journal on scheduled date without intervention (for fixed-amount recurring like rent)
- **Review queue mode** — system creates draft in queue; accountant reviews, edits amount if variable, approves to post (for utilities, variable subscriptions)

### 9.3 Controls
- Pause / resume template
- Edit template (future runs only; past posts immutable)
- End template (stops future posts, no retroactive reversal)
- Template history report (all past runs, amounts, dates, who reviewed/posted)

---

## 10. Advances & Deposits

### 10.1 Customer advance received
- Cash/bank in, no invoice yet
- Journal: DR Bank / CR Customer Advances (liability)
- Customer ledger shows credit balance
- When invoice raised: prompt *"Customer has LKR X advance, apply?"* → applies advance first

### 10.2 Supplier deposit paid
- Mirror of above — DR Supplier Advances (asset) / CR Bank
- Auto-applied when bill booked

### 10.3 Reports
- Advance ledger per party with aging
- Advances remaining to apply (open advances)
- Advances report filterable by customer/supplier/date

### 10.4 Lifecycle
- **Forfeiture** (uncommon): if customer advance unclaimed after N days, tenant can manually write off to income (with reason)
- **Refund**: if advance is returned to customer, standard payment entry reverses the advance

---

## 11. Bad Debt & Recovery

### 11.1 Write-off flow
- User (Accountant/Owner) opens customer → *"Write off balance"* action
- Reason code required: Bankruptcy / Dispute settled / Aged beyond recovery / Legal loss / Other
- Amount: full or partial
- Journal: DR Bad Debt Expense / CR Customer Receivable

### 11.2 VAT bad-debt relief
- Automatically computed on write-off (per SL VAT Act, relief available on debts > 12 months old subject to conditions)
- Filed in next VAT return automatically
- Visible in VAT Output register as adjustment

### 11.3 Customer flagging
- Written-off customer marked visually in UI
- Future invoices to them show risk warning
- Credit limit auto-set to zero (integrates with Customer Credit Limits module)

### 11.4 Recovery
- If customer later pays: reverse write-off + post Bad Debt Recovery entry
- VAT bad-debt relief reversed in next VAT return

### 11.5 Reports
- Written-off ledger with aging + reason codes
- Recovery log

---

## 12. Budgeting (minimal)

### 12.1 Scope
Deliberately lightweight — rarely used by SL SMEs.

- **Per-account per-month budgets** (single version, no "Original vs Revised")
- **CSV upload** supported for bulk entry
- **Actual vs Budget report** with variance column (absolute + %)
- Color-coded variance (red if unfavorable)

### 12.2 Deferred (not building now)
- Budget versions (Original, Revised, Revised2)
- Budget alerts (80% threshold notifications)
- Forecast rollup (projected full-year)
- Per-branch/per-tag budgets

If demand emerges, these can be added later.

---

## 13. Bank Reconciliation

### 13.1 Upload-based (primary method)
- Accountant uploads bank statement as PDF or Excel
- System (Tesseract + parser) extracts line items: date, description, amount, DR/CR
- Auto-matches against Bank ledger entries by (amount + date proximity)
- High-confidence matches auto-ticked; low-confidence flagged
- Accountant reviews unmatched items, resolves, confirms

### 13.2 Manual fallback
- Same screen offers "tick-through" mode — accountant manually matches entries
- Some accountants prefer full manual for control

### 13.3 Outcomes
- Unreconciled items after N days → flag in Accountant dashboard
- Reconciled items locked from editing
- Reconciliation report per bank per period

### 13.4 Not in scope
- Live bank feeds (SL banks unreliable/closed)
- Direct statement fetching via API
- Positive-pay files for cheque issuance (flagged as future cheque-module integration)

---

## 14. Reports Suite

Full list — all in scope.

### 14.1 Financial statements
- Trial Balance
- Profit & Loss (with 2-year comparative)
- Balance Sheet (with 2-year comparative)
- Cash Flow Statement (direct method preferred; indirect available)

### 14.2 Ledger views
- General Ledger (account-wise transactions, drilldown to source)
- Day Book (date-wise all transactions)
- Account Statement (for specific customer/supplier/account)

### 14.3 Receivables & Payables
- Debtors Aging (30/60/90/90+ day buckets, configurable)
- Creditors Aging
- Customer Statement (printable, emailable)
- Supplier Statement

### 14.4 Tax
- VAT Return (pre-filled form data, ready for IRD upload)
- VAT Input Register
- VAT Output Register
- VAT Adjustments Register (bad debt relief, credit notes)
- WHT Certificate generation (per supplier, for their tax filing)
- SSCL computation report

### 14.5 Management
- Sales by customer / item / branch / salesperson
- Purchase by supplier / item / branch
- Profitability by Tag
- Cash position dashboard
- **Custom report builder**:
    - Drag-drop field selection from any transaction type
    - Filter by date range, account, tag, branch, user
    - Group-by and sort options
    - Save as named view, share within tenant
    - Schedule email delivery (daily / weekly / monthly)

### 14.6 Management dashboards
- Owner dashboard: today's sales, cash position, top debtors, pending approvals
- Accountant dashboard: reconciliation queue, VAT draft, approval inbox, period-close status

---

## 15. Audit Trail & Immutability

### 15.1 Posted transactions
- **Financial fields immutable** post-posting: amount, account, date, tax code, currency, exchange rate
- **Non-financial fields editable** with full edit history: narration, reference, customer address, notes
- Every edit logs: user, timestamp, before/after values

### 15.2 Correction flow
- Wrong amount posted? → Create reversal entry in current period + new correct entry
- Wrong date? → Reversal + re-post on correct date
- System offers "One-click reversal" — copies original entry with signs flipped, user adjusts new entry

### 15.3 Journal audit log
- Every journal has: creator, posting user, reviewer (if approval needed), approval chain
- All visible in journal detail view

### 15.4 Sensitive actions always logged (no exception)
- Period reopening
- COA modifications
- Tax code changes
- Opening balance edits
- Bad debt write-off
- Fixed asset disposal
- Any Owner/Accountant override

---

## 16. Approval Workflows (Accounting-Specific)

### 16.1 Approval required
- Journal entries above tenant-set LKR threshold
- Period reopening (always, no threshold override)
- Tax code additions/changes
- Opening balance edits after first transaction posts

### 16.2 Not requiring approval (just logged)
- COA add/rename/merge
- Recurring journal template creation
- Dimension tag creation
- Non-financial field edits on posted transactions

### 16.3 Self-approval
- Where approver = actor (small tenant, Owner = Accountant)
- Default: auto-approve silently
- Optional per-workflow override: *"Require different approver"*

---

## 17. External Auditor / CA Access

### 17.1 Auditor role
- **View-only** preset role (already in Layer 2)
- Read-only across all accounting modules
- No journal posting rights

### 17.2 Time-bounded access
- CA gets login valid for audit window (e.g. 30 days)
- Auto-expires; renewable by Owner
- Access window logged

### 17.3 Data export (audit pack)
- One-click: *"Export audit pack for [date range]"* → ZIP containing:
    - Trial Balance as Excel
    - P&L, Balance Sheet, Cash Flow as PDF
    - General Ledger as Excel
    - VAT returns as PDF
    - All invoices/bills/receipts as PDFs in folders
    - Fixed asset register
    - Reconciliation reports
- CA downloads locally for working papers

### 17.4 Not in scope
- Audit query/response workflow (skipped — low demand, handled over email/WhatsApp)
- CA sign-off that freezes audited period (skipped — handled via period-lock override instead)

---

## 18. Data Model — Accounting-specific entities

Additions to Layer 2 data model:

```
Tenant
  ├── ChartOfAccounts (1:n)
  │     ├── AccountGroup (5 fixed top-level)
  │     └── AccountRenameLog (1:n)
  ├── TaxCodes (1:n: VAT rates, SSCL, Stamp, WHT)
  │     └── TaxRateHistory (effective-dated)
  ├── TaxRegistration (1:1 per tenant: VAT#, SSCL flag, WHT deductor flag, PAYE employer flag)
  ├── Journal (1:n)
  │     ├── JournalLine (n:n with Account, Tag, Transaction)
  │     ├── JournalSourceRef (linked source: Invoice, Bill, Payment, etc.)
  │     └── JournalAuditLog (post-posting edits to non-financial fields)
  ├── TagMaster (1:n, tenant-defined labels)
  ├── ExchangeRate (effective-dated per currency pair)
  ├── FXRevaluationLog (1:n, per period)
  ├── FiscalPeriod (1:n, with lock status + closure audit)
  ├── OpeningBalance (1:1 per tenant, frozen post-first-txn)
  ├── FixedAsset (1:n)
  │     ├── AssetDepreciationSchedule (book + tax parallel)
  │     ├── AssetLifecycleEvent (acquisition, addition, revaluation, disposal, impairment)
  │     └── AssetDisposalGainLoss
  ├── RecurringJournalTemplate (1:n)
  │     └── RecurringJournalRun (1:n, auto-posted or reviewed)
  ├── CustomerAdvance / SupplierAdvance (control accounts + allocation tracking)
  ├── BadDebtWriteOff (1:n with reason codes)
  ├── BadDebtRecovery (1:n, reverses writeoff)
  ├── Budget (1:1 per account per month, minimal)
  ├── BankReconciliation (1:n per statement upload)
  │     └── ReconciliationMatch (match/unmatch records)
  ├── YearEndClose (1:n per FY)
  │     ├── ClosingChecklist
  │     ├── AdjustmentJournalRun
  │     └── ReopenLog
  ├── AuditExportLog (1:n, CA audit pack downloads)
  └── VATReturn (1:n per filing period)
        ├── VATReturnLine
        └── VATBadDebtRelief
```

Postgres Row-Level Security enforces tenant isolation on every query. Financial fields constrained at DB level (immutable post-posting via trigger).

---

## 19. Integration Points with Other Modules

| Module | Integration |
|---|---|
| **Sales / Invoicing** | Every invoice auto-generates journal (DR AR, CR Revenue, CR VAT Output + DR COGS, CR Inventory) |
| **Purchase / Bills** | Every bill auto-generates journal (DR Expense/Inventory, CR AP, DR VAT Input); FX rate captured |
| **Inventory** | COGS posted in real-time on sale (perpetual); stock transfers = stock ledger only (no GL); stock adjustments post to write-off accounts |
| **Payroll** | Payroll run posts salary expense + statutory payables; attendance drives wage calc |
| **Cheque Management** | State transitions post/reverse journals (received / deposited / cleared / bounced) |
| **Petty Cash** | Expenses post to Petty Cash account + expense heads; top-up is inter-account transfer |
| **Customer Credit Limits** | Bounce count feeds write-off risk flags; auto-disables credit on write-off |
| **Attendance** | Feeds wage calc → payroll → journals |
| **Fixed Assets** | Monthly auto-depreciation journal; disposal posts gain/loss |
| **Migration** | Opening balance upload logic; BUSY/Tally imports land in opening balance staging |

---

## 20. Decisions Log

### Round 1 — Foundation
- **Engine + UI**: Double-entry engine + Easy Mode UI + Accountant Mode UI
- **COA**: Guided (templates + customization + system-required account locks)
- **Tax engine**: All SL rules built-in; tenants configure applicability

### Round 2 — Structural
- **Period lock**: Two-tier (Accountant/Owner override with reason, others hard-blocked)
- **FX**: Supported on Bills/POs/Supplier payments AND Invoices/Quotes/SOs/Customer receipts; ExchangeRate table (effective-dated + rate types); realized on settlement + unrealized at period-end per SLFRS 21; LKR reporting
- **Dimensions**: Single optional Tag per transaction

### Round 3 — Reports & Reconciliation
- **Reports**: All in scope (full list — see Section 14)
- **Bank recon**: Upload-based only (PDF/Excel + Tesseract). No live feeds.
- **Audit trail**: Financial fields immutable post-posting; non-financial editable with edit history

### Round 4 — FY & Onboarding
- **FY**: Fully user-configurable (any 12-month window)
- **Year-end close**: Full 5-step process (checklist → adjustments → P&L transfer → lock → reopen)
- **Opening balances**: TB upload + per-module; immutable once first txn posts
- **Comparatives**: 2-year max

### Round 5 — Daily Mechanics
- **Journal posting**: Accountant + Owner only
- **Approvals**: Only for high-impact actions (see Section 16)
- **COGS**: Perpetual (real-time per sale)
- **Valuation**: Per-item-category (WAVG / FIFO / Specific / Standard)
- **Transfers**: Standard 2-account transfer screen

### Round 6 — Special Entries
- **Fixed assets**: Full register + book + tax depreciation parallel
- **Recurring journals**: Template-driven with per-template auto-post vs review-queue toggle
- **Inter-branch**: Stock ledger only, no GL impact
- **Advances**: Customer advances + supplier deposits with auto-offset

### Round 7 — Closing Items
- **Bad debt**: Write-off + VAT bad-debt relief automation + recovery handling
- **Budgeting**: Minimal only (per-account per-month + variance report)
- **FX revaluation**: Period-end per SLFRS 21
- **Mid-year onboarding**: Both TB-cutover and full-historical paths
- **CA access**: Time-bounded view-only role + one-click audit pack export (no query/sign-off workflow)

---

## 21. Next Steps

Candidate follow-ups:

1. **Inventory module spec** — items, stock ledger, valuation, batch/expiry, transfers, stock counts, reorder logic (next in sequence)
2. **Payroll module spec** — salary structures, EPF/ETF/PAYE, payslip, statutory filings, attendance integration
3. **Migration flow IA** — import screens for BUSY/Tally/QB/CSV, field mapping
4. **Chart of Accounts templates** — industry-specific COAs for all 7 industry templates
5. **Tax rate catalog** — exact VAT/SSCL/WHT/Stamp rates with effective dates and rules
6. **Accounting data model deep dive** — full ERD with DB triggers, RLS policies, immutability enforcement

---

*Document version: 1.0 · Scope: Sri Lanka only · Module: Accounting · Owner: Automation Practice · Prepared for multi-tenant accounting SaaS (BUSY replacement)*
