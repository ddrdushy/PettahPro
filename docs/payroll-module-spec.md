# Payroll Module Design Spec — Multi-Tenant Accounting SaaS (Sri Lanka)

> Specification for the Payroll module. Target market: **Sri Lanka only**. Scope: **full system, not MVP**. Tightly coupled to Attendance (Layer 2), Accounting (perpetual GL posting), and Inventory (cost allocation for manufacturing employees where relevant).

---

## 1. Scope & Principles

- **Full system, not MVP** — every SL payroll reality covered.
- **SL statutory coverage**: EPF, ETF, PAYE, gratuity, all statutory filings generated for govt portal upload.
- **Attendance-integrated** — attendance from Layer 2 feeds payroll directly (QR, biometric file import, geofence, manual, self check-in).
- **Minimal-entry / Easy Mode** principle applies on every screen (extension of platform-level UX standard).
- **Multi-cycle support** — monthly + weekly + fortnightly combinable within one tenant.
- **Off-cycle runs supported** — bonuses, final settlements, arrears.
- **Payroll periods lock** same way accounting periods lock; corrections require reversal or Owner override.

---

## 2. Wage Structures

### 2.1 Wage types in scope (combinable per employee)
- **Monthly salary** — fixed per month, with proration for partial periods
- **Daily wage** — attendance-driven
- **Piece rate** — per unit produced; requires piece-count capture
- **Hourly** — per hour worked
- **Commission-only** — pure commission on sales
- **Base + commission** — salary floor + sales-driven uplift
- **Base + piece bonus** — monthly minimum + bonus per piece above threshold

Multiple wage types stackable on a single employee (e.g. monthly salary + commission + OT simultaneously).

### 2.2 Salary components — tenant-configured library

Component categories:

**Earnings**
- Basic salary
- Cost of Living Allowance (COLA / BRA — Budgetary Relief Allowance)
- House rent allowance (HRA)
- Transport / travel allowance
- Meal allowance
- Overtime — normal OT, weekend OT, public holiday OT (configurable multipliers)
- Shift allowance / night allowance
- Attendance bonus
- Festival advance (deductible) / Avurudu bonus (non-deductible)
- Performance bonus
- Commission
- Incentive / piece bonus
- Backdated arrears
- Reimbursements (non-taxable — medical, travel)

**Deductions**
- EPF employee contribution (default 8%, configurable)
- PAYE (slab-based)
- Stamp duty (rare but supported)
- Loan recovery (festival, salary advance, housing, emergency)
- Welfare fund / sports club / union dues
- Insurance premiums (if employer-sponsored)
- Meal scheme deduction
- Leave Without Pay (LOP) from attendance
- Attachment orders (court-ordered)

**Employer-only contributions** (disclosed on payslip, not deducted)
- EPF employer (default 12%, configurable)
- ETF (default 3%, configurable)
- Gratuity accrual (computed on termination only, not monthly)

### 2.3 Per-component configuration
Each component has:
- **Formula type**: fixed amount / % of base / formula / attendance-driven / manual each period
- **EPF qualifying** flag (yes/no)
- **ETF qualifying** flag (yes/no)
- **PAYE taxable** flag (yes/no)
- **Proration rule** on partial periods (days-based / hours-based / fixed regardless)
- **GL account mapping** (where the expense posts)

### 2.4 Pay cycles
- **Multi-cycle per tenant** — monthly for staff, weekly for labourers, fortnightly for contractors, all coexisting
- **Per-cycle pay period dates** — typical SL: 1st–end of month OR 21st–20th (delayed cycle for attendance cut-off)
- **Off-cycle runs** — ad-hoc bonus payrolls, final settlements, arrears payments

---

## 3. Employee Master

### 3.1 Personal
- NIC number (required for SL statutory)
- Date of birth, gender, marital status
- Nationality
- Passport (for foreign workers)
- Emergency contact

