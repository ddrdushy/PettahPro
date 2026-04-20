# Business Tenant (Layer 2) Design Spec — Multi-Tenant Accounting SaaS (Sri Lanka)

> Specification for the business tenant experience: how a signed-up business owner and their team interact with their workspace. Second of three governance layers (Platform / Tenant / Tenant Users). Target market: **Sri Lanka only**.

---

## 1. Scope & Context

### Three-layer governance recap
- **Layer 1 — Platform (Super Admin)**: platform owner. One login, sees all businesses, controls platform-wide config. *(Separate spec.)*
- **Layer 2 — Tenant (Business)**: a single signed-up business. Its own data, books, users. Internal admin controls their world within platform limits. *(This document.)*
- **Layer 3 — Tenant Users**: staff with roles. Role-based access inside the tenant. Users can hold multiple roles simultaneously.

### Foundational decisions (locked)
- Single currency: **LKR** throughout
- Languages: English (default), Tamil, Sinhala
- Multi-entity businesses = multiple tenants (3 businesses = 3 separate tenants). Consolidation deferred to enterprise tier.
- **Minimal entry** is a core design principle, not a feature
- OCR stack: Tesseract + OTR (legacy ledgers) + JS barcode/QR + manual + CSV bulk. **No GPU, no voice, no VLM in MVP.**
- WhatsApp integration deferred to post-MVP
- **Multi-role user assignment** is standard; one user routinely holds 2–3 roles
- **Cheques are first-class** — full lifecycle tracking, bounce handling, legal audit trail
- **Petty cash, customer credit limits** are first-class operational modules

---

## 2. Signup & Onboarding

### 2.1 Signup
- Email + mobile (+94) with OTP via SMS
- Password + optional social login (Google, Microsoft)
- Agree to T&Cs
- Land in fresh empty workspace — this is their tenant

### 2.2 Setup wizard (5 steps, all skippable)

**Step 1 — Business profile**
- Business name, registration number (optional)
- Address, contact phone/email
- VAT registration number (if registered)
- SSCL applicability toggle
- Fiscal year start (April 1 default for most SL businesses; configurable)
- Base currency: LKR (locked)
- Language preference

**Step 2 — Industry template**
Owner picks one:
- Textile Wholesale
- Pharmacy
- Grocery
- Clinic
- Salon
- Restaurant
- General SME

Pre-loads automatically: industry-appropriate Chart of Accounts, tax codes (VAT 18%, SSCL, zero-rated, exempt), invoice/receipt/GRN templates, report suite, default SKU categories, common expense heads.

**Step 3 — Branches & warehouses**
- Default: one branch + one warehouse, tied
- Optionally add more branches, more warehouses
- Business defines the mapping (see section 3)

**Step 4 — Team invite**
- Add users by email/phone
- Assign one or more roles per user (multi-role from day one — see section 4)
- Invitee sets own password on first login

**Step 5 — Starting point**
- *Fresh start* → straight to dashboard
- *Migrate from BUSY / Tally / QuickBooks / Excel* → branch into migration flow *(separate spec)*

### 2.3 Onboarding checklist (post-wizard, lives on dashboard)
Disappears at 80% complete or after 30 days:
- [ ] Add your first customer
- [ ] Add your first item/SKU
- [ ] Create your first invoice
- [ ] Record a payment (including cheque)
- [ ] Invite a team member
- [ ] Set opening balances (optional)

**Activation metric**: first invoice posted.

---

## 3. Tenant Hierarchy & Data Isolation

### 3.1 Tenant = one set of books
One tenant = one legal entity = one ledger = one VAT number. Businesses with multiple legal entities register separate tenants. Consolidation across tenants deferred to future enterprise tier.

### 3.2 Branches
Commercial locations — shops, showrooms, offices where sales happen. Share the same set of books. Separate numbering series per branch supported.

### 3.3 Warehouses
Stock locations — godowns, storerooms, stockrooms. **Independent entity** from branches.

### 3.4 Branch ↔ Warehouse mapping (flexible, business decides)

Relationship defined in a `branch_warehouse_access` join table with read / write / transfer permissions:

