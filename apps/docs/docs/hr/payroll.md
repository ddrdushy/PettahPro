---
title: Payroll
sidebar_position: 1
---

# Payroll

## What it does

Payroll is the monthly cycle that pays your employees and remits the statutory deductions — **EPF**, **ETF**, and **PAYE** — to the relevant authorities. PettahPro takes care of the calculations, generates the per-employee payslips, books the salary expense and the related liabilities to your books, and produces the files you need for filing.

A payroll run is one set of payments for one pay period (usually a month). On approval, payslips are generated, salary moves into the "ready to pay" stage, and the EPF/ETF/PAYE amounts are added to what you owe Inland Revenue and the funds.

## Walkthrough

A typical month looks like this.

### 1 — Make sure your employee records are up to date

Open **HR → Employees**. Make sure new hires have been added and anyone who's left has been marked as exited. For each employee you need:

- **Salary structure** — basic plus any allowances, transport, etc.
- **EPF/ETF number** — required for the filings.
- **Tax info** — TIN if applicable, plus any tax-residency or exemption flags.
- **Bank details** — account number and branch for the salary disbursement file.

### 2 — Capture the things that vary month-to-month

Anything that changes from one month to the next gets captured before you run payroll:

- **Attendance and leave** — pulled in from the leave module (or the optional attendance module if you use it). Unpaid leave reduces the run; paid leave doesn't.
- **Loan repayments** — if an employee has an active staff loan, the scheduled repayment for the month shows up automatically.
- **One-off bonuses or allowances** — added in the run's adjustments section, or processed as a separate **bonus run**.
- **Expense claims** — approved expense claims can be paid alongside the salary, or paid separately.

### 3 — Create the payroll run

Go to **Payroll → Runs → + New run**.

1. Pick the **pay period** (usually a calendar month).
2. Pick the **employee group** — usually "all active", but you can run sub-groups (e.g. salaried vs. hourly) separately if your structure needs it.
3. Click **Calculate**.

PettahPro works out, for each employee:

- **Gross pay** — adds up all their salary components for the period (pro-rated for joiners/leavers).
- **EPF (employee 8%)** — deducted from gross.
- **PAYE** — calculated using their year-to-date earnings against the bracket table.
- **Other deductions** — loan repayments, salary advances, etc.
- **Net pay** = gross − EPF − PAYE − other deductions.

It also calculates what you the employer owe on top:

- **EPF (employer 12%)**
- **ETF (3%)**

The run lands in **Draft** status. Look through the per-employee table, click into anyone whose number looks off, and adjust if needed.

### 4 — Approve and post

Click **Approve** when you're happy. PettahPro:

- Locks the run (no more edits).
- Posts the salary expense to your books.
- Generates the per-employee payslip PDFs.
- Adds the totals to your EPF / ETF / PAYE liability accounts, ready for end-of-month remittance.

### 5 — Pay out

Open the run's **Disbursement** tab. Two options:

- **Generate the bank file.** PettahPro produces the file in the format your bank expects for bulk salary credit. Upload it to your corporate banking portal.
- **Mark as paid manually.** For tenants paying by cheque or by individual transfer.

Either way, your bank balance reflects the payment going out and the run flips from **Approved** to **Paid**.

### 6 — Send payslips

On the run, click **Send payslips**. Each employee with an email address gets their own PDF. If you've enabled the employee portal, they can also download it themselves there.

### 7 — End-of-month statutory remittance

Go to **Payroll → Statutory**.

- **EPF (Form C)** — exports the file in the format the EPF Department's e-portal expects. Upload it there. Once you've paid, record the payment in PettahPro to clear the EPF liability.
- **ETF schedule** — same shape, ETF Board format.
- **PAYE return** — monthly summary; remit through Inland Revenue's e-Services.

PettahPro produces the data; you upload and pay through the relevant portals.

## Common tasks

### Add a new salary component

Open **Payroll → Components**. Define the component's name, how it's calculated (fixed amount, percentage of basic, or a formula), whether it's taxable, and whether it counts towards EPF. Then add it to the relevant employees' salary structures.

### Process a leaver's final settlement

Use the **Final settlement** flow at **Payroll → Settlements → + New settlement** rather than putting them on the regular run. It works out:

- Pro-rated salary for the partial month worked.
- Encashment of any accrued leave.
- Gratuity if eligible (typically 5+ years of service).
- Final EPF, ETF, and PAYE on the above.
- Settlement of any outstanding loan or advance.

It produces a **settlement letter** that you give to the employee.

### Reverse a posted run

You can't edit a posted run, but you can reverse it: open it → **Reverse**. PettahPro books the opposite entries to undo it and unlocks the run for re-processing. The original run stays in the audit trail with status **Reversed**.

### Run a one-off bonus

Use **Payroll → Bonus runs → + New bonus run**. It's a slimmer version of the regular run — picks up a bonus amount per employee, applies PAYE (and EPF if the bonus is EPF-bearing), and pays it out.

### Pay an employee in a foreign currency

Set their salary structure in that currency. The run calculates their gross pay in their currency, applies PAYE on the LKR-equivalent (per Inland Revenue rules), and books to your LKR books at the run's exchange rate.

## What gets posted

When you approve a payroll run, PettahPro books the salary expense and the various liabilities. For an employee with a 100,000 gross, 8,000 employee EPF, 12,000 employer EPF, 3,000 ETF, and 5,000 PAYE, the entry looks like this:

| Account | Debit | Credit |
|---|---|---|
| Salaries — gross | 100,000 | |
| EPF — employer | 12,000 | |
| ETF — employer | 3,000 | |
| EPF payable | | 20,000 *(8k employee + 12k employer)* |
| ETF payable | | 3,000 |
| PAYE payable | | 5,000 |
| Salaries payable | | 87,000 *(100k − 8k − 5k)* |

When you actually pay the employee, **Salaries payable** is cleared against your **Bank** for the 87,000.

If the run includes a loan repayment, that amount is taken off the salary payable and used to reduce the employee's loan balance instead.

## FAQ

**Can I mix monthly-paid and hourly-paid employees in the same run?**
Yes. The calculation is per component, not per run. An hourly employee just has a component that calculates "rate × hours from attendance".

**The run looks correct but the bank file is rejected by my bank.**
Almost always a bank-account-format issue. Check that every employee in the run has an account number and branch code in the format your bank expects. **Settings → Payroll → Bank export format** lets you pick the right template for your bank.

**An approved run had a wrong amount for one employee — what's the cleanest fix?**
Reverse the run, fix the underlying input (attendance, salary structure, whatever it was), and re-approve. If you've already paid out the wrong amount, the cleanest path is usually to absorb the variance into next month's run as an adjustment line — auditors much prefer to see "noted and corrected next month" over "reversed and restarted from scratch".

**EPF or ETF rates change in the budget. Do I need to update them?**
No. Statutory rates are baked in and are updated centrally when the budget changes them. You don't configure them per business.

**PAYE is showing zero for someone earning over the threshold — why?**
Three things to check: (a) their year-to-date earnings — if you started using PettahPro mid-year, you need to enter an opening YTD amount; (b) any tax-exemption flags on the employee record; (c) whether the bracket table has an effective entry for the run's pay date.

## Related

- **Employees** — your employee master data.
- **Leave** — feeds the run.
- **Staff loans** — repayments come out of pay automatically.
- **Bonus runs** — one-off payments.
- **Final settlements** — for employees leaving.
- **Period close** — closing the month after payroll has run.