### 3.2 Employment
- Employee ID / payroll number
- Date of joining
- Designation / job title
- Department (tenant-defined or free text)
- Reporting manager
- Employment type (Permanent / Contract / Casual / Probation / Intern)
- Confirmation date (post-probation)
- Primary work location (branch)
- **Multi-branch allocation** — employee can be listed at multiple branches with % split (salary cost allocated accordingly)
- Branch change history with effective dates

### 3.3 Statutory
- EPF member number
- ETF number
- PAYE file number
- Tax file number
- Self-managed vs CBSL-managed EPF flag

### 3.4 Banking
- Bank name, branch, account number (for salary disbursement)
- Alternative payment method (cash / cheque for some labour)

### 3.5 Salary structure
- Base salary / daily rate / piece rate
- Assigned component template (which earnings/deductions apply)
- EPF/ETF rate override (default 8%/12%/3%; can raise but not drop below statutory)
- Statutory start dates (handle probation exclusion if tenant chooses)

### 3.6 Exit
- Date of resignation / termination
- Reason code
- Final settlement processed flag
- Clearance checklist completion

---

## 4. Statutory Compliance

### 4.1 EPF / ETF (tenant-configurable)
- **Employee EPF**: 8% default, configurable per employee (can raise above statutory)
- **Employer EPF**: 12% default, configurable
- **ETF**: 3% default, configurable
- **Per-component qualifying flag** — tenant decides which earnings are EPF/ETF qualifying
- **Eligibility start date** per employee — handles probation exclusion scenarios
- **Self-managed vs CBSL-managed** fund flag per tenant; affects return file format
- **EPF C-form** generated monthly for CBSL EPF Department upload
- **ETF return** generated monthly for ETF Board upload

### 4.2 PAYE (tenant-configurable)
- **Slab definitions** — tenant configures (with Layer 1 push when govt changes)
- **Tax-free threshold** configurable
- **Progressive slab rates** configurable
- **Annualization method** — month × 12 OR cumulative-to-date (tenant picks)
- **Deductible allowances** — contributions to approved funds, qualifying payments
- **Exemption categories** — resident/non-resident, primary/secondary employer, special employee categories
- **PAYE return file** (Form T-10 data) generated monthly for IRD portal upload
- **Annual statement of remuneration** (Form T-10 equivalent) generated per employee at year-end for their personal tax return

