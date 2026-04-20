# PettahPro — UX Patterns & Screens

> The behavior and flow specification. Information architecture, navigation taxonomy, interaction patterns, content/microcopy library, PettahPro-specific UX decisions, and screen-by-journey annotated specifications. This is what product designers and developers reference when deciding "how should this flow work" — the rules of the road for every interaction in PettahPro. Scope: Sri Lanka only.

---

## Table of Contents

1. [Information architecture](#1-information-architecture)
2. [Navigation taxonomy](#2-navigation-taxonomy)
3. [Interaction patterns](#3-interaction-patterns)
4. [Content and microcopy library](#4-content-and-microcopy-library)
5. [PettahPro-specific UX decisions](#5-pettahpro-specific-ux-decisions)
6. [Keyboard shortcuts](#6-keyboard-shortcuts)
7. [Mobile adaptations](#7-mobile-adaptations)
8. [Journey 1 — Signup to first invoice](#8-journey-1--signup-to-first-invoice)
9. [Journey 2 — Daily operational flow](#9-journey-2--daily-operational-flow)
10. [Journey 3 — Monthly close](#10-journey-3--monthly-close)
11. [Journey 4 — Payroll run](#11-journey-4--payroll-run)
12. [Journey 5 — Tenant admin](#12-journey-5--tenant-admin)
13. [Journey 6 — Super Admin platform](#13-journey-6--super-admin-platform)
14. [Mobile-first journeys](#14-mobile-first-journeys)

---

## 1. Information architecture

### 1.1 Top-level mental model

PettahPro organizes around three perspectives:

1. **What the business does** — Sell, Buy, Inventory, Accounting, Payroll
2. **Who's involved** — People (customers, suppliers, employees, users)
3. **How it's configured** — Settings (company, tax, branches, integrations)

This maps to an 8-section sidebar (from Tenant Admin UX spec):

```
Dashboard
├── Sell
│   ├── Invoices
│   ├── Quotations
│   ├── Sales orders
│   ├── Credit notes
│   ├── Customers
│   ├── POS
│   └── Reports (sales analytics)
├── Buy
│   ├── Bills
│   ├── Purchase orders
│   ├── Purchase requisitions
│   ├── GRNs
│   ├── Debit notes
│   ├── Suppliers
│   └── Reports (purchase analytics)
├── Inventory
│   ├── Items
│   ├── Stock movements
│   ├── Stock take
│   ├── Warehouses
│   ├── Valuation
│   └── Reports (stock analytics)
├── Accounting
│   ├── Journal entries
│   ├── Chart of accounts
│   ├── Bank reconciliation
│   ├── Fixed assets
│   ├── Tax returns (VAT, WHT)
│   ├── Period close
│   └── Reports (financial statements)
├── Payroll
│   ├── Employees
│   ├── Payroll runs
│   ├── Leave
│   ├── Loans
│   ├── Bonuses
│   ├── Expense claims
│   ├── Statutory returns
│   └── Reports (payroll analytics)
├── People
│   ├── Users & roles
│   ├── Customers (cross-link)
│   ├── Suppliers (cross-link)
│   └── Employees (cross-link)
├── Integrations
│   ├── Banks
│   ├── POS hardware
│   ├── Biometric devices
│   ├── WhatsApp (Phase 2)
│   └── Webhooks & API
└── Settings
    ├── Company
    ├── Branches & warehouses
    ├── Tax configuration
    ├── Number series
    ├── Approval workflows
    ├── Notification preferences
    ├── Subscription & billing
    ├── Audit log
    └── Danger zone
```

### 1.2 Cross-linking

Entities appear in multiple sections. Users should land on the right context:

- **Customer record** accessible from: Sell → Customers (primary), People → Customers (alternate), any invoice linking
- **Employee record** accessible from: Payroll → Employees (primary), People → Employees, any payslip
- **Chart of accounts** accessible from: Accounting (primary), Settings → Company config (for first-time setup)

### 1.3 Search architecture

Global search (top bar) returns results from:
- Customers, suppliers, employees (by name, code, phone, NIC, VAT)
- Invoices, bills, receipts, payments (by number, customer/supplier name)
- Items (by name, code, barcode)
- Journal entries (by reference, narration)
- Users (by name, email)
- Help center articles

Results grouped by type, with count. Keyboard navigable. Enter opens the selected result.

### 1.4 Breadcrumb patterns

Consistent pattern: `Module > List > Detail`

Examples:
- `Sell > Invoices > INV-2026-0342`
- `Buy > Purchase orders > PO-2026-0015`
- `Payroll > Runs > April 2026`
- `Settings > Branches & warehouses > Pettah Main`

Max depth: 4 levels. Beyond 4, use tabs within the deepest level.

### 1.5 URL structure

Clean, hierarchical, lowercased, kebab-case:

```
pettahpro.lk/
  app/
    dashboard
    sell/
      invoices
      invoices/{uuid}
      invoices/new
      customers
      customers/{uuid}
      pos
    buy/
      bills
      purchase-orders/{uuid}
    accounting/
      period-close
      tax-returns/vat
    payroll/
      runs/{uuid}
    settings/
      branches
      subscription
```

---

## 2. Navigation taxonomy

### 2.1 Sidebar structure and behavior

**Default state**: Full sidebar (240px) with text + icons for each nav item.

**Collapsible**: User can collapse to icon-only rail (64px) via a toggle. Preference persists per user.

**Nav sections**: 8 top-level sections (from 1.1). Each section can expand/collapse its sub-items.

**Active indicator**: Active section/sub-item highlighted in mint (solid fill on active, mint hover on others).

**Counts**: Sub-items can show counts when relevant (e.g., "Pending approvals (3)"). Counts are text-tertiary small.

**Sticky bottom items**: Help, Settings, User menu always stay at bottom of sidebar.

### 2.2 Top bar behavior

**Fixed position**: Always visible when scrolling. 56px height.

**Search**: Centered-ish. Keyboard shortcut `/` to focus.

**New dropdown**: Quick-create menu:
- New invoice
- New bill
- New customer
- New supplier
- New item
- New quotation
- ...

The "New" list is contextually relevant to user's current role (a Cashier only sees relevant items).

**Notifications bell**: Red dot when unread exists. Click opens notifications panel (drawer from right).

**Help**: Opens help center in new tab + context-aware help panel.

**User menu**: Avatar + name, click opens dropdown:
- View profile
- Preferences
- Switch business (if user has multiple)
- Keyboard shortcuts
- Log out

### 2.3 Mobile navigation

Sidebar collapses to hamburger menu. Hamburger opens full-screen drawer.

Bottom tab bar (alternative for mobile-primary users — Phase 2):
- Dashboard
- Sell (most-used module)
- + (create)
- Approvals
- Profile

### 2.4 Module-level navigation

Within a module, secondary navigation appears at the top of content area:

- Tabs for peer views (e.g., in Sell: Invoices / Quotations / Customers / POS)
- Breadcrumbs for hierarchical navigation

### 2.5 Cross-module context preservation

When navigating between modules, context is preserved where useful:

- From customer detail → "Create invoice for this customer" → invoice form pre-fills customer
- From invoice detail → customer name is a link → opens customer detail with option to return
- From payroll run → employee row → employee detail with option to return

Back button should always work (browser history preserved).

---

## 3. Interaction patterns

### 3.1 Creating records

**Pattern: Dedicated page for complex creates**

Used for: invoices, bills, GRNs, POs, journal entries.

- Breadcrumb + title + save/post buttons at top
- Main form in left 60%, context panel in right 40%
- Save as draft anytime
- Post or submit when complete

**Pattern: Modal for simple creates**

Used for: customers, suppliers, items (quick-add), time entries.

- Simple modal with essential fields only
- "Save and create another" option for bulk entry
- "Save and close" as primary action

**Pattern: Inline creation**

Used for: adding a new customer while creating an invoice.

- Combobox with "No matches. + Add 'Fathima Importers' as new customer" inline option
- Click opens mini-modal with just essential fields
- On save, customer is added and selected in the parent form

### 3.2 Editing records

**Pattern: Full edit page**

Used for: invoices (when unposted), complex entities like COA accounts.

**Pattern: Click-to-edit (inline)**

Used for: simple fields like notes, tags, customer code.

- Hover shows pencil icon
- Click makes field editable in place
- Blur or Enter saves; Escape cancels

**Pattern: Modal edit**

Used for: quick edits to customers, suppliers, items when already in list view.

### 3.3 Saving behavior

**Explicit save (default)**: Most forms require explicit "Save" or "Submit" button click.

**Auto-save for drafts**: Invoice draft, quotation draft, journal entry draft auto-save every 30 seconds. Show "Saved X seconds ago" indicator in the form header.

**Auto-save for settings**: Toggle switches and preference changes apply immediately with a toast confirmation.

**Never auto-save destructive actions**: Deletion, posting, voiding always require explicit confirmation.

### 3.4 Bulk operations

**Pattern**: Checkbox in table rows + bulk action bar

- Select individual rows or "Select all"
- Bulk action bar appears above table when any row is selected
- Shows "X selected" count
- Actions: common operations (send reminder, download PDFs, export, delete)
- "Clear selection" always visible
- Maximum selection: 100 at a time (warn if more attempted)

**Long-running bulk ops**: Show progress indicator + background job reference. User can navigate away and return; notification when complete.

### 3.5 Undo / redo

**Soft actions have undo** (5-second window with toast):
- Delete customer → "Customer deleted. Undo?" toast, 5 seconds to reverse
- Archive item → "Item archived. Undo?" toast

**Hard actions require explicit confirmation, no undo**:
- Post invoice (can void, creating reversal — but not "undo")
- Lock period
- Submit statutory return

### 3.6 Confirmation patterns

**Soft confirmation** (low-risk reversible):
- Simple confirm dialog: "Save changes to this customer?" with Cancel/Save buttons

**Medium confirmation** (potentially impactful):
- Modal with clear explanation of consequences
- Cancel/Proceed buttons
- Examples: voiding an invoice, approving a large payment

**Hard confirmation** (irreversible or high-impact):
- Modal with detailed consequences
- Typed confirmation required ("Type LOCK MARCH 2026 to confirm")
- Destructive button disabled until typed text matches
- Examples: locking a period permanently, deleting a tenant, cancelling a subscription

### 3.7 Error handling

**Field-level errors**:
- Red border on invalid input
- Error text below input
- Alert icon
- Error summary banner at top of form if multiple errors

**Form submission errors**:
- Banner at top of form explaining what went wrong
- Specific errors highlighted on respective fields
- Submit button re-enabled after error (not disabled)

**Network errors**:
- Toast: "Couldn't save — check your connection and retry"
- Form state preserved, user can retry without re-entering

**Permission errors**:
- Explanation: "You don't have permission to [specific action]. Contact [owner name] to request access."
- Link to relevant help article

**Server errors (5xx)**:
- Generic message: "Something went wrong on our end. We've been notified."
- Request ID shown for support reference
- Retry button

### 3.8 Loading patterns

**Initial page load**: Skeleton matching final layout shape.

**Data loading within page**: Replace content with skeletons; keep navigation and headers rendered.

**Action in progress**: Button shows spinner + state text ("Saving...", "Posting invoice...").

**Long-running background jobs**: Show progress bar or percentage when possible. Allow navigation away; notification on completion.

### 3.9 Search behavior

**Global search** (top bar):
- Opens dropdown with results after typing 2 characters
- Debounce: 200ms after typing stops
- Keyboard navigation: arrow keys + Enter
- Esc closes dropdown
- Results grouped by entity type
- Recent searches shown when empty
- "No results" state includes a "Create new [entity]" suggestion when relevant

**Module-level search** (within list pages):
- Inline with table header
- Applies to current table's filters
- Clears with × icon or Escape

**Fuzzy matching**: Use PostgreSQL trigram search for customer/supplier/item names (handles typos).

### 3.10 Filtering patterns

**Common filters visible**: Date range, status, branch, user — shown as dropdowns in filter row above the table.

**Advanced filters**: "More filters" button opens a drawer with all possible filter criteria.

**Active filter chips**: Applied filters shown as dismissible chips. "Clear all filters" link when any applied.

**Saved views**: User can save a filter combination as a named view ("Overdue from key customers"). Appears in tabs or a saved views dropdown.

### 3.11 Sorting patterns

**Click column header to sort**. First click: ascending. Second click: descending. Third click: unsort.

Active sort indicated by filled chevron. Hover shows unfilled chevron for sortable columns.

**Default sort**: Most tables default to "most recent first" on primary date column.

### 3.12 Pagination

**Standard pagination**:
- "Showing 1-20 of 184" at bottom
- Previous/Next buttons
- Page number input for jumping
- Results-per-page selector (20 default, 50, 100)

**Infinite scroll**: Used for activity feeds and notifications, not for transactional lists (where totals matter).

**Cursor-based pagination** for very large datasets (journal lines, audit log).

### 3.13 Drag and drop

**Used sparingly**. Supported for:
- Reordering nav items in user preference
- Reordering approval workflow steps
- Reordering chart of accounts hierarchy
- Attaching files (drop zone)

**Always provide keyboard alternative**: Drag-reorder via button or arrow keys.

### 3.14 Context menus

**Right-click**: Not used (conflicts with browser default, not discoverable on mobile).

**Kebab menu** (three dots) on each row/card: Opens dropdown with contextual actions.

### 3.15 Copy and export

**Copy to clipboard**: Click "copy" icon next to copyable fields (invoice number, customer email, reference numbers).

**Export actions**: "Export" button at top of lists with format options (CSV, Excel, PDF).

**Share link**: Generate shareable link with preview (for invoices sent to customers, payroll reports for accountants).

---

## 4. Content and microcopy library

### 4.1 Voice principles

From brand kit section 2.3:
1. Say what it is
2. Respect the reader's time
3. Lead with the verb
4. Numbers are facts, not features
5. Explain only when asked
6. No "just"
7. No emoji in product UI

### 4.2 Button labels

**Primary actions**:
- "Create invoice" (not "Generate new invoice" or "New invoice creation")
- "Post invoice" (accounting term, users understand)
- "Send" (when sending an invoice to customer)
- "Save" or "Save draft"
- "Approve" / "Reject"
- "Record payment"
- "Lock period"

**Secondary actions**:
- "Cancel"
- "Back"
- "Edit"
- "Duplicate"

**Destructive actions**:
- "Delete" (most cases)
- "Void" (accounting context, reverses posted transactions)
- "Archive" (soft-hide)
- "Remove" (from a list, not the system)

### 4.3 Empty state copy

Structure: [What's missing] + [Why it matters / context] + [How to fix]

| Context | Heading | Body | CTA |
|---|---|---|---|
| No invoices | "No invoices yet" | "Create your first invoice to start tracking sales." | "Create invoice" |
| No customers | "No customers yet" | "Add customers to start invoicing and tracking relationships." | "Add customer" |
| No overdue | "Nothing overdue" | "Your customers are paying on time." | (celebratory — no CTA) |
| No search results | "No results for '[query]'" | "Try different keywords or clear filters." | "Clear filters" |
| No payroll runs | "No payroll runs yet" | "Start your first payroll run when you're ready to pay your team." | "Start payroll run" |
| No stock movements | "No stock movements this period" | "Movements show here when you receive, sell, or adjust stock." | (no CTA) |
| Permission denied | "You don't have permission" | "Contact [owner name] to request access to [specific feature]." | "Contact owner" |

### 4.4 Error messages

**Pattern**: [What went wrong] + [What to do about it]

| Error | Message |
|---|---|
| Invalid email | "This doesn't look like a valid email address." |
| Password too short | "Password needs to be at least 8 characters." |
| VAT number format | "VAT numbers are 9 digits. Check and try again." |
| Duplicate invoice number | "Invoice INV-2026-0342 already exists. Try a different number." |
| Network | "Couldn't save — check your connection and try again." |
| Permission | "You don't have permission to post invoices. Contact your owner." |
| Over credit limit | "This customer is over their credit limit. Owner approval needed to proceed." |
| Period closed | "Can't post to March 2026 — the period is closed. Use April instead, or ask owner to reopen." |
| Stock insufficient | "Not enough stock. 45 units available, you're trying to sell 60." |
| Server error | "Something went wrong on our end. We've been notified. Request ID: abc-123." |

### 4.5 Success messages

**Toasts** (auto-dismissing):

| Action | Message |
|---|---|
| Invoice saved (draft) | "Draft saved" |
| Invoice posted | "Invoice INV-2026-0342 posted" |
| Invoice sent | "Sent to [customer name]" |
| Payment recorded | "Payment of LKR 245,800 recorded" |
| Customer added | "Customer added" |
| Changes saved | "Changes saved" |
| Period locked | "March 2026 locked" |
| Payroll run approved | "April 2026 payroll approved" |

**Celebration moments** (rare, for first-time milestones):

- First invoice posted: "Nice — your first invoice is out."
- First payroll run: "First payroll run complete. 47 employees paid."
- 100th invoice: "100 invoices posted. You're getting the hang of this."

### 4.6 Confirmation dialogs

**Soft**:
- "Save changes?"
- "Discard draft?"
- "Archive this customer?"

**Medium**:
- "Void invoice INV-2026-0342? This will create a reversing credit note."
- "Post LKR 245,800 payment? This will reduce the customer's outstanding balance."

**Hard** (require typed confirmation):
- "Delete INV-2026-0342 permanently? This can't be undone. Type the invoice number to confirm."
- "Lock March 2026 period? No changes can be made to March transactions after this. Type LOCK MARCH 2026 to confirm."
- "Cancel your PettahPro subscription? You'll lose access at the end of your current billing period. Type CANCEL to confirm."

### 4.7 Tooltips

Short, 1-2 lines max. Explain what an action does without being condescending.

| Context | Tooltip |
|---|---|
| WHT icon next to supplier field | "Withholding Tax auto-applied based on supplier type" |
| Period lock icon | "This period is locked. Owner override required." |
| Reconciled checkmark | "Matched to statement on [date]" |
| Stock warning | "Stock below reorder point" |
| Credit hold | "Customer is on credit hold — Owner approval needed" |

### 4.8 Help text (inline)

Shown below or next to form fields for non-obvious inputs.

| Field | Help text |
|---|---|
| VAT number | "Your IRD-registered VAT number. Leave blank if not VAT registered." |
| Credit limit | "Maximum outstanding amount this customer can have at any time." |
| Reorder point | "Stock level at which a reorder alert triggers." |
| Bank reconciled balance | "Book balance matches bank statement. Difference must be explained." |
| Fiscal year start | "Usually April for Sri Lankan businesses." |

### 4.9 Notification copy

**Email subject lines**:
- "New invoice from Perera Enterprises: INV-2026-0342"
- "Payment received: LKR 245,800"
- "PettahPro: Your April payroll is due in 5 days"
- "Welcome to PettahPro"

**Push notifications**:
- "Payment received: LKR 245,800 from Fathima Importers"
- "Expense claim needs your approval"
- "3 invoices overdue. Review now."

**In-app notifications**:
- "Kasun approved your expense claim of LKR 4,200"
- "March payroll is ready for your review"
- "Your bank reconciliation for Commercial Bank is pending"

### 4.10 Date and time formats

**Dates**:
- Short: `19/04/2026`
- Medium: `19 Apr 2026`
- Long: `Friday, 19 April 2026`
- Relative: "2 hours ago", "Yesterday", "3 days ago", "Last week", "2 months ago"
- "Today", "Tomorrow", "Yesterday" (for adjacent days specifically)

**Times**:
- Default: 24-hour format `14:35`
- User-togglable: 12-hour format `2:35 PM`

**Date ranges**:
- "19 Apr - 25 Apr 2026"
- "April 2026" (when whole month)
- "Q2 2026" (when whole quarter)

### 4.11 Currency and number formats

**Default**: `LKR 1,245,670.00` (space between currency and number, comma thousands, two decimals)

**Compact**: `LKR 1.2M` or `LKR 245K` (for charts, dashboards where space matters)

**Negative**: `-LKR 5,000.00` (minus prefix, before currency)

**Percentages**: `18%`, `28.4%`, `+12.4%` (no space between number and %, sign prefix for deltas)

**Ordinals**: `1st, 2nd, 3rd` (written out in body, not superscript)

### 4.12 Accounting terminology

Consistent usage of SL accounting terms:

| Use | Don't use |
|---|---|
| Invoice | Bill (for sales docs) |
| Bill | Invoice (for purchase docs) — confusing |
| VAT | Sales tax, GST |
| WHT | Withholding Tax (spell out first mention) |
| EPF / ETF | Provident Fund / Trust Fund |
| PAYE | Pay As You Earn |
| Cheque | Check (US spelling) |
| Posted | Finalized, committed |
| Void | Cancel (for posted transactions) |
| Reconciled | Matched |
| Journal entry | Booking, transaction record |
| Chart of Accounts (COA) | General ledger |

---

## 5. PettahPro-specific UX decisions

Unique decisions that distinguish PettahPro from generic accounting software.

### 5.1 Minimal-entry principle

**Decision**: Every data entry form defaults to capture-first (photo, scan, barcode) with manual entry as fallback.

**Rationale**: Pettah SME operators are often not tech-savvy accountants. Reducing keystrokes is the single biggest UX win.

**Applied to**:
- Item entry: barcode scan first, OCR from photo second, manual third
- Customer entry: phone scan of business card (Phase 2), phone book search, manual
- Bill entry: photo of supplier invoice triggers OCR, then review/edit → post
- Receipt entry: photo of bank slip → OCR → apply to customer

**Pattern**:
```
[Primary: scan/photo big button]
[Secondary: search existing]
[Tertiary: enter manually link]
```

### 5.2 Easy mode vs Advanced mode toggle

**Decision**: Every form that benefits from simplification has an Easy/Advanced toggle in the top-right corner.

**Rationale**: Owners want simplicity; accountants want completeness. Both are real users.

**Easy mode shows**:
- Essential fields only
- Sensible defaults
- No accounting jargon
- Single-screen linear flow

**Advanced mode shows**:
- All fields including optional ones
- Accounting-specific controls (GL account override, cost center tagging, multi-dimensional splitting)
- Advanced validation
- Multi-section layout

**State**: User preference persisted. Defaults to Easy mode.

**Example — invoice creation**:
- Easy: customer, items, total, Send
- Advanced: + GL accounts per line, cost center, project tag, custom tax codes, FX rate override

### 5.3 Multi-role awareness

**Decision**: The product accepts that users wear multiple hats. Permission resolution is union (any role grants → granted) but displayed honestly.

**UX implications**:
- Role badge next to user name shows combined roles: "Owner · Accountant · HR"
- "See effective permissions" panel shows each permission with which role granted it
- When switching a role (e.g., Owner stepping into Accountant view), a small indicator shows "Acting as Accountant"
- When a user's role causes a feature to appear/disappear, tooltip explains: "Available because you're an Accountant"

### 5.4 Activation threshold

**Decision**: A tenant is "activated" when they've posted their first invoice (or first bill, first payroll run — whichever comes first).

**Rationale**: Trials are crowded with users who sign up and never return. A single posted document is the strongest signal that the product has fit.

**UX signals pre-activation**:
- Setup completeness card shows progress
- Emptiness of lists is celebrated as opportunity (not hidden)
- "Create your first X" CTAs prominent

**UX shift post-activation**:
- Setup completeness card dismissed
- Dashboard shows real data
- Onboarding tips change to "Things to try next"

### 5.5 Cheque lifecycle visualization

**Decision**: Cheque management is a first-class feature with dedicated UI, not buried in payments.

**Rationale**: SL cheques have 9-state lifecycle per Bounced Cheques Act. Buried in payments, they become a source of bugs and missed obligations.

**UX**:
- Cheques menu item within Sell (for received) and Buy (for issued)
- Visual pipeline view showing cheques across stages (Drafted → Issued → Presented → Cleared / Bounced)
- Aging view for pending-clearance cheques
- Bounced cheque alerts with timeline of bounces and legal-action tracking

### 5.6 WhatsApp-readiness

**Decision**: Every customer-facing document has a "Send via WhatsApp" option, even when WhatsApp API integration is Phase 2.

**Rationale**: WhatsApp is how SL SMEs actually communicate with customers. Planning for it from day one ensures we don't retrofit.

**Phase 1 implementation**:
- "Send via WhatsApp" button triggers a share link that opens WhatsApp with pre-filled message and PDF link
- User still manually selects recipient and sends

**Phase 2**:
- Direct WhatsApp API integration — send without leaving PettahPro

**UX consistency**: Button placement, copy, and flow are identical in both phases. Only backend changes.

### 5.7 Offline-first POS

**Decision**: POS screen continues to function without internet connection. Sales queue locally and sync when reconnected.

**Rationale**: Retail in SL deals with frequent brief internet outages. Losing sales because cloud isn't reachable is unacceptable.

**UX indicators**:
- "Offline" indicator in POS header when disconnected
- "X sales queued for sync" counter
- On reconnect: "Syncing..." toast → "✓ Synced" when complete
- Sale still generates local receipt number; final invoice number assigned on sync

**Limitations**:
- Inventory checks rely on last-sync data (accept minor discrepancies)
- Customer credit limit checks also rely on last-sync data (Owner can set policy)

### 5.8 NIC-protected PDFs

**Decision**: Sensitive PDFs (payslips, invoices to individuals) are password-protected with the recipient's NIC last 4 digits by default.

**Rationale**: SL data protection law requires securing personal financial documents. NIC last 4 is memorable and reasonably secure.

**UX**:
- Toggle in document generation: "Password-protect with NIC" (default on for payslips, off for B2B invoices)
- Email/share instruction: "Your password is the last 4 digits of your NIC."
- Option to use custom password for high-sensitivity documents

### 5.9 Migration mode

**Decision**: When importing historical data from BUSY/Tally, the system enters a "Migration mode" where typical validation is relaxed.

**Rationale**: Historical data often has quirks (missing VAT numbers on old records, etc.) that would block entry under normal rules.

**UX**:
- Banner at top: "Migration mode active for historical data before 01/01/2026"
- Relaxed validation for imported records
- Migration mode expires automatically after import window
- Owner can extend if needed

### 5.10 Period-lock override

**Decision**: Owner can override a soft-closed period, but action is heavily audit-logged and flagged.

**Rationale**: Reality of SL SME bookkeeping — late corrections happen. Blocking them forces workarounds that are worse.

**UX**:
- Attempting to post in a soft-closed period triggers modal: "March is closed. Request Owner override to post this transaction."
- Owner sees override request in their approval queue
- Approval requires reason + reopens period briefly for the specific transaction
- Period re-locks automatically after transaction posts
- All reopen events shown in period history with full audit trail

### 5.11 Consent-gated impersonation

**Decision**: Super Admins can never silently access tenant data. All platform access requires either log-based diagnosis or tenant-granted OTP consent.

**Rationale**: Trust is the foundational promise. Breaking it kills the brand.

**UX (support workflow)**:
- Support agent creates ticket
- If diagnosis requires tenant data: "Request impersonation access" button
- Tenant receives email + in-app prompt with OTP
- Tenant grants access for specific duration (2hr / 24hr / custom)
- During access, tenant sees "Platform support is helping — [agent name]" banner
- Session ends automatically at time limit
- All actions logged and included in quarterly transparency report to tenant

### 5.12 Local-language support (without full translation)

**Decision**: Key customer-facing documents (invoices, receipts, quotations) support Tamil and Sinhala versions. Product UI itself remains English-only at launch.

**Rationale**: The customer-facing artifacts are what affect tenant's customers and legal compliance. The internal UI can stay English since SL business environment is English-dominant for accounting.

**Implementation**:
- Each entity (invoice, receipt) has "Print in" selector: English (default), Tamil, Sinhala
- Item names stored in multiple languages; correct version used per document
- Customer's preferred language stored on customer record — used automatically

### 5.13 Approval-time balance deduction (leave)

**Decision**: Leave balance is deducted when approved, not when applied for or when actually taken.

**Rationale**: Prevents employees from applying for overlapping leave they don't have balance for. Prevents confusion about "what's my real balance right now?"

**UX**:
- Applying for leave: shows current balance + projected balance if approved
- Approving leave: balance deducted immediately
- Cancellation after approval: balance restored (with audit entry)
- Actual leave-taking: no balance change (already deducted)

### 5.14 Two-stage payroll posting

**Decision**: Payroll run creates two GL entries: one at approval (accrual), one at disbursement (cash settlement).

**Rationale**: Correctly reflects the business reality — liability accrues when payroll is approved, cash moves when disbursement happens.

**UX**:
- Approval step: "Post accrual" button (creates salary expense / payables entries)
- Disbursement step: "Post settlement" button (clears payables, reduces cash)
- Both clearly labeled and logged
- Timing difference visible in bank reconciliation (expected vs actual cash movement)

### 5.15 Auto-apply gratuity formula with manual override

**Decision**: Final settlement auto-computes gratuity per SL Gratuity Act (14 days × last basic × years of service, 5-year minimum). HR can override with logged reason.

**Rationale**: 90% of cases are formulaic. 10% have nuances (notice period waiver, pro-rating, performance-based adjustments) that need flexibility.

**UX**:
- Final settlement screen shows computed gratuity: "LKR 300,000 (auto-calculated: 20 years × 15 days × LKR 1,000 daily basic)"
- "Override gratuity amount" link below
- Override requires reason from a dropdown: "Performance bonus", "Notice period waiver", "Company policy", "Custom calculation", "Other"
- Audit entry logs computed amount + override amount + reason + approver

### 5.16 Credit limit over-ride

**Decision**: When a customer exceeds credit limit during invoice creation, the system blocks by default but allows Owner override.

**Rationale**: Real sales happen with customers over credit limit. Absolute blocking kills sales; no blocking erodes credit discipline.

**UX**:
- Invoice creation for over-limit customer shows banner: "Fathima Importers is over credit limit (LKR 254,800 over by LKR 4,800). Continue anyway?"
- Non-Owner users see: "Over limit — request Owner approval to proceed"
- Owner sees: "Override credit limit for this invoice?" with reason input
- Audit log tracks every override

### 5.17 Supplier portal opt-in

**Decision**: Supplier portal (for suppliers to self-submit invoices, check payment status) is built but disabled by default.

**Rationale**: Most tenants aren't ready to expose portal access. Building it but keeping it off means it's available when tenant is ready without retrofitting.

**UX**:
- Toggle in Settings → Integrations: "Enable supplier portal"
- When enabled: invite suppliers via email with link + credentials
- Supplier sees simplified portal with their bills, payment history, statement
- Tenant can disable at any time

### 5.18 Denomination-level cash counting

**Decision**: POS shift open and close requires counting cash by denomination, not just total.

**Rationale**: Denomination-level counts dramatically reduce counting errors and simplify bank deposits.

**UX**:
- Shift open modal: grid of 10 denomination inputs (LKR 5000 down to LKR 1)
- Auto-totals as user enters counts
- Shift close: same grid + variance calculation
- Z-report includes denomination breakdown

### 5.19 Photo-of-supplier-invoice for bill entry

**Decision**: Bill entry's primary input is a photo of the paper supplier invoice. OCR extracts vendor, amount, date, line items.

**Rationale**: Pettah businesses receive paper supplier invoices daily. Typing them in is the single biggest accounting workload. Photo → OCR → review → post cuts this to seconds.

**UX**:
- Bill creation: big "Scan paper invoice" button as primary action
- Camera opens (on mobile) or file picker (on desktop)
- OCR processes in 2-5 seconds
- Review screen: extracted data populated in form fields with confidence indicators
- User corrects anything OCR got wrong (vendor name, line item amounts)
- Post

### 5.20 Real SL data throughout

**Decision**: All example data, default templates, seed values, and screenshots use realistic Sri Lankan business names, NICs, products, places, and figures.

**Rationale**: "Acme Corp" and "John Doe" feel alien. Perera Textiles and Fathima Importers feel like home.

**UX**:
- Onboarding examples use SL businesses
- Default industry templates seeded with SL-relevant items (cotton fabric, tea, rice, hardware)
- Currency always LKR; comparisons shown in LKR
- Date format DD/MM/YYYY
- Phone format +94 XX XXX XXXX
- NIC format 199812345678 (new) or 851234567V (old)

---

## 6. Keyboard shortcuts

Power users expect keyboard shortcuts. SL SME operators who've used BUSY/Tally for 10 years are keyboard-first.

### 6.1 Global shortcuts

| Shortcut | Action |
|---|---|
| `/` | Focus search |
| `N` | Open "New" menu |
| `?` | Show keyboard shortcuts reference |
| `Esc` | Close modal / drawer / popover |
| `G D` | Go to Dashboard |
| `G S` | Go to Sell |
| `G B` | Go to Buy |
| `G I` | Go to Inventory |
| `G A` | Go to Accounting |
| `G P` | Go to Payroll |
| `G E` | Go to People |
| `G T` | Go to Settings |

### 6.2 Page-level shortcuts

| Page | Shortcut | Action |
|---|---|---|
| Invoice creation | `Ctrl+S` | Save as draft |
| Invoice creation | `Ctrl+Enter` | Post |
| POS | `Ctrl+P` | Park current sale |
| POS | `Enter` | Go to payment |
| Any list | `F` | Focus filter input |
| Any list | `Ctrl+A` | Select all visible |
| Any modal | `Enter` | Primary action |
| Any modal | `Esc` | Cancel |

### 6.3 Navigation within components

| Component | Shortcut | Action |
|---|---|---|
| Tabs | `←` `→` | Move between tabs |
| Date picker | Arrow keys | Navigate days |
| Date picker | PgUp/PgDn | Previous/next month |
| Dropdown | `↑` `↓` | Navigate options |
| Dropdown | Enter | Select |
| Table | Arrow keys | Navigate cells |
| Form | Tab | Next field |
| Form | Shift+Tab | Previous field |

### 6.4 Shortcuts discovery

- `?` shows shortcut reference modal
- First-time user onboarding introduces "Press ? anytime to see shortcuts"
- Tooltip on hover shows shortcut inline: "Save (Ctrl+S)"

---

## 7. Mobile adaptations

### 7.1 Responsive strategy

From UI system section 3.5 — some screens are mobile-essential, others desktop-only.

### 7.2 Mobile navigation

- Hamburger menu opens full-screen drawer
- Bottom tab bar (Phase 2 option): Dashboard, Sell, +, Approvals, Profile
- Back button always visible in top-left when not on dashboard

### 7.3 Mobile-specific patterns

**Touch targets**: Minimum 44×44px, usually 48×48px for comfortable tapping.

**Bottom sheet modals**: On mobile, modals appear as bottom sheets sliding up from bottom, not centered.

**Swipe gestures**:
- Swipe left on list row: reveals quick actions (delete, archive)
- Swipe down on top of page: refresh (pull-to-refresh)
- Swipe back: native iOS/Android back navigation

**Sticky action bar**: Primary actions fixed to bottom of viewport, never scroll off.

### 7.4 Mobile-specific screens

**Mobile POS**: Redesigned for phone form factor — single column, larger touch targets, swipeable item grid. Recommended tablet minimum though.

**Mobile invoice creation**: Simplified to 3 steps:
1. Pick customer
2. Add items (one at a time, not a table)
3. Review and send

**Mobile approvals**: Dedicated screen — scrollable list of pending approvals with swipe-left to reject, swipe-right to approve.

**Mobile notifications**: Full-screen notification center with filter tabs.

### 7.5 Data-heavy screens on mobile

Some screens don't work well on mobile due to data density:
- Bank reconciliation → show message: "This works best on a larger screen. Switch to desktop or tablet to continue."
- Period close → same
- Payroll run wizard → same

### 7.6 Offline indicators on mobile

More prominent on mobile (users actually go offline):
- Small banner at top: "You're offline. Changes will sync when you reconnect."
- Queue count visible: "3 changes waiting to sync"

---

## 8. Journey 1 — Signup to first invoice

The single most important funnel. Every step optimized for conversion from visitor → activated tenant.

### 8.1 Landing page (public)

**Purpose**: Convert visitor to trial signup.

**Layout**:
- Top nav: Logo, nav links (Product, Pricing, Migration, Resources, Sign in), "Start free trial" CTA on right, language switcher (EN / TA / SI)
- Hero section: headline + subhead + two CTAs + product preview
- Trust bar: "Trusted by 2,400+ SL businesses" + logos
- Product sections (features, benefits, testimonials, pricing teaser, FAQ)
- Footer with full sitemap

**Hero**:
- Headline: "Built for how Pettah actually does business"
- Subheadline: "Cloud accounting replacing BUSY and Tally for SL SMEs. WhatsApp-ready. AI-assisted. Fully compliant."
- Primary CTA: "Start 30-day free trial"
- Secondary CTA: "See how it works" (opens video or product tour)
- Small text: "No credit card. Migration from BUSY/Tally included."

**Key UX decisions**:
- Single primary CTA above the fold
- Real SL business logos in trust bar (secured separately)
- No popup lead capture — respect visitor's time
- Sign in link in top-nav for returning users (not buried)

### 8.2 Signup form

**Purpose**: Capture essentials, start trial immediately.

**Fields** (required unless noted):
- Business name
- Your name
- Work email
- Mobile number (+94 prefix)
- Password (8+ chars, strength indicator)
- Industry (dropdown)
- Employee count (dropdown)
- Agree to Terms checkbox

**Key UX decisions**:
- Single column, no distractions
- Progressive validation (don't validate until field blur)
- "Show password" toggle
- Password strength indicator — but don't block signup for "weak" passwords
- Phone auto-formats as user types: 077 123 4567

**Post-signup**: Redirect to email verification screen.

### 8.3 Email verification

**Purpose**: Confirm real email before granting full access.

**Layout**:
- Centered card with envelope icon, "Check your email" heading
- Body: "We sent a verification link to [email]. Click the link to activate your account."
- Actions: "Didn't get it? Resend email" + "Wrong email? Go back"
- Reassurance note: "Your trial has started — 30 days to explore everything."

**Key UX decisions**:
- User can explore the product in limited mode (can view, can't post) while verification pending — prevents drop-off
- Verification link clicks take user directly into setup wizard
- Resend button has rate limit (30 seconds) to prevent abuse

### 8.4 Setup wizard (5 steps, all skippable)

**Purpose**: Configure enough to create first invoice.

**Steps**:
1. Company basics (name, VAT, TIN, fiscal year, currency, address)
2. Branches (default: 1 branch with business name; can add more)
3. Chart of Accounts (use template by industry, or customize)
4. Tax codes (pre-loaded SL defaults, confirm/edit)
5. Invite team (optional — can do later)

**Key UX decisions**:
- "Skip setup for now" always visible in top-right — user can bail
- Progress indicator shows which step they're on
- Each step has "Why we ask" sidebar explaining the relevance
- Sensible defaults pre-filled (fiscal year = April, currency = LKR)
- Can go back to edit previous steps

**After completion**: Dashboard (either empty or with seeded data based on user's choices).

### 8.5 Empty dashboard (first login)

**Purpose**: Orient new user, guide to first-invoice moment.

**Key elements**:
- Welcome message
- Setup completeness card (10-item checklist with 2 done: company + account created)
- Three empty-state tiles: "Sales will show here", "Expenses", "Cash position" — each with CTA to create first record
- Quick-start section: "Import from BUSY/Tally" | "Invite accountant" | "Set up team" | "Watch tour"

**Key UX decisions**:
- Don't show fake data — empty states are honest but inviting
- CTAs are prominent but not pushy
- Migration CTA sits here since it's the wedge feature

### 8.6 Create first invoice

**Purpose**: The activation moment. User creates their first invoice.

**Layout**: Full-page form with sidebar panel.

**Form sections**:
1. Customer (with "Add new" inline option)
2. Invoice details (number, date, due date, currency)
3. Items (table with add-line button)
4. Notes + payment terms

**Sidebar panel**: Invoice preview (PDF thumbnail), customer info, recent invoices to this customer.

**Key UX decisions**:
- Invoice number auto-generated (changeable)
- Smart defaults: due date = invoice date + 30 days, currency = LKR
- Inline customer creation if customer doesn't exist yet
- Item search with autocomplete; "Add new item" inline
- Live total calculation as items added
- Post button explicit, "Save as draft" always available
- Preview shows what customer will see

**Tooltips at key moments**:
- First-time "Post" hover: "Posting will record this in your accounts and send to the customer"
- "VAT 18%" tooltip: "Standard SL VAT applied to most goods and services"

### 8.7 Invoice posted (success + populated dashboard)

**Purpose**: Celebrate first invoice, set up for ongoing use.

**Success banner**: "Invoice INV-2026-0001 for LKR 53,100 posted to [customer]. View invoice | Send to customer"

**Dashboard now shows real data**:
- Setup completeness 3/10
- 4 KPI cards with actual figures
- Recent activity timeline
- "What's next" card: Send via WhatsApp (preview), Record payment, Create second customer

**Celebration moment**: First invoice is special — a brief celebration moment (subtle, not confetti):
- Banner says "Nice — your first invoice is out."
- No over-the-top animations, respects professional tone

**Post-activation shift**: Setup completeness card stays until 10/10, but "What's next" tips adjust based on what user's done.

---

## 9. Journey 2 — Daily operational flow

The everyday pattern: check dashboard, handle customers/invoices, process sales, close shifts.

### 9.1 Populated dashboard

**Purpose**: Morning check-in, identify priorities.

**Key elements**:
- Greeting with date and branch selector
- 4 KPI cards: Revenue this month, Outstanding AR, Cash position, Profit margin (each with delta vs last period)
- Revenue chart (last 12 weeks)
- Top customers table (this month)
- "Needs attention" card with urgent items
- Recent activity timeline
- Tasks (personal to-do)

**Key UX decisions**:
- KPIs show deltas, not just values (is it up or down?)
- "Needs attention" is not a rigid list — surfaces genuinely important items
- Time-aware (morning shows yesterday's activity, afternoon shows today's)
- Branch selector in header affects everything below

### 9.2 Customer list

**Purpose**: Reference and manage customers.

**Key elements**:
- Status tabs: All, Active, Inactive, On credit hold
- Filter row: Branch, Industry, Credit status, Sort
- Main table: Code, Name, Phone, VAT, Outstanding AR, Credit limit, Credit used %, Last activity, Status, actions
- Bulk actions available via row selection

**Key UX decisions**:
- Credit used shown as both % and progress bar — visual reading at a glance
- Outstanding AR clickable → opens customer's statement
- Status pills: Active (mint), On hold (red), Inactive (gray)
- Search is fuzzy (handles typos in names)
- Default sort: recently active first (not alphabetical)

### 9.3 Invoice list with filters

**Purpose**: Track invoice status, find specific invoices.

**Key elements**:
- Status tabs with counts: All, Draft, Pending, Posted, Overdue, Voided
- Rich filter row: Date range, Customer, Branch, Payment status, Salesperson, Sort
- Summary bar: count + total + unpaid total
- Table with 10+ columns showing full invoice lifecycle state

**Key UX decisions**:
- Overdue invoices get red left-border accent — visual priority
- Payment status separate from invoice status (posted invoice can still be unpaid)
- Progress bar in "Paid" column shows partial payments
- Row hover reveals quick actions (View, Send, Duplicate)
- Bulk actions: Send reminders, Download PDFs, Export, Void

### 9.4 POS screen

**Purpose**: Fast, touch-optimized register for retail sales.

**Three-zone layout**:
- Left (35%): Item selection — barcode scan, search, grid of products
- Middle (40%): Cart — line items with qty stepper, totals
- Right (25%): Tender methods and actions — big Pay button, 9 tender options, Park Sale, Discount

**Key UX decisions**:
- "Pay" is the visually dominant action — large button in mint
- Barcode is primary input method (big scan icon, auto-focus)
- Cart shows all running totals in real-time
- Customer defaults to "Walk-in" — no friction for anonymous sales
- Mixed tender method opens a breakdown: "LKR 2,000 cash + LKR 3,274 card"
- Offline mode indicator if disconnected

### 9.5 POS shift close

**Purpose**: End-of-day cash reconciliation.

**Three-step flow**:
1. Cash count (by denomination, 10 inputs)
2. Review (variance analysis, tender breakdown)
3. Close (generates Z-report)

**Key UX decisions**:
- Expected cash calculated from transactions (not manually)
- Variance highlighted immediately as user types denominations
- Common variance reasons pre-loaded as dropdown options
- Z-report is PDF + printable
- After close, POS is locked until next shift opened

### 9.6 Record payment modal

**Purpose**: Apply customer payment to one or more invoices.

**Layout**:
- Payment details: amount, date, method, bank/reference
- Apply to invoices: table of open invoices for this customer with input to allocate amount
- Summary: total applied vs unallocated

**Key UX decisions**:
- "Auto-apply to oldest first" button for quick allocation
- Unallocated remainder becomes customer advance automatically
- Credit status card in sidebar shows pre/post payment
- WHT-applicable payments show WHT split automatically

---

## 10. Journey 3 — Monthly close

The accounting rigor flow. Deliberate, step-by-step, audit-friendly.

### 10.1 Period close checklist

**Purpose**: Guide owner/accountant through the 5-step close process.

**Layout**:
- Status banner: "March 2026 is currently open — X transactions in this period"
- 5-step expandable checklist (from accounting spec)
- Actions: Save progress | Lock March 2026
- Sidebar: Close summary (revenue, expenses, profit) + recent closes

**Key UX decisions**:
- Each step has sub-items and status
- Clicking a sub-item navigates to relevant screen (bank rec, AR review, etc.)
- Completion progress visible (X of 5 steps done)
- "Save progress" allows multi-session close work
- Lock requires hard confirmation with typed text

### 10.2 Bank reconciliation

**Purpose**: Match book records to bank statement.

**Layout**: Two-column matching interface
- Left: Statement transactions (from uploaded CSV/PDF)
- Right: Book records (unmatched receipts/payments)
- Auto-match suggestions shown as ghost rows connecting columns
- Summary at top: book balance, statement balance, difference

**Key UX decisions**:
- Upload supports CSV, Excel, PDF (OCR for PDF)
- Auto-matching by amount + date proximity
- Manual matching by checkbox selection on both sides
- "Create adjustment" for unmatched statement lines (bank fees, interest)
- Partial matching supported
- Keyboard shortcuts for power users (M to match selected pair)

### 10.3 VAT return preview

**Purpose**: Prepare and export VAT return for IRD submission.

**Key elements**:
- Summary cards: Output VAT, Input VAT, Net VAT Payable, Due Date
- Breakdown sections by tax rate (18%, 0%, exempt, 15%)
- VAT return boxes (IRD form mapping)
- Export button + "Mark as submitted" + payment tracking

**Key UX decisions**:
- Non-editable — just shows computed numbers (edits happen at source transactions)
- Drill-down: click any number to see contributing transactions
- IRD form format preview before export
- Reminder: "Submit to IRD portal directly — PettahPro exports the file, doesn't submit for you"

### 10.4 Period lock confirmation

**Purpose**: Irreversibly close a period with full audit trail.

**Modal layout**:
- Summary of what's being locked (transaction count, P&L, balance sheet)
- Checklist confirmation (bank reconciled, VAT prepared, etc.)
- Consequences stated in plain language
- Required typed confirmation: "Type LOCK MARCH 2026 to confirm"

**Key UX decisions**:
- No shortcut — full confirmation required every time
- Reason field (optional) gets captured in audit log
- "You can still view reports after locking" reassurance
- Cancel always dismisses without side effects

---

## 11. Journey 4 — Payroll run

Monthly high-stakes flow. Precision matters — errors affect employee pay.

### 11.1 Payroll dashboard

**Purpose**: Overview of payroll status, pending tasks, upcoming deadlines.

**Key elements**:
- Status banner: "April 2026 payroll is due in 12 days"
- 4 metric cards: Active employees, Total last month, Employer cost, Average per employee
- Recent runs table (last 5)
- Actions this week (pending approvals, new hires, terminations)
- Upcoming deadlines
- Team health snapshot

**Key UX decisions**:
- Dashboard is actionable — every item has a CTA
- Upcoming statutory filings prominent (EPF, ETF, PAYE deadlines)
- "Start April run" button always prominent when a run is due

### 11.2 Payroll run wizard (6 steps)

**Steps**: Setup → Calculate → Review → Approve → Disburse → Post

Each step has its own screen with clear progression.

**Key UX decisions**:
- Can pause between steps and resume later
- "Back" never loses data — state preserved
- Each step has validation before allowing forward progression
- Review step (step 3) is the most detailed — all employees reviewable

### 11.3 Review calculations screen

**Purpose**: Verify every employee's calculation before approval.

**Key elements**:
- Summary stats (total gross, deductions, net, employer cost)
- Filter tabs: All, With variance, Held, With errors, Manually adjusted
- Table with 8+ columns per employee
- Variance indicators (LOP, OT, commissions, manual adjustments)
- Bulk actions (Hold, Adjust, Recalculate)

**Key UX decisions**:
- Variance rows highlighted — easy to spot unusual numbers
- Tooltip on variance explains cause ("2 days LOP — leave exhausted")
- Clicking employee row opens detail view (section 11.4)
- "Hold" for employees needing investigation — not paid this run
- "Adjust" for manual overrides with required reason

### 11.4 Employee payroll detail

**Purpose**: See/adjust a single employee's calculation.

**Key elements**:
- Employee header with net pay prominent
- Two-column layout: Earnings (left) vs Deductions/Totals (right)
- YTD cumulative summary
- Full breakdown of every component
- Notes section

**Key UX decisions**:
- All amounts clearly labeled with source (contract, formula, statutory)
- Employer contributions shown separately (not in net)
- YTD figures important for year-end and PAYE projections
- Navigation: prev/next employee buttons for bulk review

### 11.5 Approval queue

**Purpose**: Gatekeeper review before payroll disbursement.

**Key elements**:
- Submitted by + submission time
- Workflow stepper showing approval chain
- Summary cards (net pay, employees, statutory)
- Changes from last month comparison
- Risk/attention flags
- Approve | Request changes | Reject buttons

**Key UX decisions**:
- Month-over-month comparison surfaces anomalies
- Flags (OT up 28%) clickable for investigation
- Comment field for approval notes
- Full audit trail of prior approvals/rejections

### 11.6 Disbursement file preview

**Purpose**: Generate bank batch file for salary disbursement.

**Key elements**:
- Source bank account with balance check
- File format selection (bank-specific)
- Transaction date
- Transaction preview (47 employees with their bank details and amounts)
- Verification status per transaction
- File preview (sample rows)

**Key UX decisions**:
- Balance check: "Balance LKR 5.2M — sufficient for LKR 2.4M disbursement"
- Unverified accounts flagged for re-verification before submission
- File doesn't submit to bank — downloads for manual upload to bank portal
- After upload, user marks "Sent to bank" to track clearance
- Failed transactions can be retried or manually paid

---

## 12. Journey 5 — Tenant admin

Configuration and management. Owner-primary, time-bounded access for others.

### 12.1 Users and roles

**Purpose**: Manage who has access to PettahPro and what they can do.

**Key elements**:
- Tabs: Users, Roles, Permissions audit log
- Filter row
- Users table with role chips showing combined roles
- "Invite user" primary action

**Key UX decisions**:
- Role chips show combined roles: "Owner · Accountant · HR"
- Branch access shown per user
- Time-bounded users (external auditors) show expiry
- Invitation flow via email OTP

### 12.2 COA editor

**Purpose**: Manage Chart of Accounts structure.

**Layout**: Two-panel
- Left: Tree view of accounts (expandable hierarchy)
- Right: Selected account details (full config)

**Key UX decisions**:
- System-required accounts shown with lock icon — can rename but not delete
- Drag-drop to reorder (with keyboard fallback)
- "Import from BUSY/Tally" option for migration
- Balance shown inline next to each account
- Archived accounts hidden by default, toggle to show

### 12.3 Subscription management

**Purpose**: Owner manages billing, plan, add-ons.

**Key elements**:
- Current plan card (big, prominent)
- 4 usage cards (users, invoices, storage, branches)
- Active add-ons + available add-ons
- Billing history table
- Payment method management
- Danger zone at bottom (pause, cancel)

**Key UX decisions**:
- Usage progress bars turn amber at 80%, red at 100%
- "Change plan" opens comparison with smooth upgrade path
- Cancellation requires retention flow (reason prompt, alternatives suggested)
- Billing history exportable
- Pause option less destructive than cancel

### 12.4 Branch management

**Purpose**: Configure multi-branch operations.

**Key elements**:
- Branches tab (cards showing each branch with key stats)
- Warehouses tab
- Branch-warehouse mapping matrix tab
- Add branch CTA

**Key UX decisions**:
- HQ branch visibly marked
- Org structure mini-diagram
- Per-branch P&L quick access
- Inter-branch transfers configured here

---

## 13. Journey 6 — Super Admin platform

The platform operator's view. Privacy-first, audit-heavy.

### 13.1 Platform dashboard

**Purpose**: Overall platform health and business metrics.

**Key elements**:
- Privacy lock banner: "You see operational metrics only. No tenant business data."
- 8 KPI cards (tenants, MRR, churn, uptime, response time, tickets, impersonations)
- Signups chart
- Plan distribution donut
- Industry distribution
- Needs attention queue
- Recent events timeline

**Key UX decisions**:
- Privacy banner prominent — reinforces trust
- No tenant business data visible (no invoices, P&L, customer lists)
- Counts only (not values)
- Impersonation activity prominent — super admins see their own surveillance

### 13.2 Tenant directory

**Purpose**: Find and manage tenants (metadata only).

**Key elements**:
- Filter row
- Tenant table with status, plan, user count, last active, MRR (what they pay us, not their revenue)
- No sensitive financial data
- Sidebar: quick filters (with open tickets, in migration, at user limit, etc.)

**Key UX decisions**:
- "MRR" clarified as "what they pay us"
- No columns for tenant revenue, profit, customer count
- Access to individual tenant opens a limited detail view (metadata, status, subscription)

### 13.3 Support console

**Purpose**: Manage support tickets with privacy-respecting access to tenant context.

**Key elements** (single ticket view):
- Ticket header (tenant, reporter, category, priority, SLA)
- Conversation thread (customer messages + agent replies + internal notes)
- Reply composer with tabs for customer-facing vs internal
- Sidebar: ticket actions (impersonate, escalate), tenant snapshot (metadata only), related tickets, engineering diagnostic

**Key UX decisions**:
- Impersonation requires full consent workflow (OTP, time-bound)
- Internal notes visually distinct (mint background)
- Tenant business data never visible — only metadata (plan, users, activity)
- Engineering diagnostics show logs + error codes, never business data

### 13.4 Plan management

**Purpose**: Manage subscription plans and pricing.

**Key elements**:
- Plan cards (4 tiers with current version)
- Feature matrix table
- Tabs for Add-ons, Coupons, Grandfathered versions, Pricing changes log
- Sidebar: coupon activity, pricing experiments, regulatory rules

**Key UX decisions**:
- Plan version history visible — grandfathered tenants protected
- Pricing changes require versioning (not overwriting existing)
- A/B test tracking visible
- "Most popular" ribbon on recommended tier

---

## 14. Mobile-first journeys

Journeys that should be excellent on mobile (where owners actually use the phone).

### 14.1 Mobile approval flow

Owner receives push notification: "3 items need your approval."

**Flow**:
1. Tap notification → opens approval queue
2. Queue shows pending items as swipeable cards
3. Each card: what's being approved, summary, amount, requestor
4. Tap card → opens detail
5. Detail has clear approve/reject buttons at bottom (sticky)
6. Swipe gestures work: swipe right to approve, left to reject (with confirmation)
7. Batch approve: "Approve all similar" option

**Key UX decisions**:
- One-tap approval when trust is high
- Confirmation for high-value items (over LKR 100K)
- Rejection requires reason (can't skip)
- Audit trail captures mobile-initiated approvals

### 14.2 Mobile invoice creation

**Flow** (simplified from desktop):
1. Tap "+" in bottom tab bar → "New invoice"
2. Step 1: Pick customer (search or add new)
3. Step 2: Add items (one at a time, + button reveals item search)
4. Step 3: Review totals, notes
5. Step 4: Send via WhatsApp / email / SMS

**Key UX decisions**:
- Fewer fields on mobile — use defaults heavily
- Voice input supported for notes
- Camera for scanning customer's business card to pre-fill customer
- One-handed reachability — CTAs in thumb zone

### 14.3 Mobile expense claim

**Flow**:
1. Open PettahPro app → "New expense"
2. Tap camera button → take photo of receipt
3. OCR extracts amount, date, vendor
4. User reviews, adjusts if needed
5. Pick category (pre-loaded common categories: meals, travel, supplies)
6. Submit → goes to approval queue

**Key UX decisions**:
- Camera-first is the primary input
- OCR confidence shown per field
- Submit in under 30 seconds for most claims
- Draft saves automatically if user gets interrupted

### 14.4 Mobile notification center

**Flow**: Tap bell icon → full-screen notification list.

**Features**:
- Filter tabs: All, Approvals, Statutory, System
- Swipe to dismiss
- Tap to open related screen
- "Mark all read" action
- Notification preferences link at top

---

## Next steps

With the Brand Kit, UI System, and UX Patterns documents complete, the next workstreams are:

1. **Actual UI mockups** — render the 30+ screens from journeys using Claude Design (prompts in section 8-13 can be given directly)
2. **Migration flow IA** — deferred earlier; the BUSY/Tally migration onboarding experience
3. **API specification** — OpenAPI spec derived from data model
4. **Testing strategy** — QA plan for unit/integration/E2E/load/security
5. **Deployment & DevOps** — IaC, CI/CD, monitoring
6. **Rollout plan** — phased launch, pilot tenants, feedback loops

---

*Document version: 1.0 · UX Patterns · Scope: Sri Lanka only · PettahPro behavior and flow specification*
