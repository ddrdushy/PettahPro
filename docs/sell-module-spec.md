# Sell Module Design Spec — Multi-Tenant Accounting SaaS (Sri Lanka)

> Specification for the Sell module — the activation path and daily transaction heart of the platform. Where shopkeepers spend 80% of their time. Target market: **Sri Lanka only**. Scope: **full system, not MVP**. Tightly coupled to Inventory (stock + valuation), Accounting (perpetual GL), Cheque module + Customer Credit Limits + Petty Cash (Layer 2), and Payroll (commission integration).

---

## 1. Scope & Principles

- **Full system, not MVP** — every SL sales reality covered, retail to wholesale to counter sales.
- **Three sales patterns supported simultaneously**:
    - **Direct invoice** (small shops, retail walk-in)
    - **Order-to-cash** (B2B wholesale: quote → SO → DN → invoice → receipt)
    - **POS** (fast retail, restaurant, pharmacy counter — single-screen experience)
- **Easy Mode + Advanced Mode** on every screen (platform-level UX standard).
- **LLM-assist on capture paths** — barcode lookup, photo of order list, business card OCR. **Voice deferred** (per Phase 2 deferrals).
- **Perpetual COGS** posts in real time on every sale (Accounting lock).
- **Branch + warehouse scoping** enforced via role mapping.
- **Multi-language UI** — EN / TA / SI per user preference.
- **Cross-branch operations native** — fulfilment, customer balance, returns all work tenant-wide.

---

## 2. Document Types

### 2.1 Document chain

| Document | Purpose | Stock impact | GL impact |
|---|---|---|---|
| **Quotation** | Proposal to customer, no commitment | None | None |
| **Sales Order (SO)** | Confirmed order awaiting fulfilment | Reserves stock (optional) | None until invoice |
| **Delivery Note (DN)** | Goods physically delivered, awaiting invoice | Reduces stock | COGS posted (perpetual) |
| **Invoice** | Bills the customer | Reduces stock (if no DN) | AR + Revenue + Tax + COGS |
| **Credit Note** | Reverses a sale (return/discount adj) | Restores stock | Reverses AR + Revenue + Tax + COGS |
| **POS Sale** | Counter sale, instant invoice + payment | Reduces stock | Same as invoice + payment |
| **Receipt / Payment** | Customer pays us | None | Reduces AR, increases Bank/Cash |
| **Proforma Invoice** | Preview for advance / customs / approval | None | None until converted |

### 2.2 Quotation lifecycle
- **Status**: Draft → Sent → Accepted / Rejected / Expired
- **Versioning** — customer asks for revisions → Quote v1.1, v1.2 (history preserved)
- **Conversion** — accepted quote → one-click convert to SO or Invoice (pre-fills everything)
- **Email/PDF delivery** with branded template
- **Validity period** with auto-expiry
- **Tenant-configurable T&Cs** attached to PDF
- **Digital acceptance via signed link** — Phase 2

### 2.3 Sales Order
- Created from accepted quote OR direct
- **Stock reservation toggle per item** — reserved stock unavailable for other SOs
- **Partial fulfilment** — large SO delivered in batches → multiple DNs against same SO
- **Status**: Draft → Confirmed → Partially Fulfilled → Fully Fulfilled → Closed → Cancelled
- **Backorder handling** — out-of-stock lines auto-create backorder; auto-fulfil when stock arrives
- **SO modification** — Owner edits confirmed SO with audit trail (post-confirmation negotiations, additions)

### 2.4 Delivery Note — separate or combined
- **Per-transaction toggle** — DN can be separate document OR combined with invoice
- **Default per customer** — wholesale customers default separate DN+invoice; retail default combined
- Stock decrements on whichever document is generated first

### 2.5 Invoice modes
All five supported:

