---
title: Bonus runs
sidebar_position: 6
---

# Bonus runs

## What it does

A bonus run is a one-off payment to a group of employees, separate from the regular monthly payroll. Use it for festival bonuses (Sinhala/Tamil New Year, Christmas), performance bonuses, end-of-year bonuses, or any scheduled / discretionary payout that isn't part of the monthly cycle.

The bonus run is structurally similar to a payroll run, but slimmer — it picks up just a bonus amount per employee, applies the right deductions (PAYE, sometimes EPF), books the journal, and disburses. Unlike a full payroll run, it doesn't recompute everyone's regular salary.

## Walkthrough

### Setting up a bonus run

Open **HR → Bonus runs → + New bonus run**.

1. **Run name** — e.g. "Sinhala/Tamil New Year 2026", "Performance bonus Q1 2026".
2. **Bonus type:**
   - **Festival** — typically EPF-bearing (it's a regular bonus by labour law definition); fully taxable.
   - **Performance** — case-by-case treatment; depends on your policy.
   - **Discretionary** — depends on your policy.
3. **Pay period date** — the date the bonus is "earned"; affects which financial year it falls into.
4. **Pay (disbursement) date** — when the money goes out.
5. **Eligibility filter** — Active employees / Specific departments / Manual selection.

### Setting the bonus amount

Three patterns:

- **Flat amount** — every eligible employee gets the same (e.g. 10,000 each for festival).
- **Percentage of basic** — each gets X% of their basic salary (e.g. 100% = one month's basic for annual bonus).
- **Per-employee** — type the amount per employee (for performance bonuses where amounts vary).

PettahPro shows the resulting per-employee amount; review and adjust.

### Calculating

Click **Calculate**. PettahPro works out, per employee:

- **Bonus amount** (gross).
- **EPF deduction** (if EPF-bearing). Both employee 8% and employer 12%.
- **ETF** (if ETF-bearing).
- **PAYE** — calculated using the employee's year-to-date earnings against the bracket table.
- **Net pay** = Gross − EPF (employee) − PAYE.

### Approve and disburse

Review per-employee numbers. **Approve** locks the run; payslips (or bonus letters) generate. **Disburse** generates the bank file or marks paid manually.

PettahPro books the journal — same shape as a regular payroll run, just for the bonus only.

## Common tasks

### Festival bonus for all permanent staff

The annual ritual. Filter eligible employees to **Permanent + 1+ year service** (or whatever your policy says). Flat amount or one-month-basic, EPF-bearing, taxable. Approve, disburse, send congratulatory bonus letters.

### Performance bonus by department

Filter to a specific department, set per-employee amounts based on the manager's recommendations. Useful when bonuses are merit-based and not formulaic.

### Year-end bonus tied to company profitability

Calculated externally (e.g. 10% of net profit shared across staff per a formula), then loaded as per-employee amounts on the bonus run. PettahPro handles the deductions and disbursement; the calculation logic lives outside.

### Statutory bonus

In SL, certain businesses are required to pay a statutory bonus by labour law. **HR → Bonus runs → New statutory bonus** uses the regulated formula and applies the right tax / EPF treatment automatically.

### Bonus letters

Each bonus run can generate per-employee bonus letters (a personalised PDF — "Dear X, in recognition of...") in addition to or instead of payslips. Configurable in the run's letter template.

### Reverse a bonus run

If approved and disbursed in error, **Reverse**. PettahPro books the inverse journal; if disbursement happened, you'd need to recover from employees separately. Audit trail preserved.

## What gets posted

For a single employee with bonus 50,000, EPF (employee) 4,000, EPF (employer) 6,000, ETF 1,500, PAYE 5,000:

| Account | Debit | Credit |
|---|---|---|
| Bonus expense | 50,000 | |
| EPF — employer | 6,000 | |
| ETF — employer | 1,500 | |
| EPF payable | | 10,000 |
| ETF payable | | 1,500 |
| PAYE payable | | 5,000 |
| Salaries payable | | 41,000 |

Disbursement clears Salaries payable against Bank.

If the bonus is non-EPF-bearing, drop the EPF lines. Same for ETF.

## FAQ

**Should festival bonus be EPF-bearing?**
SL labour law generally treats festival bonuses (statutory annual bonus) as EPF-bearing. Performance bonuses sometimes aren't, depending on the contract. When in doubt, EPF-bearing is the conservative default. Talk to your labour-law advisor for your specific case.

**An employee was hired this month — should they get the festival bonus?**
Per your policy. Many businesses pro-rate based on months of service in the year (a new hire gets 1/12 of the bonus). Some only give to staff with 1+ year service. PettahPro lets you filter eligibility and pro-rate.

**Two bonus runs in the same month — does that work?**
Yes. Bonus runs are independent of regular payroll runs and of each other. You could run a festival bonus on the 1st and a performance bonus on the 25th.

**Bonus run's PAYE looks too low.**
PAYE on a bonus is calculated on the employee's **cumulative year-to-date earnings**, not on the bonus alone. So the PAYE on a 50,000 bonus depends on what they've already earned this year — for a new joiner, lower; for someone late in the year, higher.

**Reverse a single employee from a bonus run?**
If approved but not disbursed: open the run, remove the employee, re-approve. If disbursed: post a separate adjusting payment / debit to recover. PettahPro can model this with a reversal targeted at one employee, but it's manual.

**Can bonus runs run alongside regular payroll?**
Yes — they're parallel. The regular run covers monthly salary; the bonus run covers the one-off. Each has its own audit trail, its own disbursement, its own journal.

## Related

- [Payroll](./payroll.md) — the regular monthly cycle.
- [Salary components](./salary-components.md) — bonus components defined here.
- [Employees](./employees.md) — eligibility filtering.
- [Final settlements](./final-settlements.md) — for exit-time bonuses.
