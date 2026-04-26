---
title: Payroll
sidebar_position: 1
---

# Payroll

## Overview

Payroll is the monthly cycle that pays employees and remits the statutory deductions — **EPF**, **ETF**, and **PAYE** — to the relevant authorities. PettahPro models payroll as a **payroll run** (one per pay period per group of employees) that, on approval, posts the salary expense, books the employer-side liabilities, and generates the per-employee payslip PDFs. Form C (EPF), the ETF schedule, and the PAYE return are produced as exportable files at month-end.

## Walkthrough

A typical month looks like this.

### 1 — Confirm employee data is current

Visit `/app/hr/employees`. Make sure new hires are added and exits are marked. Each employee needs:

- **Salary structure** — basic + the components that apply (allowances, transport, etc.).
- **EPF/ETF number** — required for the Form C and ETF schedule.
- **Tax-relevant info** — TIN if applicable, and any tax-residency or exemption flags.
- **Bank details** — account number and branch for the disbursement file.

### 2 — Process variable inputs

Anything that varies month-to-month is captured before the run:

- **Attendance / leave** — pulled from the leave module (or from the optional attendance module if you use it). Unpaid leave reduces the run; paid leave doesn't.
- **Loan repayments** — the active **staff loan** module schedules these and surfaces them on the run automatically.
- **One-off bonuses or allowances** — added via the run's **adjustments** section, or created as a separate **bonus run**.
- **Expense claims** — approved claims can be added to the salary run for disbursement, or paid separately.

### 3 — Create the payroll run

Visit `/app/payroll/runs/new`.

1. Pick the **pay period** (month or fortnight).
2. Pick the **employee group** — usually "all active", but you can run sub-groups (e.g. salaried vs. hourly) separately if your structure needs it.
3. Click **Calculate**.

The system computes for each employee:
- **Gross** = sum of salary components for the period (prorated for joiners/exits).
- **EPF (employee 8%)** — deducted from gross.
- **PAYE** — computed from year-to-date taxable earnings using the bracket table.
- **Other deductions** — loan repayments, advances, salary advances, etc.
- **Net pay** = gross − EPF − PAYE − other deductions.

It also computes employer-side amounts (not deducted, but booked):
- **EPF (employer 12%)**
- **ETF (3%)**

The result lands in **Draft** status. Review the per-employee table, drill into anyone whose number looks off, and adjust as needed.

### 4 — Approve and post

Click **Approve** when you're satisfied. The system:

- Locks the run (no further edits).
- Books the salary journal (see Behind the scenes).
- Generates the per-employee payslip PDFs.
- Adds the totals to **EPF payable**, **ETF payable**, **PAYE payable** for end-of-month remittance.

### 5 — Disburse net pay

Visit the run's **Disbursement** tab. Two options:

- **Generate bank file.** Produces the bank's expected CSV/text format for bulk salary credit. Upload to your corporate banking portal.
- **Mark as paid manually.** For tenants paying by cheque or internal transfer.

Either way, the disbursement step books `DR Salaries payable / CR Bank` for the disbursed amount and flips the run to **Paid**.

### 6 — Send payslips

Open the run → **Send payslips**. Each employee with an email gets their payslip PDF as an attachment. Employees can also self-serve via the employee portal if you've enabled it.

### 7 — End-of-month statutory remittance

Visit `/app/payroll/statutory`.

- **EPF Form C** — exports the file in the EPF Department's expected format. File via the EPF e-portal; once paid, post a payment against the **2300 EPF payable** account to clear the balance.
- **ETF schedule** — same shape, ETF Board format.
- **PAYE return** — monthly summary; remit via IRD e-Services.

PettahPro produces the data; you file and remit via the relevant portals.

## Common tasks

### Add a new salary component

Visit `/app/payroll/components`. Define the component's name, calculation rule (fixed amount, percentage of basic, or formula), tax treatment (taxable / non-taxable), and EPF treatment (counts towards EPF or not). Then add it to the relevant employees' salary structures.

### Process a final settlement (employee leaving)

Use the **Final settlement** flow at `/app/payroll/settlements/new` rather than a normal run. It computes:

- Pro-rated salary for the partial month worked.
- Accrued leave encashment.
- Gratuity (if eligible — typically 5+ years service).
- Final EPF/ETF/PAYE on the above.
- Settlement of any outstanding loan or advance.