- **Standard** — single sale, single invoice
- **Recurring** — same customer, schedule-driven (see Section 8)
- **Batch** — generate invoices for many customers at once (e.g. monthly billing run for 200 customers based on accumulated DNs)
- **Consolidated** — one invoice covering multiple DNs/SOs for the same customer over a period (common in wholesale: *"all your deliveries this month, one invoice"*)
- **Proforma** — preview invoice for advance / customs / approval; not posted until converted

---

## 3. Customer Selection & Creation

### 3.1 Existing customer
- Search by name / phone / NIC / business name (auto-complete from history)
- **Recent customers ranked first** in dropdown (per cashier/user)
- On selection: loads price list, credit limit, outstanding balance, last 5 invoices visible

### 3.2 Walk-in / cash sale (POS)
- Default *"Cash Customer"* virtual entity (no master record needed)
- Optionally capture phone for SMS receipt + future linkage
- Walk-in promoted to permanent customer with one tap

### 3.3 New customer mid-sale
- Inline create — minimum required = name + phone
- **LLM-assist paths**:
    - Photo of business card → extract name, address, phone, email
    - Photo of shop letterhead → extract business name, address, contact
    - Photo of VAT certificate → extract business name, VAT registration number
- All extracted fields highlighted yellow for user review before commit
- New customer immediately usable on current invoice

---

## 4. Item Line Entry

### 4.1 Capture paths (all available simultaneously)

| Path | Behavior | Best for |
|---|---|---|
| **Barcode scan** | Scan → item appears, qty defaults 1, Enter advances; scan next | Retail, pharmacy, grocery |
| **Search-as-you-type** | Type partial name/code → ranked dropdown (recent + frequent first) → select | Wholesale, services |
| **Quick-pick favourites** | Customer's recent items (last 30 days) shown as tap-tiles | Repeat customers (pharmacy resupply) |
| **Photo of order list** | Customer's handwritten/typed order list → OCR + LLM matches to SKUs | Wholesale receiving WhatsApp orders |
| **CSV / Excel paste** | Paste from spreadsheet → mapped to lines | Power users, bulk B2B |
| **Standing order template** | Pre-saved customer basket → loaded with one tap | Recurring B2B |
| **Convert from quote/SO** | Pre-filled lines from source document | B2B order-to-cash |

**Voice entry deferred to Phase 2.**

### 4.2 Pricing application

**Resolution chain (highest priority first):**
1. Customer-specific item override
2. Customer's assigned price list (Retail / Wholesale / Dealer / VIP)
3. Default price list

**Then applied on top:**
- Active time-bound promo (if within window)
- Volume break (qty crosses tier threshold)
- Manual line discount (% or LKR, permission-gated)

### 4.3 Display transparency
- Show resolved price + "why" hint on hover (*"Price from Wholesale list, 10% Avurudu promo applied"*)
- Show line discount applied separately
- **Margin per line** (cost + margin %) — visible only to roles with permission (Owner / Accountant)

### 4.4 Tax application
- Tax auto-applied from item's tax code (Inventory master)
- **Inclusive vs exclusive pricing** — toggle per invoice OR default per customer
- **Compound tax support** — VAT 18% + SSCL 2.5% applied per actual SL structure (SSCL on value, VAT on new total)
- **Tax-exempt customer flag** — auto-suppress tax with reason
- **Zero-rated exports** — separate tax code (0% with VAT-claim eligibility)
- **Manual tax override per line** with permission gate + reason
- **Display**: per-line tax visible; tax breakdown summary at invoice bottom (VAT total, SSCL total, etc.)

### 4.5 Discount handling

**Types**:
- Line-level discount (% or LKR off single line)
- Invoice-level discount (% or LKR off entire invoice after lines)
- Promo discount (auto-applied from active promo)
- Loyalty discount (auto from customer tier — see Section 9)
- Trade discount (reduces price) vs Cash discount (post-invoice early-payment incentive)

**Permission model**:
- Cashier — max X% line discount (tenant-configurable)
- Sales — max Y% line + invoice discount
- Owner — unlimited

**Approval workflow** for discounts above thresholds — line goes to Owner inbox before invoice posts.