| Pattern | Description | Real-world example |
|---|---|---|
| **Tied** | Each warehouse serves exactly one branch | Textile wholesaler — Pettah branch has upstairs godown, Kandy branch has its own. No stock movement between them. |
| **Central** | One warehouse serves multiple branches | Pharma distributor — single Orugodawatta warehouse supplying 4 Colombo branches |
| **Mixed** | Central + local warehouses | Retail chain — central DC + Galle branch has own stockroom for quick-moving SKUs |

### 3.5 Data isolation
- Postgres Row-Level Security (RLS) per tenant
- Users see only data in their assigned branch(es); Accountants/Owners see all
- Immutable audit log per tenant, time-stamped

---

## 4. Roles & Permissions

### 4.1 Preset roles

| Role | Typical user | Primary access |
|---|---|---|
| Owner | Business owner | Everything. Invite/remove users, change settings, approve. |
| Accountant | CA, auditor, in-house accountant | Full accounts, reports, journals, reconciliation, VAT return |
| Cashier | POS operator, front-desk | POS, create invoice, record payment. No reports. |
| Sales | Salesperson, sales manager | Quotations, sales orders, customers, pipeline, own commission |
| Stock Keeper | Store/godown staff | Inventory, GRN, stock transfers, stock count |
| **Labour** | Daily/monthly wage worker, factory hand | Usually no UI login. Present via attendance records only. |
| HR | HR admin, office manager handling staff | Employees, payroll, attendance, leave, expense claims |
| View-only | External auditor, advisor | Read-only across modules |

### 4.2 Multi-role assignment (core design)

**Reality**: in SL SMEs, one person routinely wears 2–3 hats. Owner is also Accountant is also HR. The system is designed around this, not fighting it.

**Model**: additive (union)
- A user can hold any number of roles simultaneously
- Effective permissions = **union of all assigned roles**
- Most permissive wins — if any role grants an action, user can do it
- No explicit deny — keeps it simple and predictable (same pattern as Google Workspace, Notion, Linear)

**Example**:
| User | Roles | Effective access |
|---|---|---|
| Ayesha (shop owner) | Owner + Accountant + HR | Full |
| Nimal (branch manager, Pettah) | Cashier (Pettah) + Sales (all) + Stock Keeper (Pettah + Kandy warehouses) | Union across assigned scopes |
| Priya (bookkeeper + HR assist) | Accountant + HR | Accounts + payroll/attendance |

### 4.3 Per-role scoping

Each role assigned to a user can have its own scope:
- **Global** — all branches and warehouses
- **Branch-specific** — only listed branches
- **Warehouse-specific** — only listed warehouses

Scope restrictions apply per-role; the role union determines *what* the user can do, the scope determines *where*.

### 4.4 UI pattern

**User edit screen**:
- Roles shown as chips/pills — each chip shows role name + scope summary
- `+ Add role` dropdown → presets + custom roles
- Per-role scope picker inline (multi-select branches/warehouses)
- **Effective permissions preview** — toggleable panel: *"What can this user actually do?"* lists the resolved permission set after union. Sanity check before save.

### 4.5 Role customization
Tenant admin can:
- Clone and edit preset roles
- Create custom roles (e.g. *"Branch Manager — Kandy"*)
- Assign multiple roles to a user
- Restrict by branch / warehouse per role
- Restrict by module

### 4.6 Approval workflows & self-approval

**Approval thresholds (configurable per tenant):**
- Invoices above LKR X need Owner approval
- Purchase orders above LKR Y need 2-step approval
- Payroll processing requires Owner sign-off
- Stock adjustments over X% need Accountant review
- Cheque issuance above LKR Z needs Owner approval

**Self-approval handling:**
When the approver and the actor are the same user (common in small tenants where Owner = Accountant):
- **Default**: auto-approve silently. Single-owner SMEs shouldn't be blocked by ceremony.
- **Optional toggle per workflow**: *"Require a different approver"* — for larger tenants with external audit constraints.

### 4.7 Segregation of Duties (SoD) — Phase 2

Classic audit concern (e.g. same person creating + approving a PO). Shipped in Phase 2 as non-blocking warnings: *"⚠️ User X has overlapping roles that may create segregation concerns."* Aimed at larger tenants whose external auditors care.

### 4.8 Audit trail

