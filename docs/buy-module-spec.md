# Buy Module Design Spec — Multi-Tenant Accounting SaaS (Sri Lanka)

> Specification for the Buy module — the procurement and supplier-side workflow heart of the platform. Symmetric to Sell but with stricter controls (money flows out), 3-way matching as the crown jewel, and SL-specific WHT handling. Target market: **Sri Lanka only**. Scope: **full system, not MVP**. Tightly coupled to Inventory (stock + landed cost), Accounting (perpetual GL + WHT engine), Cheque module + Petty Cash (Layer 2), and platform-level approval engine.

---

## 1. Scope & Principles

- **Full system, not MVP** — every SL purchasing reality covered, retail to wholesale to import.
- **Three procurement patterns supported simultaneously**:
    - **Full procurement** (PR → PO → GRN → Bill → Payment) — large/regulated tenants
    - **PO-light** (PO → GRN+Bill → Payment) — most SL SMEs
    - **Direct expense** (Bill or expense entry → Payment) — utilities, taxi, petty office buys
- **3-way matching** (PO ↔ GRN ↔ Bill) is the core control mechanism — but tenant-configurable to 2-way or no-matching depending on supplier trust and transaction type.
- **WHT engine** baked in per SL rules — auto-derivation by supplier × payment type, monthly remittance, annual certificates.
- **Easy Mode + Advanced Mode** on every screen (platform-level UX standard).
- **LLM-assist on capture** — photo/PDF of supplier invoice as primary Bill creation path; receipt photo for expenses; supplier letterhead/VAT cert for new supplier creation.
- **Perpetual GL posting** — Inventory and Input VAT post on GRN; AP solidifies on Bill.
- **Multi-branch + multi-warehouse** scoping enforced via role mapping.
- **FX support** for imports — full integration with Accounting's FX engine and Inventory's landed cost mechanic.

---

## 2. Document Chain

### 2.1 Documents in scope

| Document | Purpose | Stock impact | GL impact |
|---|---|---|---|
| **Purchase Requisition (PR)** | Internal request to buy | None | None |
| **Purchase Order (PO)** | Commitment to supplier | Reserves incoming stock (optional) | None until GRN |
| **Goods Received Note (GRN)** | Physical receipt at warehouse | Increases stock | Inventory + Input VAT (perpetual) |
| **Bill (Supplier Invoice)** | Supplier's invoice we accept | None (already on GRN) | AP solidifies; GRN accruals reverse |
| **Debit Note** | Return to supplier / billing dispute | Decreases stock | Reverses AP + Inventory + Input VAT + WHT |
| **Expense Entry** | Quick non-PO purchase (utilities, taxi, office stationery) | None | Expense + AP / Cash |
| **Payment** | We pay supplier | None | Reduces AP, decreases Bank/Cash |

### 2.2 Three procurement patterns

**Pattern A — Full procurement** (PR → PO → GRN → Bill → Payment)
Large tenants with formal procurement: requisition raised, approved, becomes PO, supplier confirms, goods received, bill matched, payment scheduled. Approval gates between each step.

**Pattern B — PO-light** (PO → GRN+Bill → Payment)
Most SL SMEs: PO directly issued to supplier, GRN and Bill often arrive close together, payment from bills queue. Lighter approval flow.

**Pattern C — Direct expense** (Bill or expense entry → Payment)
Utilities, courier, taxi, professional fees: no PO, no GRN. Just record bill or expense with receipt photo, pay through normal channels. Fast.

---

## 3. Purchase Requisition (PR)

### 3.1 Tenant-toggle module
- **Default off** for new tenants (most SL SMEs skip PR ceremony)
- Larger / procurement-heavy tenants enable
- When off, POs are the entry point; PR menu hidden

### 3.2 PR creation
- Any user with PR-create permission can raise
- Specifies: items, qty, justification, suggested supplier, branch/warehouse for delivery, expected timeline
- Multi-line PRs supported (one PR can request multiple items)