**Reporting** — discount given per customer / per item / per salesperson visible in reports.

---

## 5. POS — One-Screen Experience

### 5.1 Three-zone layout

| Zone | Content |
|---|---|
| **Left (large)** | Item lines being added (scrollable), running totals at bottom |
| **Right (action panel)** | Big tap-tiles: Customer (or Cash), Discount, Hold/Park, Tender, Print, Quick-favourites |
| **Bottom (tender bar)** | Total, payment method buttons (Cash / Card / QR / Bank Transfer / Mixed), Change due |

### 5.2 Hardware integration
- Barcode scanner (USB / Bluetooth) — scans into focus
- Cash drawer — opens on cash tender
- Receipt printer — auto-prints on tender (thermal 80mm or 58mm)
- Customer display (small screen facing customer) — shows running total
- Scale integration — for deli, fresh, weigh-and-sell items (price = weight × unit price)

### 5.3 Speed-critical behaviors
- **No mouse required** — keyboard + scanner + tender buttons end-to-end
- **Hold / Park sale** — set aside in-progress sale to handle next customer; resume later
- **Multiple parked sales** visible as tabs at top
- **Last sale recall** (F-key) — bring back last sale for refund/correction
- **Cashier sign-on / sign-off** with PIN — multi-cashier per terminal
- **Shift management** — open shift with starting cash, close shift with ending cash + variance reconciliation (see Section 11)

### 5.4 Offline mode
- Local IndexedDB / SQLite cache of items, customers, prices
- Offline transactions queued; sync when back online
- **POS as source of truth** for sold qty (from Inventory lock)
- Visual indicator: green dot (online) / amber dot (offline, syncing later)

---

## 6. Payment / Tender Capture

### 6.1 Tender methods (all 9 supported)