It produces a **settlement letter** — a separate document type with its own template.

### Reverse a posted run

You can't edit, but you can reverse: open the run → **Reverse**. This books the inverse journal and unlocks the run for re-processing. The original run stays in the audit trail with status **Reversed**.

### Run a bonus separately

Use the **Bonus run** at `/app/payroll/bonus-runs/new` for one-offs (festival bonus, performance bonus). It's a slimmer version of the payroll run — picks up the bonus amount per employee, applies PAYE, optionally applies EPF if the bonus is EPF-bearing, and disburses.

### Multi-currency employees

If you employ someone in a foreign currency: set their salary structure in that currency. The run computes their gross in their currency, applies PAYE on the LKR-equivalent (per IRD rules), and books to the GL in LKR at the run's FX rate.

## Behind the scenes

### Journal entry on approval

For a single employee with salary 100,000, EPF (employee) 8,000, EPF (employer) 12,000, ETF 3,000, PAYE 5,000:

```
DR  6100 Salaries — gross         100,000
DR  6110 EPF — employer            12,000
DR  6120 ETF — employer             3,000
    CR  2300 EPF payable           20,000   (8k employee + 12k employer)
    CR  2310 ETF payable            3,000
    CR  2320 PAYE payable           5,000
    CR  2400 Salaries payable      87,000   (100k − 8k EPF − 5k PAYE)
```

The disbursement step then books `DR 2400 Salaries payable / CR 1010 Bank` for 87,000.

Loan repayments inside a run net against the loan balance:

```
DR  2400 Salaries payable           [repayment]
    CR  1300 Staff loans receivable [repayment]
```

The employee's net pay is reduced accordingly.

### Tables touched

- `payroll_runs` — header.
- `payroll_run_lines` — one row per employee per component (salary, EPF, ETF, PAYE, allowances, deductions, loan repayments).
- `journals` + `journal_lines` — the GL posting.
- `staff_loans` + `staff_loan_repayments` — repayment ledger.
- `leave_balances` — adjustments for leave taken / encashed.
- `audit_events` — approver, time, IP.

### What's enforced

- **Period not locked.** Run period must be in an open accounting period.
- **No overlapping runs.** Two approved runs cannot cover the same employee in the same period.
- **PAYE bracket validity.** The bracket table must have an effective row for the run's pay-period date.
- **EPF/ETF caps.** Component flags determine whether each component contributes to EPF/ETF gross — wired in, not configurable per-run.
- **Approver permission.** Only roles with `payroll.approve` can move a run from Draft to Approved.

### Statutory file formats

The exporters at `/app/payroll/statutory` produce files in the formats specified by the relevant authority — these are versioned in code (not configurable) so they can be updated centrally when the authority changes the spec.

## FAQ

**Can a run mix monthly and hourly employees?**
Yes — the calculation rule is per-component, not per-run. An hourly employee just has a component whose rule is "rate × hours from attendance".

**Salaries for the run look right but the bank file is rejected.**
Almost always a bank-account-format issue. Check that every employee in the run has an account number and branch code in the format your bank expects. Settings → Payroll → Bank export format lets you pick the right template.

**An approved run had a wrong amount for one employee — what's the cleanest fix?**
Reverse the run, fix the input (e.g. attendance, salary structure), re-approve. If you've already disbursed and the employee has been paid the wrong amount, the cleanest path is to absorb the variance into next month's run via an adjustment line — auditors prefer the trail to closure-and-restart-from-scratch.

**EPF/ETF rates change in the budget. Do I update them?**
No. They're wired into the system as defaults and updated centrally in a release when the budget changes them. You don't configure 8/12/3 per tenant.

**PAYE is showing zero for someone earning over the threshold.**
Check (a) their YTD taxable earnings — if you imported mid-year, you need an opening YTD entry; (b) any active exemption flags on the employee; (c) the bracket table's effective dates for the run period.

## Related modules

- [Employees](../hr/payroll) — master data.
- [Leave](../hr/payroll) — feeds the run.
- [Staff loans](../hr/payroll) — repayments net against pay.
- [Bonus runs](../hr/payroll) — one-off payments.
- [Final settlements](../hr/payroll) — exits.
- [Period lock](../accounting/period-lock) — closing the month after payroll.