### 4.3 Gratuity (simplified — termination only)
- **No monthly accrual** — reduces complexity
- Computed at termination per Gratuity Act (14 days' basic salary per year of service, min 5 years tenure)
- Settlement amount computed automatically
- Posted to *Gratuity Expense* + *Gratuity Payable* at termination
- PAYE exemption applied per SL tax rules
- Gratuity report shows liability by employee + tenure

### 4.4 Statutory returns & filing checklist
- **EPF C-form** — monthly, CBSL EPF Department (or approved fund)
- **ETF return** — monthly, ETF Board
- **PAYE remittance** (Form T-10 data) — monthly, IRD
- **Annual employee statement** — year-end, per employee
- **Employer's annual declaration** (Form T-9) — year-end
- **Stamp duty return** — quarterly (where applicable)
- **Filing checklist per period** — shows what's due, what's filed, with submission dates captured for audit
- **No direct API filing** — tenant uploads files to respective govt portals themselves

### 4.5 Minimum wage compliance
**Skipped** — tenant/HR manages externally.

---

## 5. Leave Management

### 5.1 Leave type library (tenant-configured)
Ships with SL standards pre-loaded; tenant customizes:
- **Annual leave** (14 days shop/office default; 7 days casual) — earnable, carryforward-able
- **Casual leave** (7 days default)
- **Medical leave** (7 days default, doctor's certificate optional requirement)
- **Maternity leave** (84 working days per Shop & Office Act)
- **Paternity leave** (3 days default)
- **Short leave / half-day leave**
- **Special leave** — bereavement, marriage, study (tenant-defined)
- **Leave Without Pay (LOP)** — explicit or attendance-triggered

### 5.2 Per-leave-type configuration
- Default entitlement (days per period)
- Accrual rule (immediate / monthly / yearly / anniversary-based)
- Carry-forward policy (max days, expiry)
- Max balance cap
- Approval workflow (manager only / manager + HR / skip approval)
- Documentation requirement (doctor's certificate, etc.)
- Encashable on termination yes/no
- Paid yes/no

### 5.3 Workflow
- **Self-service application** — employee applies via portal
- **Manager approval** — routed per tenant hierarchy
- **Payroll integration** — approved leave considered in next run (LOP deducted, paid leave doesn't reduce pay)
- **Balance tracking** — per employee per type, running balance visible
- **Auto-accrual** on periodic basis per policy
- **Attendance integration** — missing punches / absences can auto-trigger leave application requests
- **Encashment on termination** — per leave type policy; max balance encashment optional
- **LOP computation** — unauthorized absences → auto-LOP days → deduction from pay

---

## 6. Loans & Advances

### 6.1 Loan type master (tenant library)
Ships with common SL types:
- **Festival advance** — Avurudu/Christmas, interest-free, 3–12 month recovery
- **Salary advance** — mid-month, repaid next payroll
- **Housing loan** — 3–5 years, interest-bearing allowed
- **Vehicle loan** — similar
- **Emergency loan** — medical, funeral

Each type configures:
- Max amount (absolute or % of salary)
- Interest rate (0% allowed)
- Max tenure in months
- Approval hierarchy
- Eligibility rules (employment type, min tenure, etc.)

### 6.2 Workflow
- Employee applies via self-service
- Manager + Owner approval per configured hierarchy
- Disbursement as cash/bank transaction (GL: Debit Employee Loan, Credit Bank/Cash)
- **Auto-generated EMI schedule** — principal + interest (if any) spread over tenure
- Integrated into payroll as automatic deduction component for the tenure duration
- **Loan ledger** per employee — principal outstanding, interest accrued, repayments made
- **Early settlement** — employee can repay full balance; settlement amount auto-computed
- **Termination handling** — outstanding balance auto-deducted from final settlement; shortfall becomes recovery claim

---

## 7. Bonus & Off-Cycle Payouts

### 7.1 Bonus scheme library
Tenant configures schemes (common SL schemes pre-loaded):
- **Avurudu bonus** — typically half-month to one-month salary, all employees
- **Christmas bonus** — similar
- **Performance bonus** — annual, variable by rating
- **13th-month salary** — December full extra month
- **Attendance bonus** — rewards for zero/minimal absenteeism
- **Long-service bonus** — at tenure milestones

### 7.2 Per-scheme configuration
- Trigger date / window
- Eligibility rules (all permanent / performance rating X+ / tenure Y+ / department)
- Formula (flat amount / % of basic / days of salary / manual per employee)
- PAYE treatment — taxed at special rate OR annualized over 12 months
- EPF/ETF qualifying flag
- Communication template — bonus memo/letter generated per employee

### 7.3 Bulk bonus run
- Owner triggers scheme
- System computes per employee based on scheme rules
- Owner reviews list, adjusts if needed
- Approves → processes as off-cycle payroll run
- Payslips + bonus memos generated together

---

## 8. Expense Claims

### 8.1 Scope
Employee expense claims handled within Payroll module (not separated). Covers:
- Travel (domestic / overseas)
- Meal / customer entertainment
- Fuel / mileage
- Communication
- Miscellaneous

### 8.2 Workflow
- **Claim submission** — employee uploads receipts (Tesseract OCR extracts vendor/date/amount per minimal-entry principle)
- **Category selection** — from tenant library; each category maps to GL account
- **Approval workflow** — manager, with Owner override threshold
- **Disbursement** — bundled with next salary OR separate payment (claim-level choice)
- **Taxability flag** per category — most reimbursements non-taxable under SL rules
- **Claim history** per employee, total YTD
- **Rejection with reason** supported; resubmission allowed

---

## 9. Final Settlement (Exit Payroll)

Triggered on resignation or termination.

### 9.1 Components computed automatically
- **Pro-rata salary** for month up to last working day
- **Unused annual leave encashment** per leave policy
- **Gratuity** — if eligible (≥5 years tenure)
- **Notice period settlement**:
    - If resigning without notice → deduction
    - If terminated → pay in lieu of notice
- **Outstanding loan recovery** — all active loans' remaining balance deducted
- **Pending expense claims** — approved claims paid out
- **Final PAYE reconciliation** — full-year tax computed against YTD deducted; refund or extra owed
- **Final EPF/ETF contributions** on last earnings

### 9.2 Workflow
- HR initiates exit in employee master
- System pre-fills settlement worksheet with all computed components
- Owner + Accountant review
- Approve → disburse → GL entries posted
- **Settlement document** generated — itemized breakdown
- **Clearance checklist** — laptop returned, access revoked, assets handed over, keys returned
- Ex-employee marked inactive; access revoked across all modules
- **Statutory filing updates** — EPF withdrawal claim generation, PAYE last entry

---

## 10. Payslip Design

### 10.1 Format
- **PDF** (primary) — downloadable, printable, emailable
- **HTML** view in self-service portal
- **Physical print option** — for labour without email/portal access (flag on employee master)

### 10.2 Content
- **Employer header** — name, address, EPF/ETF registration numbers
- **Employee details** — name, NIC, employee ID, designation, department
- **Pay period dates**
- **Earnings section** — every earning component line-itemized
- **Deductions section** — every deduction line-itemized
- **Employer contributions** — EPF employer + ETF shown as information (disclosed, not deducted)
- **Net pay** — gross − deductions
- **YTD columns** — year-to-date totals alongside current period
- **Leave balance** — current balance per leave type
- **Loan balance** — outstanding principal + months remaining per active loan
- **Bank disbursement details** — last 4 digits of account
- **Authorized signatory**
- **Payslip number** + timestamp + digital fingerprint (for verification)

### 10.3 Delivery
- Email PDF to employee on run completion
- Available anytime in self-service portal (3-year retention default, configurable)
- Physical print option per employee flag
- **Password-protected PDF** — NIC as password (SL convention)

---

## 11. Salary Disbursement

### 11.1 Bank transfer (majority)
- **Bank disbursement file** generated per bank in bank's required format:
    - Commercial Bank — CSV
    - HNB — Excel
    - Sampath — Excel
    - BOC — fixed-width text
    - People's Bank — CSV
    - NDB, NSB — respective formats
- **One file per bank** — employees grouped by their bank
- **SLIPS batch file** for inter-bank transfers via SLIPS/CEFTS
- Accountant uploads file to bank portal; bank processes en masse

### 11.2 Cash disbursement
- **Cash disbursement sheet** per branch
- Employees sign against name on receipt
- Posted as petty cash disbursement (ties into Petty Cash module from Layer 2)

### 11.3 Cheque disbursement
- Cheque print file generated
- Ties into Cheque module (issued side, Layer 2)

### 11.4 Mixed disbursement per run
- Same payroll run can disburse via multiple methods
- System groups employees by method, generates appropriate outputs per group

---

## 12. Payroll Run Workflow

### 12.1 Six-step process

**Step 1 — Pre-run checks (system-enforced)**
Red/green checklist:
- [ ] All attendance records for period captured
- [ ] All leave applications approved/rejected
- [ ] All loan applications processed
- [ ] All bonus/incentive entries finalized
- [ ] All expense claims approved (if bundling)
- [ ] No unresolved attendance exceptions

Run blocked if mandatory items incomplete.

**Step 2 — Generate draft**
- System computes draft for all employees in cycle
- Pre-run report: total gross, total deductions, total net, total employer cost, headcount, exception count
- Side-by-side comparison with previous run — flags big variances for review

**Step 3 — Review and adjust**
- HR / Accountant reviews per-employee breakdown
- Manual adjustments with reason logged (e.g. one-off incentive, OT correction)
- Re-compute after adjustments
- Manual Adjustment Log captures every edit

**Step 4 — Approval**
- Owner approves (or delegated approver per tenant config)
- Approval locks the run

**Step 5 — Process**
- Post GL entries (see Section 13)
- Generate payslips
- Generate disbursement files (bank / cash / cheque)
- Update loan balances
- Update leave balances (LOP processed)
- Update YTD figures per employee

**Step 6 — Post-run**
- Payroll run marked **immutable**
- Any corrections require reversal run or Owner override
- Full audit trail captured

---

## 13. Accounting Integration (GL Posting Map)

Every payroll run generates a batch journal with these entries:

| Entry | Debit | Credit |
|---|---|---|
| Gross salary expense (by dept/branch) | Salary Expense | Salary Payable |
| Employer EPF contribution | EPF Employer Expense | EPF Employer Payable |
| Employer ETF contribution | ETF Expense | ETF Payable |
| Employee EPF deduction | Salary Payable | EPF Employee Payable |
| PAYE deduction | Salary Payable | PAYE Payable |
| Loan recovery | Salary Payable | Employee Loan (asset reduction) |
| Other deductions (welfare, union, insurance) | Salary Payable | Respective Payable |
| LOP | — | Reduces gross itself (no separate entry) |
| Net salary disbursement | Salary Payable | Bank / Cash / Cheque-in-hand |
| Gratuity on termination | Gratuity Expense | Gratuity Payable |
| Statutory remittance (EPF/ETF/PAYE to govt) | Respective Payable | Bank |
| Bonus accrual (off-cycle) | Bonus Expense | Bonus Payable |
| Expense claim reimbursement | Expense Category (by claim type) | Bank / Salary Payable |
| Leave encashment | Salary Expense | Salary Payable |

- **Department / branch / cost-center tagging** flows from employee master through to GL
- **Posting granularity** — tenant chooses: one line per employee per component (full detail audit) OR summarized per component (simpler)
- **Multi-branch salary split** — if employee has branch allocation %, salary expense split accordingly in GL

---

## 14. Mid-Period Events

### 14.1 Mid-period joiner
- Pro-rata salary = (days worked / total days in period) × full salary
- EPF/ETF on actual paid amount
- PAYE annualization adjusts
- Leave accrual starts from joining date (no back-credit)

### 14.2 Mid-period leaver
- Pro-rata salary up to last working day
- Triggers final settlement flow (Section 9)
- Leave balance encashed or lapses per policy

### 14.3 Probation confirmation crossing mid-period
- Components kicking in on confirmation (e.g. confirmation bonus, higher HRA) prorate from confirmation date forward

### 14.4 Salary revisions and back-dated changes
- **Revision entry** per employee: effective date + new components/amounts
- **Arrears auto-computed** — difference between old and revised for intervening period → added to next payroll as *Arrears* earning line
- **PAYE on arrears** — tenant chooses: tax in period received (simpler) OR spread back to effective period (accurate)
- **Back-dated crossing closed payroll periods** — requires Owner override (same lock mechanism as accounting periods)
- **Revision history** immutable

### 14.5 Multi-branch employee handling
- **Home branch** tracked in master (primary cost center)
- **Branch change history** with effective dates
- **Salary expense split pro-rata** between branches if transfer mid-period
- **Multi-branch assignment** — % allocation per branch → salary cost split in GL
- Branch-level payroll reports reflect splits correctly

---

## 15. Employee Self-Service Portal

### 15.1 For employees with login
- **Dashboard** — current month's expected pay, leave balance, loan balance
- **Payslip download** — current + historical (3-year retention default, configurable)
- **Leave application** — apply, track status, team calendar view
- **Attendance view** — own log, regularization request submission
- **Loan application** — apply, track repayment progress
- **Expense claim** — submit with receipt photo, track approval
- **Profile update** — personal details (bank account change, emergency contact, address) — changes route through HR approval
- **Documents** — payslips, annual tax certificates, appointment letter, HR-shared docs
- **Tax declarations** — annual IT declaration (investments, allowances) for PAYE computation

### 15.2 Supervisor-proxy mode (for labour without portal access)
- Supervisor/HR enters leave/loan/expense on behalf of employee
- Payslip printed and handed over physically
- Acknowledgment captured (signature / thumbprint / photo)

---

## 16. Reports

### 16.1 Pay-run reports
- Pay register (per-employee breakdown of all runs in period)
- Pay summary (totals per cycle)
- Department / branch-wise payroll cost
- Earning / deduction analysis
- Gross-to-net reconciliation

### 16.2 Statutory
- EPF return (C-form data)
- ETF return
- PAYE remittance (monthly)
- Annual employee statement (T-10 equivalent)
- Employer annual declaration (T-9)

### 16.3 Employee-level
- Employee payroll history (all pay periods)
- Leave ledger per employee
- Loan ledger per employee
- Expense claim ledger
- Annual compensation statement

### 16.4 HR analytics
- Headcount by department / branch / employment type
- Attrition rate
- Average salary by designation
- OT trend
- LOP trend (attendance discipline indicator)
- Gender pay analysis (compliance reporting)
- Tenure distribution

### 16.5 Cost reports
- Total employee cost (gross + employer EPF + employer ETF + gratuity accrual)
- Cost per employee
- Budget vs actual (ties into Accounting's budget module)

### 16.6 Audit reports
- Payroll run history with approver names
- Manual adjustment log
- Access log (who viewed which payslip)
- Statutory filing log

All exportable to Excel / CSV / PDF; schedulable email delivery via custom report builder.

---

## 17. Permissions & Approval Workflows

All roles, permissions, and approval chains persist in the `roles` / `role_permissions` / `user_roles` tables defined in `data-model-02-identity.md §4`. Approval workflows use `approval_workflow_templates` (Part 7) + `approval_instances` / `approval_steps` (Part 5). This section enumerates the payroll-specific permission keys and default chains.

### 17.1 Roles that interact with Payroll (defaults; tenants can customize)

| Role | Default scope | Payroll capabilities |
|---|---|---|
| **HR Admin** | Tenant-wide | Employee master CRUD, salary structure, statutory setup, initiate payroll runs, final settlement. Cannot approve own run. |
| **HR Officer** | Branch | Add/edit employees in assigned branches, attendance + leave handling, initiate expense/loan claims on behalf of employees. |
| **Payroll Accountant** | Tenant-wide (financial) | Review run calculations, pre-approve before GL post, approve disbursement file generation, reconcile deductions. |
| **Owner / Finance Head** | Tenant-wide | Final approval on payroll runs above threshold, bonus runs, salary revisions, loan write-offs. |
| **Department Head / Supervisor** | Reporting tree | Leave approval for direct reports (tier 1), expense approval up to cap, attendance attestation. |
| **Employee (Self-service)** | Self | View payslips, apply leave, submit expense claims, view loan schedule, update non-sensitive personal fields. |
| **External Auditor** | Tenant-wide (read) | Read-only on payroll runs, GL postings, statutory returns. Time-bounded (`user_roles.expires_at`). |

### 17.2 Permission keys (`role_permissions.module = 'payroll'`)

| Action key | Typical grantees | `conditions_json` |
|---|---|---|
| `payroll.view_employee_master` | HR Admin, HR Officer, Payroll Accountant | `{"scope":"branch"}` for HR Officer |
| `payroll.edit_employee_master` | HR Admin, HR Officer | — |
| `payroll.view_sensitive_fields` | HR Admin, Owner | NIC, bank account, salary gate — hidden for others |
| `payroll.edit_salary_structure` | HR Admin | — |
| `payroll.approve_salary_revision` | Owner, Finance Head | `{"max_revision_pct": 25}` beyond which higher approver needed |
| `payroll.initiate_payroll_run` | HR Admin, Payroll Accountant | — |
| `payroll.approve_payroll_run` | Owner, Finance Head | `{"threshold_lkr": 2500000}` — below routes to Finance Head only |
| `payroll.manual_adjust_line` | Payroll Accountant, HR Admin | `{"max_adjust_pct": 10, "reason_required": true}` |
| `payroll.generate_disbursement_file` | Payroll Accountant | — |
| `payroll.approve_leave` | Supervisor, HR Admin | `{"max_days": 5}` for Supervisor; beyond → HR Admin |
| `payroll.approve_loan` | HR Admin, Owner | `{"max_loan_lkr": 100000}` for HR Admin; above → Owner |
| `payroll.approve_bonus_run` | Owner, Finance Head | `{"threshold_lkr": 500000}` |
| `payroll.approve_expense_claim` | Supervisor, HR Admin, Owner | 3-tier by claim amount cap |
| `payroll.approve_final_settlement` | Owner, Finance Head | Always — no cap |
| `payroll.void_payroll_run` | Owner | Only before disbursement; creates reversal run audit trail |
| `payroll.view_reports` | HR Admin, Payroll Accountant, Owner | — |
| `payroll.file_statutory_return` | Payroll Accountant, HR Admin | — |

### 17.3 Default approval chains

| Document | Chain |
|---|---|
| **Payroll run** | HR Admin initiates → Payroll Accountant reviews → Finance Head approves (if `total ≤ threshold_lkr`) → Owner approves (if above). Bypass possible with `self_approval=true` only for single-owner tenants. |
| **Bonus run** | HR Admin initiates → Finance Head approves → Owner approves (if total > cap). |
| **Salary revision** | Supervisor proposes → HR Admin validates → Owner approves (if revision % > cap). |
| **Leave application** | Employee submits → Supervisor approves (tier 1, ≤ cap days) → HR Admin approves (tier 2 for long leave or sensitive types like maternity). Half-days follow same chain. |
| **Loan application** | Employee submits → HR Admin validates eligibility → Owner approves (if amount > HR cap). Disbursement triggers payroll deduction schedule. |
| **Expense claim** | Employee submits → Supervisor approves (tier 1, ≤ supervisor cap) → HR Admin (tier 2) → Owner (tier 3 beyond HR cap). Petty cash reimbursement short-circuits to cashier if flagged. |
| **Final settlement** | HR Admin initiates exit payroll → Payroll Accountant computes + reviews → Finance Head approves → Owner co-approves. No bypass. |
| **Payroll run void** | Owner-only action; reversal run auto-generated with link back to voided run. |

### 17.4 Segregation of duties (enforced)

- **No self-approval**: initiator of a payroll run cannot be an approver in the same run (`allow_self_approval=FALSE` on template).
- **No self-settlement**: an HR Admin cannot approve their own final settlement.
- **Supervisor cannot approve own leave or expense**: system auto-routes to skip-level on detection.
- **Sensitive field edits always audited**: NIC, bank account, salary amount changes log before/after snapshots in `audit_log` with `sensitive=TRUE`.

### 17.5 Self-service scope (Employee role)

Employees have **write** access only to: leave applications, expense claims (own), loan applications (own), personal contact fields (phone, address, emergency contact). All other fields are **read-only**. Salary structure, statutory numbers, EPF/ETF contributions are read-only always.

### 17.6 Supervisor-proxy mode

For labour without portal access (noted in `tenant-admin-ux-spec.md` and §15.2), a Supervisor may submit leave/expense on behalf of an employee. The `on_behalf_of_user_id` field on each document ties the entry back to the subject employee; the Supervisor's approval in the chain does **not** count as self-approval in that scenario.

---

## 18. Data Model — Payroll Entities (Overview)

```
Tenant
  ├── Employee (1:1 link with User from Layer 2)
  │     ├── EmployeePersonalDetails
  │     ├── EmploymentHistory (designation, dept, branch over time)
  │     ├── SalaryStructure (active + historical with effective dates)
  │     ├── StatutoryProfile (EPF#, ETF#, PAYE#, rates)
  │     ├── BankDetails
  │     └── ExitRecord (nullable)
  ├── SalaryComponent (1:n — tenant library)
  ├── ComponentTemplate (1:n — groupings applied to employees)
  ├── PayCycle (1:n — monthly/weekly/fortnightly)
  ├── PayrollRun (1:n per cycle per period)
  │     ├── PayrollLine (1:n per employee per component)
  │     ├── PayrollApproval (workflow state)
  │     └── ManualAdjustmentLog
  ├── Payslip (1:n per employee per run)
  ├── DisbursementFile (1:n generated per bank per run)
  ├── LeaveType (1:n — tenant library)
  ├── LeaveBalance (1:1 per employee per leave type)
  ├── LeaveApplication (1:n)
  ├── LeaveAccrualLog (1:n)
  ├── LoanType (1:n — tenant library)
  ├── EmployeeLoan (1:n per employee)
  │     ├── LoanRepaymentSchedule
  │     └── LoanLedger
  ├── BonusScheme (1:n)
  │     └── BonusRun (1:n per scheme execution)
  ├── ExpenseClaim (1:n)
  │     └── ClaimReceipt (1:n attachments with OCR metadata)
  ├── StatutoryReturn (1:n — EPF/ETF/PAYE per period)
  │     └── FilingLog (submission date, reference#)
  ├── GratuitySettlement (1:n — computed on termination)
  ├── SalaryRevision (1:n per employee with effective date)
  ├── ArrearsCalculation (1:n linked to revisions)
  ├── BranchAllocation (1:n per employee per period with % split)
  └── PayrollAuditLog
```

All entities tenant-scoped via Postgres Row-Level Security.

---

## 19. SL-Specific Bakes

- EPF 8%/12% default rates, tenant-configurable above statutory
- ETF 3% default, tenant-configurable
- PAYE slabs configurable (Layer 1 push on govt changes + local override)
- Gratuity Act formula (14 days basic per year of service, 5-year eligibility)
- Maternity leave 84 working days (Shop & Office Act)
- COLA / BRA pre-configured as earning component
- Major SL bank file formats (Commercial Bank, HNB, Sampath, BOC, People's, NDB, NSB) + SLIPS batch
- NIC-password-protected payslip PDFs (SL convention)
- Form T-10 (annual employee statement) and T-9 (employer annual declaration) generation
- Avurudu bonus scheme pre-loaded
- Festival advance loan type pre-loaded

---

## 20. Deferred to Later Phases

- Direct govt portal API filing (IRD, EPF, ETF) — when reliable APIs available
- Biometric-to-attendance-to-payroll real-time pipeline beyond current batch flow
- Advanced HR analytics (DEI reporting beyond gender pay, 9-box performance grids)
- 360 performance review workflow
- Recruitment / ATS module (separate future module)
- Training / learning management (separate future module)
- Minimum wage sector-level validation
- Multi-country payroll (SL-only scope; ignores MY/IN realities)

---

## 21. Next Steps

Next in queue:
1. **Sell module UX** — invoicing + POS (tenant activation path)
2. **Buy module UX** — GRN + Bill matching + landed cost capture
3. **Migration flow IA** — BUSY/Tally/QuickBooks/Excel to our platform
4. **Pricing plan architecture** — Starter / Growth / Scale feature gating + LKR pricing
5. **Super Admin (Layer 1) dashboard spec**
6. **Data model deep dive** — full ERD with RLS policies

---

*Document version: 1.0 · Module: Payroll · Scope: Sri Lanka only · Full system (not MVP) · Owner: Automation Practice · Prepared for multi-tenant accounting SaaS (BUSY replacement)*

*Decisions consolidated across 5 rounds covering: 7 wage types combinable, tenant-configured component library, multi-cycle with off-cycle runs, full employee master, tenant-configurable EPF/ETF/PAYE, simplified gratuity (termination only), full statutory return generation, full leave management with self-service, full loan module with EMI schedule, bonus scheme library with bulk runs, full expense claims as payroll sub-module, comprehensive final settlement workflow, rich payslip design, multi-method disbursement (bank files per SL bank + SLIPS + cash + cheque), 6-step payroll run workflow, full Accounting GL integration map, mid-period event handling (joiners, leavers, revisions, arrears, multi-branch), employee self-service portal + supervisor-proxy mode, full report suite, permissions and approval workflows with per-role capability matrix + `conditions_json` thresholds per action (salary revision %, payroll run LKR, loan cap, bonus run cap, expense tier caps) + enforced segregation of duties (no self-approval, no self-settlement, skip-level on own-leave) + sensitive field audit logging + supervisor-proxy chain handling, and comprehensive data model.*