| Method | Capture details |
|---|---|
| **Cash** | Amount tendered, system computes change |
| **Card (Visa/Master)** | EDC machine reference, last 4 digits of card (manual capture — no real-time EDC integration in MVP) |
| **Cheque** | Full cheque capture via Cheque module (bank, cheque#, date, image, hold/deposit state) |
| **Bank transfer** | Reference number, sender bank, date |
| **QR / Mobile** (LankaQR / FriMi / Genie / iPay / PayHere) | QR shown at counter or payment link sent; reference captured on confirmation |
| **Account credit** | Pay from existing customer advance balance (offset against open advances) |
| **Loyalty points** | Redeem points as discount (Section 9) |
| **Mixed tender** | Single sale paid by multiple methods (e.g. LKR 10K cash + LKR 5K card + LKR 2K credit) |
| **On account / credit** | No payment now — invoice posts to AR, customer pays later (subject to credit limit) |

### 6.2 Tender behavior
- Tender method buttons configurable per branch (some don't take cards, some don't accept cheques)
- Mixed tender always supported
- Receipt shows breakdown by tender method
- Failed payment → invoice held, retry tender
- **Refund tender method must match** — refund cash sale in cash; refund card sale to card with reference

---

## 7. Receipts and Invoice Prints

### 7.1 Receipt (POS)
- Thermal printer 80mm or 58mm
- Tenant-configurable header/footer (logo, address, tagline, return policy, "thank you")
- **QR code at bottom** — scannable for digital receipt copy + invoice download
- VAT breakdown
- Cashier name + terminal ID + receipt number
- Optional: customer's loyalty balance, "you saved X today"
- Multi-language scripts supported (Tamil, Sinhala) via ESC/POS font loading

### 7.2 Standard invoice (printable A4/A5)
- PDF with branded template
- Tenant designs templates (multiple per doc type — formal corporate / casual retail / Tamil-language wholesale)
- **Multi-language**: invoice prints in EN/TA/SI based on customer preference
- Includes: branded header, customer block, line items, tax summary, payment terms, bank details, T&Cs, signatory
- **E-invoice readiness** — structured QR code with invoice metadata (for SL e-invoicing if/when mandated)

### 7.3 Delivery options
- **Print** (default)
- **Email PDF** (auto-sent if customer email on file)
- **Customer portal** (always available)
- **WhatsApp link** — Phase 2
- **SMS link to view** — Phase 2

---

## 8. Returns / Credit Notes

### 8.1 Sales return / credit note flow
- User opens existing invoice → *"Create Credit Note / Sales Return"* action
- Pre-fills items + qty from invoice; user adjusts what's actually being returned
- Stock restored (all returns sellable per Inventory simplification; damaged goods handled via separate adjustment workflow)
- AR reversed, tax reversed, COGS reversed
- Original invoice marked "Has return" with link to credit note (audit trail)

### 8.2 Refund methods
- **Refund cash** (POS only — money out of drawer)
- **Refund to card** — manual EDC reverse with reference
- **Refund to original payment method** (cheque, bank transfer, etc.)
- **Customer credit** — credit balance held on account, applied to future invoice
- **Replacement** — exchange for another item (creates linked offset invoice + credit note pair)

### 8.3 Approval flow
- Permission-gated by amount (Cashier handles small returns; Owner above threshold)
- Within return window — auto-approved up to threshold
- Beyond window — Owner approval mandatory

### 8.4 POS-specific return scenarios
- **Same-day return at counter** — scan receipt, refund, drawer opens
- **No-receipt return** — search by phone/customer name, find invoice
- **Partial return** — customer returns 2 of 5 items
- **Cross-branch return** — bought at Pettah, returning at Kandy (allowed if same tenant + permissions)
- **Damaged on return** — captured but doesn't block refund (sent to damaged stock bucket via separate adjustment later)

---

## 9. Loyalty Programs (Lightweight)

### 9.1 Scope
- Tenant toggle to enable/disable per outlet
- Points earned per LKR spent (configurable rate per tenant)
- Points redeemable as discount on future purchase (configurable redemption value)
- Customer master shows points balance
- POS shows balance + redeem option at tender

### 9.2 Deferred to Phase 2
- Tiered membership (Bronze / Silver / Gold)
- Birthday bonuses
- Referral rewards
- Time-bound multipliers (*"2x points this weekend"*)
- Expiry rules
- Tier-based price list discounts

---

## 10. Sales Reps & Commission

### 10.1 Salesperson on transaction
- Every quote/SO/invoice carries Salesperson tag (one or multiple — split commission scenarios)
- Defaults to logged-in user if role = Sales; overridable
- Commission accrual automatic based on rules

### 10.2 Commission rule engine (full + tenant-customizable)
**Pre-built rule types**:
- Flat % of sale value
- Tiered by volume (1% up to LKR 1M monthly, 2% up to 5M, 3% above)
- Per item / category (high-margin items higher %, low-margin lower)
- Per customer segment (new vs repeat acquisition)
- Net of returns (claw-back on customer returns)
- **On collection** — commission only on customer payment, not invoice posting (common in SL wholesale)

**Tenant-customizable rule builder** — compose custom rules combining variables (item × customer × salesperson × period).

**Multi-rule aggregation** — multiple rules apply per line; system computes per-line then aggregates.

### 10.3 Reporting + Payroll integration
- Commission earned per salesperson per period
- Commission ledger per salesperson (earnings, claw-backs, payouts)
- **Auto-flow to Payroll** as commission earning component (appears on payslip)

---

## 11. End-of-Day Cash Reconciliation (POS)

### 11.1 Workflow
- Cashier closes shift → enters physical cash count (denomination breakdown: 5000s, 1000s, 500s, 100s, 50s, 20s, coins)
- System computes expected balance: opening float + cash sales received − cash refunds − cash withdrawals
- Variance shown (over / short)
- Variance reason captured (pre-defined codes: change error, theft suspicion, miscount, other)
- Variance posted to *Cash Over/Short* GL account

### 11.2 Z-report
- Immutable closing report per shift
- Sales summary, tender breakdown, variance, cashier + supervisor sign-off
- Cash physically deposited or carried over to next shift's float

### 11.3 Multi-shift per day
- Busy outlets run 2-3 cashier shifts daily
- Each shift closes independently
- Full-day summary at end-of-business-day (consolidated)

---

## 12. Customer Advances (Sell-Side UX)

- **"Receive advance"** mode on receipt screen — captures payment without linking to invoice
- Posted to *Customer Advances* liability account (Accounting lock)
- Customer ledger shows credit balance

**On invoice creation**:
- System detects open advance → prompts: *"Customer has LKR 200K advance, apply to this invoice?"*
- One-click apply → balance due = invoice total − applied advance
- Partial application supported

**Advance refund**
- Refundable through any tender method
- Owner approval above threshold

---

## 13. Recurring Invoicing

### 13.1 Template setup
- Customer + items + qty + price + frequency (weekly / monthly / quarterly / yearly) + start/end dates
- **Per-template toggle**:
    - **Auto-post** — fixed amount, posts silently, customer notified
    - **Review queue** — variable amount, generates draft for user review

### 13.2 Variable amount support
- Some recurrings vary monthly (consultant hours, utility-style metered services)
- Template captures item structure; quantities/amounts entered per cycle
- Reminder N days before run — *"Time to enter October consumption for Customer X"*

### 13.3 Lifecycle
- Pause / resume / edit / end-date anytime
- History of all instances
- Failed posting (e.g. customer over credit limit) → flagged, notification to Owner

### 13.4 Customer-facing
- Customer portal shows upcoming recurring schedule
- **Auto-charge if payment method on file** — Phase 2 (needs payment gateway integration)

---

## 14. Customer Portal (Sell-Side Surface)

### 14.1 Login
- Email + OTP (no password — simpler for SL SME customers)

### 14.2 Customer can:
- View invoices (historical, downloadable PDFs, search by date/amount)
- View periodic AR statements (invoices + payments + balance)
- **Pay online** — PayHere / FriMi / Genie / iPay / LankaQR (tenant configures which gateways exposed)
- Download payment receipts
- View standing orders / recurring schedule
- Submit dispute / query (creates support ticket back to tenant)
- Update profile (changes route through tenant approval)
- Download VAT-paid certificates

### 14.3 Customer cannot see
- Tenant's internal pricing / cost data
- Other customers' info
- Tenant's internal accounting ledger

### 14.4 Branding
- Portal white-labelled with tenant's logo + colors
- URL: `yourbiz.platform.com/portal`
- Custom subdomain — Phase 2

---

## 15. Customer Statements

### 15.1 Auto-generated periodic statement
- Frequency: weekly / monthly / on-demand
- **Content**: opening balance + invoices + payments + advances applied + credit notes + closing balance
- **Aging buckets**: 0-30 / 31-60 / 61-90 / 90+ days

### 15.2 Delivery
- Email PDF (auto on schedule)
- Customer portal download
- WhatsApp link — Phase 2

### 15.3 Bulk statement run
- Owner triggers monthly run → system generates 200 statements → emails all customers with email on file
- For customers without email, generates printable batch (A4 PDF, paginated by customer)

---

## 16. Multi-Branch Sales

### 16.1 Branch-stamped transactions
- Every quote/SO/invoice/receipt carries branch where created
- Drives branch-level reporting

### 16.2 Cross-branch fulfilment
- Pettah branch sells to customer; stock from Kandy warehouse
- System identifies stock availability across all warehouses user has access to
- Sale invoiced from Pettah; stock movement: Kandy → in-transit → Pettah → customer
- Inter-branch stock allocation auto-generated (no GL impact, locked in Inventory)

### 16.3 Cross-branch customer balance
- Customer's AR is tenant-wide, not per-branch
- Paid Pettah, owe Kandy → single combined balance

### 16.4 Branch-specific configuration
- Number series per branch (locked in Inventory: `PETTAH-INV-2026-0001`)
- Pricing override per branch (Pettah wholesale vs Kandy retail)
- Tender methods per branch (Galle no cards, Colombo accepts all)

### 16.5 Cross-branch returns
- Customer returns at any branch; system handles, GL stays clean

---

## 17. FX Sales (Light Support)

### 17.1 Scope
Capture invoice in foreign currency with exchange rate; auto-converts to LKR for ledger.

### 17.2 Mechanics
- Customer balance shown in both transaction currency and LKR
- Realized FX gain/loss posted on receipt
- All reports in LKR
- Per-transaction rate override allowed

### 17.3 Use case
SL exporters (textile, gem & jewellery, IT services, BPO) invoicing customers in USD/EUR.

### 17.4 Deferred
- Multi-currency receipts (multiple currencies tendered against one invoice)
- Multi-currency bank accounts
- Full SLFRS-21 multi-currency accounting

---

## 18. Dashboard Widgets

### 18.1 Owner dashboard
- Today's sales (LKR + count + vs yesterday + vs same-day-last-week)
- Sales this month (LKR + % vs target if budget set)
- Top 5 selling items (today / this month)
- Top 5 customers (this month by revenue)
- Top 5 salespeople (this month by commission)
- Outstanding receivables (total + aging snapshot)
- Cash position (across all bank + cash accounts)
- Pending approvals (invoices/credit notes/discounts)
- Low stock alerts (count + drill-down link)
- Bounced cheques to chase (count)

### 18.2 Cashier dashboard
- My sales today (count + LKR)
- Active POS shift status
- Last 5 transactions (quick recall)

### 18.3 Salesperson dashboard
- My commission this month (earned + paid + pending)
- My quotes pipeline (sent / accepted / rejected)
- My customers' outstanding balances (collection focus)

### 18.4 Customizable
- Tenant admin can add/remove/reorder widgets per role
- Individual user can rearrange within their assigned set

---

## 19. Document Templates

### 19.1 Template engine
- Drag-drop builder (logo, header bar, customer block, line items table, totals block, footer with T&Cs, signature block)
- **Variable insertion** — placeholders like `{{customer.name}}`, `{{invoice.total}}`, `{{tax_breakdown}}` resolved at render
- **Multi-language templates** — separate for EN/TA/SI (or auto-translate with manual override per template)
- **Multiple templates per doc type** — assign per customer or pick at print time
- **Template library** — ships 5-8 pre-built professional templates per doc type; tenant clones + customizes
- **Version control** — saved versions, rollback if new version breaks formatting

### 19.2 SL specifics baked into templates
- VAT registration number block (mandatory on tax invoices)
- VAT breakdown table at totals
- Stamp space (for hand-stamping by accountant — many SL companies still do this)
- Bank details block (for customer transfers)
- Mandatory legal text (return policy, jurisdiction clause — tenant configures)

### 19.3 Special templates
- Thermal POS receipt (80mm + 58mm widths)
- A4 / A5 standard print
- Large-format wholesale invoice (long line item lists, continuation pages)

---

## 20. Document Attachments

### 20.1 Attachable per transaction
- Customer's PO copy
- Quotation accepted email / signed copy
- Delivery proof (signed DN photo, courier POD)
- Customer correspondence (WhatsApp screenshot, email thread)
- Approval notes / reason documents
- Cheque image (already linked via Cheque module)
- Bank transfer confirmation slip

### 20.2 Behavior
- Multiple attachments per transaction (sensible per-file cap, e.g. 10 MB)
- Preview inline (PDF / image) without downloading
- Searchable by transaction number, customer, date
- Retained for audit period (configurable, default 7 years per SL audit norms)
- Storage: S3-compatible object storage, tenant-isolated

---

## 21. Audit Trail & Voiding

### 21.1 Posted invoice — financial fields immutable
- Amount, account, tax, date — frozen
- Corrections only via credit note + new invoice OR voiding (with approval)

### 21.2 Editable post-posting
- Customer address (delivery edits)
- Narration / notes
- Internal tags
- Salesperson assignment (for commission corrections)

### 21.3 Edit history
- Visible on every transaction
- Who changed what, when, from-value → to-value
- Comments/reasons captured per edit
- Auditor view shows full edit log

### 21.4 Voiding
- Permission-gated (Owner / Accountant only)
- Reason required (pre-defined codes + free text)
- Voided invoice shown as *VOID* with original number retained (no number reuse — audit-defensible)
- Stock + GL reversed automatically
- Original invoice still findable in search; clearly marked

---

## 22. Integration Touchpoints

### 22.1 Internal modules (built-in)
- **Inventory** — stock decrement, valuation, reorder triggers
- **Accounting** — perpetual GL posting (AR, Revenue, COGS, Tax, Bank/Cash, Customer Advances)
- **Cheque module** (Layer 2) — cheque-tendered payments
- **Customer master + Credit Limits** (Layer 2) — credit checks, advances
- **Payroll** — salesperson commission flows to payslip
- **Cheque book register** (Layer 2) — for issuing refund cheques

### 22.2 External integrations (tenant configures)
- **Payment gateways** — PayHere, FriMi, Genie, iPay, LankaQR (online payments via portal + QR at POS)
- **EDC machines** — manual reference capture only (no real-time integration MVP)
- **Email** — invoice delivery (SMTP per tenant OR platform-managed transactional email)
- **SMS gateway** — Phase 2
- **WhatsApp Business API** — Phase 2
- **Courier APIs** — Pronto, Domex, Aramex SL, Pick Me Flash (e-store fulfilment, Phase 2)

---

## 23. SL-Specific Bakes

- **Currency**: LKR with `Rs. 2,50,000` formatting
- **Phone**: `+94 XX XXX XXXX` auto-format on customer entry
- **NIC**: validation on customer master if captured
- **VAT compliance**: VAT registration number on tax invoice mandatory display, breakdown of VAT/SSCL per invoice
- **Stamp duty** on certain document types (e.g. high-value cash receipts) — auto-applied per rule
- **PayHere / FriMi / Genie / iPay / LankaQR** as native tender methods
- **Thermal printer** support for SL standard receipt sizes (58mm, 80mm)
- **Tax invoice vs simplified invoice** — SL VAT Act distinguishes; system generates correct format based on customer type (registered vs unregistered)
- **Multi-language receipts** — Tamil-script and Sinhala-script support on thermal printers (font-loaded via ESC/POS commands)
- **Avurudu / Christmas seasonal promo presets** — pre-loaded
- **Holiday calendar** — SL holidays auto-loaded (Poya days, Avurudu, Christmas, Vesak etc.) — affects reporting and recurring invoice scheduling

---

## 24. Data Model — Sell Entities (Overview)

```
Tenant
  ├── Customer (1:n) — links to CustomerCreditLimit, CustomerAdvances (Accounting/Layer 2)
  │     ├── CustomerPriceList (1:1 assignment)
  │     ├── CustomerItemOverride (1:n)
  │     ├── CustomerStandingOrder (1:n)
  │     ├── CustomerLoyaltyBalance (1:1)
  │     └── CustomerStatement (1:n historical)
  ├── Quotation (1:n)
  │     ├── QuotationLine (1:n)
  │     └── QuotationVersion (1:n revisions)
  ├── SalesOrder (1:n)
  │     ├── SalesOrderLine (1:n)
  │     ├── SalesOrderReservation (1:n stock holds)
  │     └── SalesOrderBackorder (1:n)
  ├── DeliveryNote (1:n)
  │     ├── DeliveryNoteLine (1:n)
  │     └── DeliveryProof (1:n attachments)
  ├── Invoice (1:n)
  │     ├── InvoiceLine (1:n)
  │     ├── InvoiceTaxBreakdown (1:n)
  │     ├── InvoiceDiscount (1:n)
  │     ├── InvoiceAttachment (1:n)
  │     └── InvoiceEditHistory (1:n)
  ├── ProformaInvoice (1:n)
  ├── CreditNote (1:n)
  │     ├── CreditNoteLine (1:n)
  │     └── CreditNoteRefundMethod (1:1)
  ├── Receipt / Payment (1:n)
  │     ├── PaymentTender (1:n — supports mixed)
  │     └── PaymentApplication (1:n — applied to invoices)
  ├── RecurringInvoiceTemplate (1:n)
  │     └── RecurringInvoiceInstance (1:n generated)
  ├── BatchInvoiceRun (1:n)
  ├── ConsolidatedInvoiceRun (1:n)
  ├── POSTerminal (1:n per branch)
  │     ├── POSShift (1:n with open/close + variance)
  │     ├── POSCashier (1:n PIN-based sign-on)
  │     ├── POSParkedSale (1:n holds)
  │     └── POSZReport (1:n immutable end-of-shift)
  ├── Salesperson (links to User from Layer 2)
  │     ├── CommissionRule (1:n)
  │     ├── CommissionEarning (1:n per transaction)
  │     └── CommissionLedger (1:n earnings + claw-backs + payouts)
  ├── DocumentTemplate (1:n per doc type, multi-language)
  └── SellAuditLog
```

All entities tenant-scoped via Postgres Row-Level Security.

---

## 25. Deferred to Later Phases

- Voice entry on item lines (Tamil/Sinhala/English)
- Real-time EDC integration with card terminals
- WhatsApp Business API delivery (invoices, statements, payment reminders)
- SMS payment links
- Auto-charge for recurring invoices via stored payment method
- Custom subdomains for customer portal
- Digital quotation acceptance via signed link
- Tiered loyalty (Bronze/Silver/Gold), birthday bonuses, referrals, time-bound multipliers
- Multi-currency receipts (multiple currencies tendered)
- Multi-currency bank accounts
- Full SLFRS-21 multi-currency accounting
- Courier API integrations (Phase 2 with E-store module)

---

## 26. Next Steps

Next module specs in queue:
1. **Buy module UX** — Purchase Orders, GRN, Bills, Debit Notes, Expenses, landed cost capture
2. **Migration flow IA** — BUSY/Tally/QuickBooks/Excel onboarding screens
3. **Pricing plan architecture** — Starter / Growth / Scale feature gating + LKR pricing
4. **Super Admin (Layer 1) dashboard spec**
5. **Data model deep dive** — full ERD with RLS policies

---

*Document version: 1.0 · Module: Sell · Scope: Sri Lanka only · Full system (not MVP) · Owner: Automation Practice · Prepared for multi-tenant accounting SaaS (BUSY replacement)*

*Decisions consolidated across 6 rounds covering: three sales patterns (direct invoice / order-to-cash / POS), full document chain (quotation through credit note + proforma), full quotation lifecycle with versioning + conversion, full SO with reservation + partial fulfilment + backorder, DN per-transaction toggle, all 5 invoice modes (standard / recurring / batch / consolidated / proforma), customer selection (existing + walk-in + new with LLM-assist), 7 item entry capture paths, full pricing resolution with display transparency + permission-gated margin visibility, full tax engine (compound VAT+SSCL, exemptions, zero-rated, manual override), full discount engine with permission gates and approval workflow, complete POS one-screen experience with hardware integration + offline mode, all 9 tender methods including mixed, full receipt + invoice template engine with multi-language, full sales return / credit note flow including all POS scenarios, lightweight loyalty with tenant toggle, full commission engine with tenant-customizable rules + Payroll integration, end-of-day cash reconciliation with denomination breakdown + variance reasons + multi-shift, customer advances + recurring invoicing + customer portal + statements, full multi-branch sales (cross-branch fulfilment + tenant-wide AR), light FX-on-Sales support, fully customizable dashboard widgets per role, drag-drop document templates with multi-language and SL-specific bakes, full document attachments, full audit trail with voiding workflow, complete internal + external integration map, comprehensive SL-specific bakes, full data model.*