- Every action logs **user ID only** (not "which role they were wearing") — simpler, cleaner, role history recoverable via `RoleAuditLog`
- **Role changes always logged**: admin who changed, user affected, role added/removed, scope change, timestamp, optional reason
- Essential for *"why did this person have access six months ago?"* forensic queries

### 4.9 Bonus — external accountant access
- External CA gets Accountant role assignment
- **Time-bounded access** (expires after N days, renew on reassignment) — Phase 2
- View-only role available for auditors during audit window

---

## 5. Attendance Tracking

### 5.1 Why first-class
Many SL businesses employ Labour and casual workers whose wages depend on daily attendance. Paper muster rolls and punch cards are error-prone. Attendance must flow directly into Payroll.

### 5.2 Capture methods (tenant picks one or more)

| Method | How it works | Best for |
|---|---|---|
| **QR check-in** | Supervisor's phone shows QR; worker scans/taps NFC | Labour-heavy sites with mobile-equipped supervisor |
| **Biometric device — live integration** | Polls existing ZKTeco / Suprema hardware via API | Factories, offices with network-connected devices |
| **Biometric file import** | Admin uploads CSV/Excel export from device | Standalone biometrics (majority of SL deployments) |
| **Geofence + photo** | Supervisor marks team present with geotagged group photo | Construction, remote sites |
| **Manual muster** | Supervisor enters attendance end-of-day | Low-connectivity sites |
| **Self check-in** (web/mobile) | Employee with login clicks Check In / Out | Office staff, sales team |

### 5.3 Data captured per record
- Employee ID (ours) + source device ID (theirs, for biometric)
- Timestamp (in/out)
- Location (GPS coordinates or branch/site ID)
- Method used
- Photo (if applicable)
- Supervisor who marked attendance (if applicable)

### 5.4 Biometric file import — detailed flow

Most SL shops already run standalone biometrics. We meet them where they are.

**Supported formats (launch):**
- **CSV / TXT** — almost all devices
- **Excel (XLSX)** — ZKTeco, eSSL reports

**Deferred:**
- `.DAT` / `.KQ` / `.AttLog` proprietary binary formats (Phase 2)
- Live API / webhook push from modern WiFi devices (Phase 2)