### 3.3 PR approval workflow
- Routed per tenant config (typically: requestor's manager → Owner above threshold)
- Approval / rejection / partial approval (some lines approved, others rejected with reason)
- Approval logged in audit trail

### 3.4 PR → PO conversion
- Approved PRs convert to POs
- One PR may become one PO OR multiple POs (different suppliers / different timing)
- Conversion preserves linkage for audit (PO references source PR)

---

## 4. Purchase Order (PO)

### 4.1 Creation paths
- **Manual** — user creates from scratch
- **From approved PR** — pre-fills items + quantities from PR
- **From reorder alert** — Inventory module's reorder list → one-click create PO (locked in Inventory; alerts only, no auto-PO unless user triggers)

### 4.2 Status lifecycle
Draft → Sent → Acknowledged → Partially Fulfilled → Fully Fulfilled → Closed → Cancelled

### 4.3 PO content
- Supplier (with default payment terms loaded)
- Currency (LKR or foreign for imports; FX rate captured)
- Multi-line items with: SKU, qty, unit price, tax code, discount, line total
- **Multi-warehouse delivery** — single PO can split items by destination warehouse
- Expected delivery date(s)
- Payment terms override (per-PO if different from supplier default)
- Special instructions / delivery instructions
- Attachments (supplier quotation, specifications)

### 4.4 Approval workflow
- POs above tenant-set LKR threshold → Owner approval
- New supplier (first PO) → Owner approval regardless of amount
- Per-line price variance > X% from last purchase → Accountant review
- Approval routed via Layer 2 approval engine

### 4.5 Email/PDF to supplier
- Branded PO template (multi-language EN/TA/SI)
- Auto-emailed to supplier's contact email on send
- Manual download/print available

### 4.6 Supplier acknowledgment
- Manual mark by user (Owner/Accountant marks "Acknowledged" when supplier confirms)
- Email reply tracking — Phase 2

### 4.7 PO modification post-approval
- Owner can edit confirmed PO (post-confirmation negotiations, additions, price changes)
- Audit trail captures every edit (who, when, from-value, to-value, reason)

### 4.8 Partial fulfilment
- Large PO (1000 units) received in multiple GRNs over weeks
- Each GRN posts independently, reduces PO open qty
- PO auto-closes on full GRN
- Manual close for short-shipment scenarios (short-close with reason)

### 4.9 PO → Bill direct conversion
- For services / non-physical purchases where there's no GRN
- PO directly converts to Bill on supplier invoicing
- Bypasses GRN step in 3-way matching (becomes 2-way)

---

## 5. Goods Received Note (GRN)

### 5.1 Creation paths
- **From PO** — pre-fills items + qty from PO; user adjusts actual received
- **Direct GRN (no PO)** — for emergency / casual purchases without prior PO; uses 2-way matching (GRN ↔ Bill) or no-matching depending on tenant config

### 5.2 Receipt verification
- Barcode scan to confirm items match
- Manual qty entry as fallback
- Per-line input: actual received qty, unit price (if different from PO), batch/serial/expiry (per Inventory item config), warehouse destination (multi-warehouse split), condition

### 5.3 Quality check fields
Per line:
- **Accept** — to sellable stock at received warehouse
- **Reject** — to damaged/quarantine bucket; supplier debit note triggered
- **Hold** — pending QA decision; not yet in sellable stock

Reason codes mandatory for Reject and Hold.

### 5.4 Discrepancy flags
Captured per line:
- **Short shipment** — received less than ordered
- **Excess shipment** — received more than ordered (tenant policy: accept extra and update PO, OR return excess via Debit Note)
- **Wrong item** — different SKU received
- **Damaged in transit** — received but damaged

Each discrepancy flagged for Bill matching review.

### 5.5 GL posting on GRN
- **Inventory increase** at PO price × received qty (perpetual)
- **Input VAT temporary accrual** (finalized at Bill)
- **Supplier AP accrual** (against expected Bill)
- Multi-warehouse split: stock posted to each receiving warehouse separately

### 5.6 Multi-warehouse receipt
- Single PO with multi-warehouse delivery → single GRN can split lines across warehouses
- Each warehouse receipt posted independently
- Stock and GL entries split correctly

---

## 6. Bill (Supplier Invoice)

### 6.1 Creation paths
- **From GRN** — pre-fills from GRN; user verifies amounts match supplier's invoice
- **From PO directly** — services with no GRN
- **Standalone** — ad-hoc bills (rent, utility, professional fee with no PO)
- **From photo/PDF of supplier invoice** — primary capture path. Tesseract OCR + LLM parses supplier name, date, line items, total → draft Bill created. Unknown SKUs flagged for mapping or creation. User reviews highlighted-yellow extracted fields, confirms.

### 6.2 3-way matching engine

**Three documents compared**:
- PO — what we agreed (qty, price)
- GRN — what we received (qty, condition)
- Bill — what supplier billed (qty, price)

**Match dimensions**:
- **Quantity** — Bill qty ≤ GRN qty
- **Price** — Bill unit price = PO unit price (within tolerance)
- **Total** — Bill total = (GRN qty × PO price) + tax

**Tolerance configuration per tenant**:
- Price tolerance: % variance OR absolute LKR per line
- Quantity tolerance: % variance OR absolute units
- Total tolerance: % of bill OR absolute LKR

**Auto-approval flow**:
- All three match within tolerance → Bill auto-approved → posts to AP → moves to payment queue
- Mismatch detected → Bill flagged → routed to Accountant for side-by-side review

### 6.3 Side-by-side review screen (mismatch handling)
- 3 columns: PO | GRN | Bill
- Differences highlighted (red over, amber under)
- Per-line resolution choices:
    - **Accept Bill as-is** — record variance to *Purchase Variance* GL account; post Bill
    - **Dispute** — raise Debit Note, push back to supplier with reason
    - **Adjust GRN** — correct GRN if we under-counted (with reason logged)
    - **Partial accept** — accept some lines, dispute others

### 6.4 Matching mode tenant configuration
Tenant can configure matching depth globally + per-supplier override:

| Mode | When to use |
|---|---|
| **Strict 3-way** | Procurement-heavy tenants, new/risky suppliers, high-value purchases |
| **2-way (PO ↔ Bill)** | Services with no physical receipt; trusted suppliers |
| **2-way (GRN ↔ Bill)** | Direct purchases without prior PO |
| **No matching** | Lightweight shops; all bills go through normal approval flow |

Per-supplier override: e.g. strict matching for new supplier, 2-way for trusted long-term partner.

### 6.5 Edge cases

**Pre-PO bills** (supplier sends invoice without PO existing)
- System creates a "phantom PO" matching the Bill (if tenant allows) OR
- Flags as "non-PO bill" — bypasses 3-way matching, requires Owner approval

**Bill received before GRN** (goods still in transit)
- Bill held in pending state until GRN posted, then auto-matches
- Aged "pending GRN" bills flagged after N days

### 6.6 WHT computation at Bill stage
- WHT auto-derived from supplier × payment type (Bill category)
- Computed amount displayed prominently
- Posted to *WHT Payable* liability account on Bill confirmation

### 6.7 Posting on Bill confirmation
- AP solidifies (was accrued from GRN, now confirmed)
- Input VAT confirms (was accrued, now claimable)
- WHT Payable accrued
- GRN-time accruals reversed and replaced with confirmed entries

---

## 7. Supplier Master

### 7.1 Identity
- Supplier name (registered name)
- Trade name (if different)
- **Type**: Local / Foreign / Government / Individual
- **Tax registration**: VAT registration number (for tax invoices), TIN, WHT-applicable flag
- NIC (for individual suppliers / sole proprietors)
- Address, phone, email, website
- **Multiple contact persons** — sales contact, accounts contact, delivery contact

### 7.2 Banking
- Bank name, branch, account number (for direct payment)
- SWIFT/IBAN (for foreign suppliers)
- Cheque payee name (if different from registered name)

### 7.3 Commercial terms
- Default payment terms (Net 30, Net 60, COD, advance, etc.)
- Default currency (LKR for local; USD/EUR/INR for imports)
- Credit limit *we have* with this supplier (some suppliers extend credit; useful to track)
- Default GL account (e.g. all bills from "ABC Stationery" default to "Office Supplies Expense")
- Discount terms (e.g. 2% if paid within 10 days)

### 7.4 SL compliance flags
- WHT applicable rate per payment type
- WHT exemption certificate held (yes/no, with expiry date)
- Tax exemption certificate
- Self-billing arrangement (rare)

### 7.5 LLM-assisted creation paths
- Photo of supplier letterhead → extract name, address, phone
- Photo of supplier's VAT certificate → extract VAT registration number, business name
- Photo of supplier's bank slip → extract bank account
- Business card photo → extract contact details

All extracted fields highlighted yellow for user review before commit.

---

## 8. Item Line Entry on PO/GRN/Bill

### 8.1 Capture paths (all available simultaneously)

| Path | Behavior | Best for |
|---|---|---|
| **Photo/PDF of supplier invoice** | OCR + LLM → draft Bill with supplier/date/line items pre-filled; unknown SKUs flagged | Most common Buy entry path |
| **Barcode scan** | Scan → item appears, qty entered | GRN at warehouse |
| **Search-as-you-type** | Type name/code → ranked dropdown (recent + supplier-specific items first) | Manual PO creation |
| **Convert from PO/GRN** | Pre-fill from upstream document | Standard flow |
| **CSV / Excel paste** | Bulk line entry | Power users, bulk imports |
| **Standing order template** | Pre-saved supplier basket → load with one tap | Recurring purchases |

### 8.2 Supplier-item linkage usage (from Inventory)
- When creating PO for supplier, dropdown ranks their items first
- Shows supplier part number alongside our SKU (often differ)
- Last-purchased price displayed for reference (negotiation leverage)
- Lead time, MOQ shown for planning
- Photo OCR mapping uses supplier-specific part numbers when present

---

## 9. Pricing on PO

### 9.1 Price source priority
1. **Negotiated price** entered manually on PO (one-off / spot purchases)
2. **Supplier's standard price** from supplier-item linkage (last-known)
3. **Tenant's reference cost** (internal expected cost)

### 9.2 Volume break support
- Supplier offers tiered pricing (1-100 @ X, 101-500 @ Y, 501+ @ Z)
- System auto-applies based on PO qty

### 9.3 Currency
- LKR (local) or foreign currency (imports)
- Exchange rate captured at PO time (per Accounting); finalized at Bill

### 9.4 Display transparency
- Resolved price + source shown (*"Supplier's last price LKR 2,500; this PO at LKR 2,400"*)
- Variance against last purchased price (Owner/Accountant only)
- Variance against tenant's reference cost (if set)

### 9.5 Approval triggers
- PO total > tenant-set threshold → Owner approval
- Per-line variance > X% from last price → Accountant review
- New supplier (first PO) → Owner approval regardless of amount

---

## 10. Tax on Buy (VAT, SSCL, WHT)

### 10.1 Input VAT
- Auto-applied per item tax code (from Inventory master)
- Captured at GRN as accrual; finalized at Bill posting
- Aggregated into VAT Input Register → claimed in VAT Return
- **Eligible vs ineligible** flag per tax code — ineligible portion expensed instead of claimed (e.g. entertainment, certain capital goods per SL VAT Act)

### 10.2 SSCL on Buy
- Captured separately when supplier applies SSCL on their invoice
- Treated per SL rules (typically capitalized or expensed depending on nature)

### 10.3 WHT (Withholding Tax) — full SL engine

**Applies on payment types**: rent, professional services, dividends, interest, contractor fees, commissions

**Rates vary by**: payment type × supplier type (e.g. 10% rent to individuals, 5% rent to companies, 14% on contracts above threshold)

**Mechanism**:
- WHT rate auto-derived from Supplier type × Payment type (Bill category)
- Tenant configures WHT rates per category (Layer 1 maintains current SL rates as defaults; tenant override allowed)
- On Bill creation: WHT amount auto-calculated, displayed prominently (*"Pay supplier LKR 95,000; WHT to IRD LKR 5,000"*)
- WHT posted to *WHT Payable* liability account at Bill confirmation
- **Monthly WHT remittance file** generated for IRD upload
- **Annual WHT certificate** per supplier auto-generated (Form T-9 equivalent — supplier needs for own tax filing)

**WHT exemption**:
- Supplier may hold exemption certificate (then no WHT deducted)
- Captured in supplier master with expiry date
- System auto-applies; alerts if certificate expired

---

## 11. Expense Entry (Non-PO Purchases)

### 11.1 Lightweight expense entry screen
- Required: Supplier (or "Cash payment to..."), date, amount, expense category (maps to GL account)
- Optional: tax (VAT input claim), receipt photo (Tesseract OCR), tag (cost center), branch, attachment
- **LLM-assist**: photo of receipt → extract vendor, date, amount → user confirms category

### 11.2 Petty cash mode
- If paid from petty cash float (Layer 2), posts against the float instead of bank
- Float balance updated in real time

### 11.3 Approval workflow
- Expenses above tenant-set threshold → Owner approval
- Routed via Layer 2 approval engine

### 11.4 Expense categories (tenant-configured)
Pre-loaded SL-typical categories:
- Rent (WHT auto-trigger)
- Electricity, Water, Telephone, Internet
- Vehicle Fuel, Vehicle Repair
- Office Supplies, Stationery
- Postage & Courier
- Bank Charges
- Professional Fees (WHT auto-trigger)
- Travel, Meal & Entertainment
- Repairs & Maintenance
- Subscription expenses

Each category mapped to GL account, with WHT-applicable flag and VAT-claim eligibility flag.

### 11.5 Recurring expense templates
- Mirror Recurring Invoice / Recurring Journal pattern
- Per-template auto-post vs review-queue toggle
- Pause / resume / edit / end-date supported

---

## 12. Payment Workflow

### 12.1 Payment scheduling
- **Payment due list** — Bills sorted by due date, with aging buckets (0-30 / 31-60 / 61-90 / 90+ days payable)
- Owner / Accountant selects bills to pay
- **Batch payment** — pay 20 suppliers in one batch run
- **Partial payment** — pay LKR 50K of LKR 200K bill, leave rest open
- Bills can be filtered by supplier, due date, amount, branch

### 12.2 Payment methods (mirror Sell-side tender)

| Method | Capture details |
|---|---|
| **Cheque** | Full integration with Cheque module (Layer 2). Issue cheque, print, track lifecycle, link to Bill. |
| **Bank transfer** | Generate bank file (per SL bank format) for upload, OR manual SLIPS entry, OR direct pay-link |
| **Cash** | For small payments (Petty Cash module integration) |
| **Online transfer / QR** | PayHere / FriMi for digital-savvy suppliers |
| **Mixed** | Partial cheque + partial bank for one Bill |

### 12.3 WHT handling at payment
- WHT amount displayed prominently (*"Pay LKR 95,000 to supplier; LKR 5,000 to IRD"*)
- **Two journal entries posted on payment**:
    - Debit Supplier AP, Credit Bank (for net amount paid to supplier)
    - Debit Supplier AP, Credit WHT Payable (for WHT held back; remitted to IRD separately)
- WHT certificate generated alongside payment receipt for supplier

### 12.4 Approval workflow
- Payments above tenant-set threshold → Owner approval
- Cheque issuance always requires authorized signatory (already in Cheque module)
- Batch payment approval = single approval for entire batch

### 12.5 Payment receipt to supplier
- Auto-generate payment confirmation PDF
- Email to supplier with WHT certificate attached (if applicable)
- Supplier portal shows payment history (if portal enabled)

---

## 13. Supplier Statements & Reconciliation

### 13.1 Outbound supplier statement (we generate for our reference)
- Period statement showing: bills + payments + advances + debit notes + closing balance
- Aging buckets (0-30 / 31-60 / 61-90 / 90+ days payable)
- Helpful for cash flow planning
- Exportable / printable

### 13.2 Inbound supplier statement reconciliation
- Supplier sends their statement showing what they think we owe
- We upload PDF/Excel → system parses (Tesseract for PDF) → side-by-side compare with our records
- **Differences flagged**:
    - Bills they have we don't (missed entry on our side)
    - Bills we have they don't (their omission)
    - Amount mismatches
- Investigation workflow per discrepancy
- Critical for monthly close — catches missed bills, double-payments, disputes

### 13.3 Supplier ledger view
Per supplier:
- All transactions chronological
- Outstanding balance with breakdown (current bills, post-dated cheques issued, advances paid)
- Quick filter by date range, bill status

---

## 14. Supplier Advances & Prepayments

### 14.1 Pay supplier advance
- Before any bill exists (deposit for import, retainer for service, advance against future supply)
- Posted to *Supplier Advances* asset account (locked in Accounting)
- Supplier ledger shows debit balance (they owe us goods/services)

### 14.2 On Bill receipt
- System detects open advance → prompts: *"Supplier has LKR 200K advance, apply to this bill?"*
- One-click apply → balance due = bill total − applied advance
- Partial application supported

### 14.3 Advance recovery (if supplier doesn't deliver)
- Owner-initiated demand letter generation
- Advance written off if irrecoverable (with reason; routed through Accounting bad-debt-style write-off)

---

## 15. Multi-Branch Purchasing

### 15.1 Branch-stamped transactions
- Every PR/PO/GRN/Bill carries the branch where created
- Drives branch-level cost reporting and budget tracking

### 15.2 Procurement patterns supported
- **Centralized** — head office issues all POs, supplier delivers to branches/warehouses, single Bill
- **Decentralized** — each branch issues own POs to local suppliers
- **Mixed** — central POs for major suppliers, local POs for small/urgent purchases

### 15.3 Multi-warehouse PO delivery
- Single PO can specify items split by destination warehouse
- GRN created per warehouse on actual receipt
- Bill matches against multi-warehouse PO across all related GRNs

### 15.4 Inter-branch transfer of purchased stock
- Already in Inventory (2-step dispatch + receive workflow)
- Cost carries forward without GL impact

### 15.5 Branch-specific approval thresholds
- Pettah branch manager up to LKR X
- Kandy branch manager up to LKR Y
- Owner above all branch limits

### 15.6 Branch-specific suppliers
- Some suppliers serve only specific branches (geographic constraints)
- Supplier-branch linkage table; supplier dropdown filters by branch context

### 15.7 Cross-branch supplier balance
- Supplier AP is tenant-wide (combined across all branches)
- Same model as Sell-side customer AR

---

## 16. FX on Imports

### 16.1 Currency flow
- PO can be in foreign currency (USD/EUR/INR) with exchange rate captured at PO time
- GRN inherits PO currency; rate updated to GRN-day rate (tenant chooses freeze-at-PO vs revalue-at-GRN)
- Bill posted in foreign currency, converted to LKR for ledger
- **Realized FX gain/loss** on payment (difference between Bill rate and payment rate)
- **Period-end revaluation** of open foreign-currency AP per SLFRS 21 (locked in Accounting)
- Supplier balance shown in both currencies (txn currency + LKR equivalent)

### 16.2 Landed cost integration (locked in Inventory)
- Customs duty, freight, insurance, clearing fees captured per GRN
- Allocated to items by chosen method (value/qty/weight/manual)
- Post-GRN bills (clearing agent, freight forwarder) linked retrospectively
- Item cost retrospectively adjusted; locks after configurable threshold (default 60 days OR after related sales post)
- Variance posts to *Landed Cost Variance*

---

## 17. Recurring Purchases / Standing Orders

### 17.1 Use cases
- Monthly office cleaning service
- Quarterly licence renewals
- Weekly produce supply
- Monthly rent (typically expense entry, recurring)

### 17.2 Template setup
- Supplier + items + qty + price + frequency (weekly / monthly / quarterly / annual) + start/end dates
- Generated as: PO (procurement-heavy) OR Bill (direct expense) — tenant choice per template
- **Per-template toggle**: auto-post (fixed amount, predictable) vs review-queue (variable)
- Pause / resume / edit / end-date supported

### 17.3 Variable amount recurring
- Some recurrings vary per cycle (utility consumption, hourly contractor, metered services)
- Template structure fixed; quantities / amounts entered per cycle
- Reminder N days before run date

---

## 18. Debit Notes / Supplier Returns

### 18.1 Trigger scenarios
- Quality reject (received goods don't meet spec)
- Excess delivery (supplier sent more than ordered)
- Wrong item delivered
- Damaged in transit
- Late return after acceptance (rare; by negotiation)

### 18.2 Flow
- User opens existing GRN or Bill → *"Create Debit Note / Supplier Return"* action
- Pre-fills items + qty; user adjusts what's actually being returned
- **Condition codes (mandatory)**: Quality reject / Excess / Wrong item / Damaged in transit / Other
- Stock decrement (returned items leave warehouse)
- Posting:
    - Debit Supplier AP (reduces what we owe)
    - Credit Inventory (stock out)
    - Credit Input VAT (reverses VAT claim)
    - Credit WHT (if applicable, reverses WHT held back)

### 18.3 Settlement options
- **Offset against future Bill** from same supplier (most common in SL)
- **Supplier refund** (rare — supplier rarely refunds cash, usually credit memo)
- **Replace with new delivery** (creates linked offset Bill + Debit Note pair)

### 18.4 Permission gates
- Stock Keeper can initiate Debit Note for quality reject
- Owner approval required for posting (above threshold)

---

## 19. Dashboard Widgets

### 19.1 Owner dashboard tiles (Buy-side)
- Today's purchases (LKR + count)
- Purchases this month (LKR + vs budget if set)
- Top 5 suppliers (this month by spend)
- Top 5 purchase categories
- Outstanding payables (total + aging snapshot)
- Bills awaiting approval (count, drill-down)
- Bills with mismatch (3-way matching exceptions)
- Cheques to be issued (post-dated due in next 7 days)
- WHT remittance due (current month accumulated)

### 19.2 Accountant dashboard
- Bills to review (3-way mismatches)
- Bills due this week / overdue
- WHT remittance summary
- Supplier reconciliation queue
- Pending payment approvals

### 19.3 Stock Keeper dashboard
- Pending GRN entries (POs awaiting receipt confirmation)
- Discrepancy GRNs (short / damaged / wrong) needing resolution
- Supplier delivery schedule (today's expected GRNs)

### 19.4 Customizable
- Tenant admin can add/remove/reorder widgets per role
- Individual user can rearrange within their assigned set

---

## 20. Document Templates

### 20.1 Templates needed
- Purchase Requisition template (internal-facing, simple)
- Purchase Order template (sent to supplier — branded, formal)
- Goods Received Note template (often needed for supplier sign-off)
- Debit Note template (sent to supplier)
- Payment Advice template (sent to supplier with payment confirmation + WHT certificate)
- Cheque print template (ties into Cheque module)

### 20.2 Template engine (mirror Sell)
- Drag-drop builder
- Variable insertion (`{{supplier.name}}`, `{{po.total}}`, `{{wht.amount}}`)
- Multi-language (EN/TA/SI)
- Multiple templates per doc type, assignable per supplier or pickable at print time
- Template library (5-8 pre-built per doc type)
- Version control with rollback

### 20.3 SL specifics baked into templates
- Our VAT registration number block (mandatory on tax-relevant docs)
- WHT details on payment advice (mandatory for compliance)
- Tenant's bank account details (for supplier reference)
- Authorized signatory block
- Tenant-configurable footer T&Cs

---

## 21. Document Attachments

### 21.1 Attachable per transaction
- Supplier's quotation
- Supplier's proforma invoice
- Supplier's commercial invoice
- Bill of lading / airway bill (imports)
- Packing list
- Customs documentation (BOE — Bill of Entry)
- Insurance certificate
- Inspection report
- Quality certificate
- Delivery note (signed)
- Bank payment confirmation
- WHT certificate copies

### 21.2 Behavior
- Multiple attachments per transaction (sensible per-file cap, e.g. 10 MB)
- Inline preview (PDF / image)
- Searchable by transaction number, supplier, date
- Retained for SL audit period (default 7 years)
- S3-compatible storage, tenant-isolated

---

## 22. Audit Trail & Voiding

### 22.1 Posted transactions — financial fields immutable
- Amount, account, tax, date, WHT — frozen
- Corrections via Debit Note + new Bill OR voiding (with approval)

### 22.2 Editable post-posting
- Supplier address (delivery edits)
- Narration / notes
- Internal tags
- Cost center assignment

### 22.3 Edit history
- Visible on every transaction
- Who changed what, when, from-value → to-value
- Comments / reasons captured per edit
- Auditor view shows full edit log

### 22.4 Voiding
- Permission-gated (Owner / Accountant only)
- Reason required (pre-defined codes + free text)
- Voided transaction shown as VOID, original number retained
- Stock + GL reversed automatically
- Original transaction findable, marked

---

## 23. Supplier Portal (Optional)

### 23.1 Tenant toggle — off by default
- Most SL SMEs won't use; larger tenants (manufacturers, distributors) will value it

### 23.2 If enabled
- Supplier logs in (email + OTP)
- Sees POs issued to them (status, lines, expected delivery date)
- Acknowledges PO acceptance
- Submits Bills directly (uploads PDF; our system OCRs and creates draft for our team to review/match)
- Views payment status (which bills paid, which pending, payment dates, WHT certificates)
- Updates own contact info / bank details (route through tenant approval)

### 23.3 Branding
- White-labelled with tenant's logo + colors
- URL: `yourbiz.platform.com/supplier-portal`

---

## 24. Integration Touchpoints

### 24.1 Internal modules (built-in)
- **Inventory** — stock increase on GRN, valuation update, batch/serial/expiry capture, landed cost capture
- **Accounting** — perpetual GL posting (AP, Inventory, Input VAT, WHT Payable, Bank/Cash, Supplier Advances)
- **Cheque module** (Layer 2) — cheque issuance to suppliers, full lifecycle tracking
- **Cheque book register** (Layer 2) — for issuing payment cheques
- **Petty Cash module** (Layer 2) — for small cash payments and expense entries
- **Approval engine** (Layer 2) — PO/Bill/Payment approvals routed via tenant-configured workflows

### 24.2 External integrations (tenant configures)
- **Bank file generation** for supplier payments (per SL bank format — Commercial, HNB, Sampath, BOC, People's, NDB, NSB)
- **SLIPS batch file** for inter-bank supplier transfers
- **Email** — PO delivery to supplier, payment advice emails with WHT certificates
- **Customs / clearing agent integration** — Phase 2 (when SL Customs API stabilizes)
- **WhatsApp / SMS to supplier** — Phase 2

---

## 25. SL-Specific Bakes

- **Currency**: LKR with `Rs. 2,50,000` formatting; FX with rate capture for imports
- **Phone**: `+94 XX XXX XXXX` for local suppliers
- **VAT compliance**: Input VAT capture per item tax code, eligible/ineligible flag, monthly VAT Input Register feeding VAT Return
- **SSCL on Buy**: captured separately when supplier applies it
- **WHT**: full SL WHT engine (rates per supplier × payment type, monthly remittance file, annual certificate per supplier on Form T-9 equivalent)
- **Customs duty** as landed cost component (capitalized to inventory, not expensed)
- **Stamp duty** on certain payment vouchers (auto-applied per rule)
- **PayHere / FriMi / Genie / iPay** as outbound payment methods (where supplier accepts)
- **SL bank file formats** for supplier bulk payments (Commercial, HNB, Sampath, BOC, People's, NDB, NSB)
- **SLIPS batch** for inter-bank
- **Tax invoice vs simplified invoice** distinction on supplier Bills (per SL VAT Act — registered vs unregistered supplier)
- **Holiday calendar** — SL holidays affect PO scheduling, payment due dates, recurring purchase scheduling

---

## 26. Data Model — Buy Entities (Overview)

```
Tenant
  ├── Supplier (1:n) — links to SupplierCreditTerms, SupplierAdvances (Accounting/Layer 2)
  │     ├── SupplierContact (1:n persons)
  │     ├── SupplierBankDetails (1:n accounts)
  │     ├── SupplierItemLink (1:n with part#, price, lead time, MOQ, preferred — from Inventory)
  │     ├── SupplierWHTProfile (1:1 with rates + exemption certificate)
  │     ├── SupplierBranchLink (n:n geographic)
  │     └── SupplierStatement (1:n historical)
  ├── PurchaseRequisition (1:n)
  │     ├── PurchaseRequisitionLine (1:n)
  │     └── PurchaseRequisitionApproval (workflow state)
  ├── PurchaseOrder (1:n)
  │     ├── PurchaseOrderLine (1:n with multi-warehouse delivery split)
  │     ├── PurchaseOrderApproval (workflow state)
  │     ├── PurchaseOrderAcknowledgment (1:1)
  │     └── PurchaseOrderEditHistory (1:n)
  ├── GoodsReceivedNote (1:n)
  │     ├── GoodsReceivedNoteLine (1:n with batch/serial/expiry)
  │     ├── GoodsReceivedNoteDiscrepancy (1:n short/excess/wrong/damaged)
  │     └── GoodsReceivedNoteAttachment (1:n)
  ├── Bill (1:n)
  │     ├── BillLine (1:n)
  │     ├── BillTaxBreakdown (1:n input VAT, SSCL, WHT)
  │     ├── BillMatchingResult (1:1 — 3-way / 2-way / no-match status with variance)
  │     ├── BillAttachment (1:n)
  │     └── BillEditHistory (1:n)
  ├── DebitNote (1:n)
  │     ├── DebitNoteLine (1:n)
  │     └── DebitNoteSettlement (1:1 offset/refund/replace)
  ├── ExpenseEntry (1:n — non-PO purchases)
  │     ├── ExpenseAttachment (1:n with OCR metadata)
  │     └── ExpenseCategoryLink
  ├── ExpenseCategory (1:n — tenant library with WHT/VAT flags)
  ├── RecurringPurchaseTemplate (1:n)
  │     └── RecurringPurchaseInstance (1:n generated)
  ├── Payment (1:n)
  │     ├── PaymentMethod (1:n — supports mixed)
  │     ├── PaymentApplication (1:n — applied to bills)
  │     └── WHTRemittance (1:n linked to payments)
  ├── WHTCertificate (1:n per supplier per period)
  ├── SupplierReconciliation (1:n statement matching sessions)
  ├── PurchaseVariance (1:n posted to GL when bills accepted with mismatch)
  ├── DocumentTemplate (1:n per doc type, multi-language)
  └── BuyAuditLog
```

All entities tenant-scoped via Postgres Row-Level Security.

---

## 27. Deferred to Later Phases

- Email reply tracking for supplier PO acknowledgment
- Customs API integration (when SL Customs API stabilizes)
- WhatsApp / SMS to supplier
- E-procurement marketplace integrations
- Auto-purchase from preferred supplier on reorder alert (currently alerts only)
- AI-suggested supplier selection (best price + lead time + reliability score)
- Supplier performance scoring (on-time delivery, quality, pricing trend)
- Real-time supplier API integrations (connected supplier catalogues)

---

## 28. Next Steps

Next module specs in queue:
1. **Migration flow IA** — BUSY/Tally/QuickBooks/Excel onboarding screens
2. **Pricing plan architecture** — Starter / Growth / Scale feature gating + LKR pricing
3. **Super Admin (Layer 1) dashboard spec**
4. **Data model deep dive** — full ERD with RLS policies

---

*Document version: 1.0 · Module: Buy · Scope: Sri Lanka only · Full system (not MVP) · Owner: Automation Practice · Prepared for multi-tenant accounting SaaS (BUSY replacement)*

*Decisions consolidated across 5 rounds covering: three procurement patterns (full / PO-light / direct expense), full document chain (PR/PO/GRN/Bill/Debit Note/Expense/Payment), tenant-toggle PR module, full PO lifecycle with approvals + supplier acknowledgment + post-approval modification + partial fulfilment, full GRN with quality check + discrepancy flags + multi-warehouse split, full Bill module with 3-way matching engine + tenant-configurable matching modes (strict/2-way/no-match) + per-supplier override + side-by-side mismatch review, full supplier master with LLM-assist creation, 6 item entry capture paths with photo/PDF as primary, full pricing with source priority + variance flagging + approval triggers, full SL tax engine (Input VAT eligible/ineligible + SSCL + WHT auto-derivation + monthly remittance + annual certificates), full lightweight expense entry with petty cash integration + LLM-assisted receipt OCR + recurring expense templates, full payment workflow (4 methods + WHT split posting + batch payments + approvals), supplier statements both directions including reconciliation tool, supplier advances with auto-prompt application, full multi-branch purchasing (centralized/decentralized/mixed), full FX on imports + landed cost integration, full recurring purchase templates, full Debit Note flow with three settlement options, full Buy dashboard widgets per role, full document template engine with SL specifics, full document attachments, full audit trail with voiding, optional supplier portal (tenant toggle), complete internal + external integration map, comprehensive SL-specific bakes, full data model.*