**Import flow:**
1. **People → Attendance → Import** (manual upload; scheduled SFTP import in Phase 2)
2. Upload file — drag/drop or browse
3. **Auto-detect format** (common biometric export templates recognized) OR user picks a saved mapping template
4. **Field mapping screen**: columns → schema (Employee ID, In Time, Out Time, Device ID, etc.)
5. **Employee match screen**: biometric device IDs ↔ our employee records. System suggests matches; user confirms/corrects. Mapping saved to `BiometricEmployeeMap` for future imports.
6. **Preview** — first 20 rows with parsed values, duplicates flagged, errors highlighted
7. **Commit** — idempotent (re-upload won't double-count; keyed on employee + timestamp + device)
8. **Import log** — who imported, when, row count, error count, source file stored

### 5.5 Device registry

Per tenant, `DeviceRegistry` tracks:
- Device name (e.g. *"Main gate ZKTeco"*, *"Office 2nd floor eSSL"*)
- Location (branch/warehouse)
- Export format + saved column template
- Last import timestamp
- Link to `BiometricEmployeeMap`

Second import from the same device is trivial — template and mappings are already learned.

### 5.6 Validation & exception handling
- Unknown biometric IDs → flag, skip those rows (user maps them, re-runs)
- Duplicate timestamps → keep, flag for review (often means multiple punches)
- Missing out-time (forgot to punch out) → exception report, supervisor resolves
- Impossible patterns (same employee on two devices at different sites within minutes) → flag
- Date outside current pay period → warn, allow override with reason

### 5.7 Reconciliation across methods
A tenant might use biometric for factory floor + QR for supervisors + manual muster for remote sites. System deduplicates (same employee, same day can't be marked via two methods without flagging) and consolidates into one unified attendance record per employee per day, feeding payroll.

### 5.8 Flow into Payroll
- **Daily wage**: attendance × daily rate
- **Piece rate**: attendance × units × piece rate
- **Monthly salary**: used for LOP (loss of pay) calculation
- EPF (employee + employer), ETF, PAYE auto-computed on final wage

---

## 6. Cheque Management

### 6.1 Why first-class
Cheques in Sri Lanka are not just a payment method — they are a **credit instrument**. Post-dated cheques function as supplier credit lines. Bounces are common. Disputes escalate legally under the **Bounced Cheques Act** (Act No. 7 of 1998) where cheque records become admissible evidence for debt recovery. Any serious SL accounting tool must treat cheques with a watertight audit trail.

### 6.2 Cheque lifecycle — states

Every cheque moves through states; accounting entries happen at each transition:

| State | Description | Accounting impact |
|---|---|---|
| **Received** / **Issued** | Cheque in hand (from customer) or written (to supplier) | Contingent — not yet in bank book |
| **Post-dated holding** | Future-dated; held for deposit date | No cash movement yet |
| **Deposited** | Physically banked, pending clearance | Debit bank-in-transit (clearing account) |
| **Cleared** | Bank confirms funds in/out | Debit bank, credit clearing |
| **Returned / Bounced** | Bank returns unpaid | Reverse clearing, reinstate debtor + record return fee |
| **Stopped** | Payer instructs bank to stop | Reverse + flag for follow-up |
| **Cancelled** | Destroyed before presenting | Reverse commitment; no accounting if not deposited |
| **Replaced** | Returned cheque replaced with a new one | Link old → new, carry dispute history |
| **Stale** | >6 months old; invalid per SL banking law | Auto-flag; force owner action |

Every state change logs timestamp + user. This is the audit trail.

### 6.3 Data captured per cheque

**Received cheques:**
- Cheque number, payer bank, branch, account holder name
- Amount, currency (LKR)
- Date on cheque (distinct from date received)
- Date received
- From customer/party (linked to ledger)
- Linked to invoice(s) being settled
- Image of cheque face (front + back if endorsed)
- Planned deposit date (for post-dated)
- Deposited to which bank account
- Physical location (branch/safe/file number) — critical for audits

**Issued cheques:**
- Cheque number (from our cheque book), issuing bank account
- Amount, currency, date on cheque
- To supplier/party (linked to ledger)
- Linked to bill(s) being paid
- Issued by user + approved by user (approval workflow applies)
- Collected by (name + NIC of collecting representative — common SL practice)
- Print status (printed from system vs hand-written)

### 6.4 Key operational flows

**Receive cheque from customer**
Customer pays → *Receive Payment* → select *Cheque* → enter details OR scan image (MICR auto-read deferred; manual entry now) → select invoices being settled → cheque enters *Holding* (post-dated) or *Ready to Deposit* (current-dated).

**Deposit run (daily/weekly)**
Cheque Register → filter *Ready to Deposit* → select cheques → generate deposit slip (printable) → mark batch as *Deposited* with deposit date + bank slip reference. Entry: debit bank-in-transit, credit receivables clearing.

**Bank clearance matching**
Bank statement upload/fetch → auto-match credit entries against deposited cheques → mark cleared. Unmatched after 3 days → flag for review.

**Cheque return handling (the painful one)**
Mark *Returned* with reason code (insufficient funds / signature mismatch / stop payment / other) and bank charge. System automatically:
- Reverses clearing entries
- Reinstates debtor's balance
- Posts return charge (debit customer / credit bank charges income)
- Notifies Owner + Accountant
- Updates customer's **credit risk flag** (see section 8)
- Offers inline "Record replacement cheque" — links old → new

**Post-dated cheque calendar**
Dedicated view: upcoming deposits by day/week. Cashier sees tomorrow's deposits in today's dashboard. Owner receives email/SMS reminder at configurable lead time.

### 6.5 Cheque book management (issued side)
- Register multiple cheque books per bank account
- Track used / unused / cancelled cheques per book
- Prevent out-of-sequence issuance (with override for lost/damaged)
- Alert when running low (< N leaves remaining)

### 6.6 Reports and controls
- Cheques in hand (by branch, by age)
- Cheque register (issued + received, full history)
- Post-dated cheque maturity calendar
- Returned cheques log (by reason code)
- **Customer bounce history** — key business intelligence
- Cheque book register (issued side)
- Stale cheque alerts (>5 months — prompt for reissue before 6-month legal invalidation)
- Stop payment list

### 6.7 Minimal-entry angle
- Scan cheque image with manual entry alongside (MICR auto-read deferred)
- **Bulk receive** — customers paying with multiple post-dated cheques in one visit (common in wholesale)
- Quick-create from invoice screen — sidebar *"Customer paying by cheque"*, fill 4 fields, done

### 6.8 Integrations — later phase
- **Positive-pay file generation** — upload issued cheque list to bank, bank only clears matching ones (HNB, Commercial Bank support this for corporates)
- **Direct bank statement feed** matching (when SL banks open reliable APIs)

---

## 7. Petty Cash Management

### 7.1 Why dedicated
SL shops run on petty cash floats per branch — cashier takes cash, gives small advances, buys tea/stationery/fuel, reconciles with receipts at day end. Forcing every petty transaction through formal journal entries breaks the flow. A dedicated sub-module under **Money** handles it cleanly.

### 7.2 Floats per branch
- Each branch maintains a `PettyCashFloat` with a defined ceiling (e.g. LKR 50,000)
- Float holder assigned (usually a specific cashier/supervisor)
- Starting balance + top-up history + transactions = current balance

### 7.3 Top-up flow
1. Float runs low
2. Float holder requests top-up
3. Owner/Accountant approves
4. Main cash / bank → petty cash transfer posted
5. Float balance restored

### 7.4 Daily transactions
- Expenses (receipt-backed) — Tesseract OCR for receipt capture where feasible, else manual
- Small cash advances to staff
- Quick purchases (fuel, tea, stationery, milk)
- Return of unused advance

### 7.5 End-of-day reconciliation
- Float holder counts physical cash
- System shows expected balance (opening + top-ups − disbursements)
- Variance flagged; reason captured
- Variance posted to cash-shortage/overage account

### 7.6 Reports
- Petty cash ledger per branch
- Top-up history
- Expense categorization from petty cash
- Variance trend per float holder

---

## 8. Customer Credit Limits

### 8.1 Why
Wholesale and B2B sales extend credit by default. Without limits, bad debts build silently. Linked directly to the cheque-bounce data (section 6): customers with bounce history are high risk — system should react automatically.

### 8.2 Per-customer limit setting
On customer master:
- **Credit limit** (LKR amount)
- **Credit period** (days — e.g. 30/45/60 net)
- **Manual hold flag** (Owner-set, freezes customer)
- **Auto-computed exposure**: sum of unpaid invoices + unrealized cheques (post-dated cheques not yet cleared)

### 8.3 Auto-block on exceed
When creating a new invoice for a customer:
- If (current exposure + new invoice) > limit → **block + show override workflow**
- Override requires Owner approval with reason logged
- Override is single-transaction (doesn't raise the permanent limit)

### 8.4 Bounce-driven auto-review

When a cheque bounces (section 6.4):
- Customer's bounce count increments
- **After 2 bounces in 90 days** → customer auto-flagged for Owner review
- Flag suggests: freeze credit, reduce limit, or require advance payment
- Owner action logged

### 8.5 Owner override
- Owner can manually raise/lower any limit
- Reason required
- Change logged in customer history

### 8.6 Reports
- Customers over limit
- Customers at >80% of limit (early warning)
- Bounce history by customer
- Credit limit change history

---

## 9. Modules & Navigation

### 9.1 Navigation uses action verbs, not nouns
Designed for shopkeepers who think in actions (*"I need to sell"*), not accountants who think in entities (*"Invoice entity"*):

- **Sell** — Quotations, Sales Orders, Invoices, Credit Notes, POS
- **Buy** — Purchase Orders, GRN, Bills, Debit Notes, Expenses
- **Inventory** — Items, Stock on hand, Transfers, Adjustments, Stock count
- **Money** — Bank accounts, Reconciliation, Cash in/out, Cheques, Petty Cash, Payment links
- **People** — Customers (with credit limits), Suppliers, Employees
- **Accounts** — Journals, Trial Balance, P&L, Balance Sheet, VAT Return
- **Reports** — Sales, Purchase, Stock, Debtors aging, Cheque register, Bounce history, Custom reports
- **Settings** — Business configuration

### 9.2 Module availability by plan (platform-controlled)
Starter / Growth / Scale tiers progressively unlock: POS, Manufacturing / BOM, Payroll, E-store, Multi-branch, Advanced approvals, API access. *Plan definitions live at Layer 1.*

---

## 10. Minimal-Entry Design Principle

### 10.1 The pattern
Every transaction has two entry modes, with capture as the default:

1. **Primary (default)** — Capture first: scan / photo / upload / barcode / CSV. System extracts, shows draft, user confirms.
2. **Secondary (fallback)** — Manual form. Clean, keyboard-first, hidden behind a smaller *"or enter manually"* link.

The big button on each module's main page is **"Capture Invoice"** (camera icon), not *"New Invoice"*.

### 10.2 Capture source by transaction type

| Transaction | Primary capture | Extracted | Accuracy (Tesseract + OpenCV) |
|---|---|---|---|
| Sales invoice (own) | Manual form (keyboard shortcuts, barcode) | — | 100% |
| Purchase bill (printed) | Photo / PDF scan | Supplier, bill#, date, total, tax | 85–90% on headers |
| Expense receipt | Photo of receipt | Vendor, date, amount | 60–80% |
| GRN / delivery note | Barcode scan + manual qty | Item, qty | 100% (barcode) |
| New item / SKU | Barcode scan (JS in-browser) | Barcode, product lookup | 100% |
| Cheque received | Scan image + manual entry (MICR specialist deferred) | Image stored; data manual | — |
| Cheque issued | Printed from system (skip handwrite + entry) | — | 100% |
| Bank statement | PDF upload → Tesseract → parse | Line items, amounts | 70–85% |
| Stock count | Barcode scan on mobile | Item, counted qty | 100% |
| Opening balances | CSV / Excel upload | Full trial balance | 100% |
| Legacy ledger book | Photo → OTR (grid detect) → Tesseract | Rows, columns, values | Variable |
| Biometric attendance | CSV / Excel file import | Employee ID, timestamps | 100% (structured) |

### 10.3 Keyboard-first manual entry (the fallback still has to beat BUSY)
- Tab order tuned for natural data flow
- Recent items / customers / suppliers in dropdown
- Auto-complete from transaction history
- Keyboard shortcuts (Alt+S save, Alt+N new, Alt+P post)
- Sticky defaults (last VAT rate, last payment mode)
- Mobile keypad for amount fields (numeric-only)
- Inline validation — no modal alerts

### 10.4 Bulk import (where minimal-entry really wins)
- CSV / Excel upload for items, customers, suppliers, opening balances, bulk transactions, attendance
- AI-assisted field mapping (shared logic with migration flow)
- Preview + validation before commit
- Idempotent re-upload (update existing, create new)

---

## 11. OCR Stack (CPU-only, No GPU)

### 11.1 Tools in scope

| Tool | Role | License | Runtime |
|---|---|---|---|
| **Tesseract** | Primary OCR for printed text | Apache 2.0 | CPU |
| **OpenCV** | Preprocessing (deskew, denoise, threshold) | Apache 2.0 | CPU |
| **OTR** (ulikoehler) | Table structure detection for legacy ledgers | GPL-3.0 (SaaS-safe: server-side only) | CPU |
| **ZXing / QuaggaJS** | Barcode / QR scanning in-browser | Apache 2.0 | Browser |

### 11.2 Languages
- English (`eng`) — native
- Tamil (`tam`) — Tesseract language pack
- Sinhala (`sin`) — Tesseract language pack
- Tenant preference loaded per session

### 11.3 Pipeline

```
User captures document (camera / upload / drag-drop)
    │
    ▼
DocumentIngestion record (tenant-scoped, S3-compatible object storage)
    │
    ▼
BullMQ queue
    │
    ▼
Classifier: invoice / receipt / ledger / cheque / unknown
    │
    ▼
OpenCV preprocessing: deskew, denoise, adaptive threshold
    │
    ▼
Route:
    ├── Ledger book  → OTR (cells)  → Tesseract (per cell)
    ├── Cheque        → image stored, user enters data manually
    └── Everything else → Tesseract direct
    │
    ▼
Parser maps extracted text → transaction fields
    │
    ▼
Confidence score per field
    │
    ▼
Draft shown to user (low-confidence fields highlighted yellow)
    │
    ▼
User confirms / edits → posted to ledger
    │
    ▼
Document linked to transaction for audit
```

### 11.4 What works / what doesn't (honest expectations)

| Scenario | Accuracy | UX guidance |
|---|---|---|
| Clean printed invoice (A4 laser) | 90%+ on headers | Fast confirm — great |
| Thermal receipt (POS printer) | 60–80% | Some correction — acceptable |
| Handwritten docket | <40% | UI prompts user to manual-enter instead |
| Mixed English + Tamil/Sinhala | Variable | Acceptable for simple cases |
| Messy photo (angled, shadow, blur) | <50% | UI asks user to retake |
| Cheque (printed fields + signature) | Image captured; MICR read deferred | Manual entry with image preview |

Clear UI messaging — when confidence is low, **suggest manual entry** rather than force correction. Respecting the user's time > forcing OCR on everything.

### 11.5 Deferred to Phase 2 (when revenue justifies)
- Chandra (GPU + OpenRAIL-M licensing constraint above $2M revenue)
- Voice entry (Tamil/Sinhala Whisper or similar)
- Cheque MICR E-13B reading
- VLM fallback for complex documents
- Handwriting-capable OCR

---

## 12. What Tenant Admin Can / Can't Configure

### 12.1 Tenant admin controls (full freedom within tenant)
- Business profile, logo, letterheads
- Invoice / receipt / GRN / cheque template layouts
- Chart of accounts (add, merge, rename, deactivate)
- Tax code applicability within SL framework
- Users, roles, permissions (including custom roles + multi-role assignment + per-role scoping)
- Branches, warehouses, mapping
- Price lists, discount rules, customer credit limits
- Approval workflows and thresholds (including self-approval behavior)
- Email / SMS templates (invoice delivery, reminders, statements, cheque notifications)
- Number series per document type per branch
- Cheque book registration (per bank account)
- Petty cash float ceilings and holders
- Biometric device registry and employee mappings
- Financial year, period locks
- Integration connections (PayHere, bank feeds, courier APIs)
- Module toggles *within their plan*
- Notification preferences per user

### 12.2 Platform-locked (controlled at Layer 1)
- Subscription plan definitions & LKR pricing
- Module availability by plan
- SL VAT rate value (when govt changes from 18% → 15%, pushed platform-wide to all tenants)
- Database structure
- URL / routing
- Other tenants' data (complete isolation)

---

## 13. Role-Based Experience Examples

Five representative experiences — each driven by role union × device:

### 13.1 Cashier on phone (morning shop opening)
Login → POS tile front and center → today's sales counter → quick invoice / payment buttons → cheque received tile (post-dated cheques due today highlighted). No reports, no accounting access.

### 13.2 Accountant on laptop (end of day)
Login → Accounts dashboard → unreconciled bank items → cheque clearance matching queue → approval inbox → draft VAT return → export for auditor.

### 13.3 Owner on phone (evening, from home)
Login → Executive dashboard → today's sales, cash position, top debtors, low stock, bounced cheques needing action, pending approvals → one-tap approve/reject.

### 13.4 Stock Keeper on tablet (warehouse floor)
Login → Inventory → barcode scan for incoming GRN → stock transfer between warehouses → end-of-day count.

### 13.5 Ayesha — Owner + Accountant + HR (multi-role, small shop)
Single login → combined dashboard: today's sales, approval inbox, draft VAT return tile, payroll due reminder, attendance exceptions (missing punch-outs), bounced cheques to chase. She switches contexts without logging out — all modules resolve off her union of permissions. Her activity log shows every action attributed to her user ID; role-context is not something she has to think about.

---

## 14. Exit Ramps (Trust Fundamentals)

Critical in a market where shopkeepers are switching *from* long-trusted BUSY. Trust fails fast if these are hidden or missing:

- **Data export anytime** — full backup as ZIP of CSVs + linked PDFs (invoices, receipts, GRNs, cheque images)
- **Cancel subscription** clearly in billing page, not buried
- **Downgrade between plans** without data loss (locks modules not in new plan; data preserved)
- **Pause subscription** for seasonal businesses (keep data read-only, stop billing)
- **Account deletion** with 30-day grace period for recovery

---

## 15. Sri Lanka-Specific Baked-In

- **Currency**: LKR only. Display `Rs. 2,50,000` (comma format per SL convention).
- **Phone**: `+94 XX XXX XXXX` with auto-format on input.
- **Date**: DD/MM/YYYY.
- **Fiscal year**: April 1 – March 31 default (configurable).
- **Tax terms**: VAT, SSCL, PAYE, stamp duty.
- **Payroll**: EPF (employee + employer contributions), ETF, PAYE tax slabs.
- **Payment gateways** (integration-ready): PayHere, iPay, FriMi, Genie, LankaQR.
- **Bank feeds** (integration roadmap): Commercial Bank, HNB, Sampath, BOC, People's, NDB, NSB.
- **Courier APIs** (for E-store later): Pronto, Domex, Aramex SL, Pick Me Flash.
- **Hosting**: Singapore AWS region (low-latency to SL, acceptable under SL data protection norms).
- **Bounced Cheques Act compliance**: cheque records, images, and state-change audit logs retained with immutable trail, admissible as evidence in debt-recovery proceedings. Tenant data export includes full cheque dossier per customer on demand.

---

## 16. Data Model — Key Entities (Overview)

High-level; full ERD to be specified in a separate data-model document.

```
Tenant
  ├── BusinessProfile (1:1)
  ├── Branches (1:n)
  ├── Warehouses (1:n)
  ├── BranchWarehouseAccess (n:n with read/write/transfer permissions)
  ├── Users (1:n)
  │     └── UserRole (n:n with scope: global | branch-list | warehouse-list)
  ├── RolePreset (1:n, customizable)
  ├── RoleAuditLog (1:n)
  ├── ChartOfAccounts (1:n)
  ├── TaxCodes (1:n, SL preset + custom)
  ├── NumberSeries (1:n per doc type per branch)
  ├── ApprovalWorkflows (1:n)
  ├── Customers (1:n)
  │     └── CustomerCreditLimit (1:1 with bounce counter + exposure computation)
  ├── Suppliers (1:n)
  ├── Employees (1:n)
  ├── Items / SKUs (1:n)
  ├── StockLedger (1:n, tied to Warehouse)
  ├── Transactions (1:n: Invoices, Bills, Payments, Journals, ...)
  ├── ChequeLedger (1:n received + issued)
  │     ├── ChequeStateHistory (1:n audit trail)
  │     └── ChequeBookRegister (1:n per bank account, issued side)
  ├── PettyCashFloat (1:n per branch)
  │     └── PettyCashTransaction (1:n)
  ├── AttendanceRecords (1:n)
  ├── DeviceRegistry (1:n biometric devices)
  │     └── BiometricEmployeeMap (1:n device_id ↔ employee_id)
  ├── AttendanceImportLog (1:n)
  └── DocumentIngestions (1:n, linked to Transactions)
```

Postgres Row-Level Security enforces tenant isolation on every query. Tenant ID injected from JWT claim at the middleware layer — impossible to accidentally query across tenants.

---

## 17. Next Steps

Candidate follow-ups:

1. **Super Admin (Layer 1) dashboard spec** — platform governance, tenant lifecycle, subscription management, platform-wide configuration, migration ops
2. **Data model deep dive** — full ERD with tables, columns, relationships, RLS policies (including new cheque, petty cash, credit limit, biometric entities)
3. **Module-by-module UX spec** — starting with Sell (invoicing + POS), which is the activation path
4. **Migration flow IA** — BUSY/Tally/QB/CSV import screens and AI-assisted field mapping
5. **Pricing plan architecture** — Starter / Growth / Scale definitions, feature gates, LKR pricing
6. **Cheque module deep dive** — UX screens, state transition diagrams, return-handling flow mockups

---

*Document version: 2.0 · Scope: Sri Lanka only · Layer: 2 (Business Tenant) · Owner: Automation Practice · Prepared for multi-tenant accounting SaaS (BUSY replacement)*

*Changes from v1.0: Added multi-role user model (additive union + per-role scoping), Cheque Management as first-class module with full lifecycle and bounce handling, Biometric file import as attendance capture method with device registry, Petty Cash Management module, Customer Credit Limits module, expanded data model, Bounced Cheques Act compliance note.*
