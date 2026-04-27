---
title: Salary components
sidebar_position: 3
---

# Salary components

## What it does

A salary component is one line item in an employee's pay — basic salary, transport allowance, housing allowance, performance bonus, etc. The salary structure is the assembled set of components for a given employee.

PettahPro lets you define components once with rules (how it's calculated, taxable or not, EPF-bearing or not, capped or uncapped) and reuse them across employees. When you run payroll, every component on every employee's structure is calculated according to its rules.

The system gets its power from rule-based components. A "Transport allowance" defined as "fixed 5,000" applies the same to every employee who has it. A "Bonus" defined as "10% of basic" automatically scales with each employee's basic salary. A "Loan repayment" defined as "lookup from staff loans module" pulls the right amount each month without you keying it.

## Setting up components

Open **HR → Salary components → + New component**.

Each component has:

- **Code** — short identifier (BASIC, TRANS, PROF, etc.).
- **Name** — what shows on the payslip.
- **Type** — Earning / Deduction.
- **Calculation rule:**
  - **Fixed amount** — a flat number (e.g. transport = 5,000).
  - **Percentage** — based on another component (e.g. bonus = 10% of basic).
  - **Formula** — for complex cases (e.g. overtime = hours × rate × 1.5).
  - **Lookup** — pulled from another module (e.g. loan repayments from Staff loans).
- **Tax treatment:**
  - **Taxable** — included in PAYE-able earnings.
  - **Non-taxable** — excluded from PAYE.
- **EPF treatment:**
  - **EPF-bearing** — counts towards EPF calculation (employee 8% / employer 12%).
  - **Non EPF-bearing** — excluded.
- **ETF treatment** — same as EPF, separate flag for ETF.
- **Cap** (optional) — maximum amount per period (e.g. transport allowance capped at 8,000).

### Common SL components

PettahPro ships with the standard SL components pre-defined:

| Component | Type | Taxable | EPF | ETF |
|---|---|---|---|---|
| Basic salary | Earning | Yes | Yes | Yes |
| Transport allowance | Earning | No (subject to limit) | No | No |
| Housing allowance | Earning | Yes | Yes | Yes |
| Cost of living allowance | Earning | Yes | Yes | Yes |
| Medical allowance | Earning | No | No | No |
| Bonus | Earning | Yes | Yes (sometimes) | Yes (sometimes) |
| Overtime | Earning | Yes | Yes | Yes |
| EPF — employee | Deduction | — | — | — |
| PAYE | Deduction | — | — | — |
| Loan repayment | Deduction | — | — | — |
| Salary advance recovery | Deduction | — | — | — |

Use these as starting points; clone and modify if your business has variations.

### Assembling a salary structure

For each employee, **HR → Employees → \[employee\] → Salary structure** lets you pick the components that apply, set the values, and save.

Two patterns:

- **Component template** — define a structure once (e.g. "Engineer — junior" = basic + transport + housing + medical), apply to many employees. Updating the template updates all employees on it.
- **Per-employee** — each employee's structure is bespoke. More flexible, more maintenance.

Most businesses mix: templates for the bulk of employees, per-employee tweaks for special cases (executives, expat staff, etc.).

## Common tasks

### Add a new component the budget introduced

E.g. the SL budget introduces a new "Cost of living allowance" requirement. Create the component once with the right rules, add it to all relevant employees (bulk edit). Future payroll runs include it automatically.

### Discontinue a component

Mark it **Inactive**. New employees can't pick it; existing employees keep it on their structure for historical context but new payroll runs skip it.

### Override a component for one employee

Two ways. Either: (a) put the employee on their own per-employee structure with the override; or (b) keep them on the shared template and use a **Per-employee adjustment** for the difference. Option (b) is cleaner if the override is small; (a) is cleaner if many things differ.

### Test a payroll calculation before running

**HR → Salary components → Calculator**. Pick an employee, see what their gross / EPF / PAYE / net would be next run, line by line. Useful when introducing new components or correcting structures.

### Component effective dates

When a rate changes (e.g. transport allowance increased from 5,000 to 7,000), set the new value with an **Effective date**. Past payroll runs use the old value; future runs use the new. PettahPro doesn't recompute history.

### See where a component is used

Open the component → **Used by** tab. Lists every employee with this component on their structure. Useful for impact analysis when changing a component.

## What gets posted

Components don't post to your books on their own — they're a definition. What posts is the **payroll run**: each component's value per employee is summed into the gross, deductions, and employer contribution lines that go to the GL. See [Payroll](./payroll.md) for the journal entries.

## FAQ

**Should "Bonus" count towards EPF?**
Depends. Statutory bonuses (e.g. annual bonus mandated by labour law) are EPF-bearing in some interpretations. Discretionary bonuses often aren't. Talk to your accountant or labour law advisor for your specific case; PettahPro lets you toggle per component.

**Transport allowance — is it taxable?**
Up to a statutory limit (currently 50,000 LKR / month, set by IRD), transport allowance is non-taxable. Above the limit, the excess is taxable. Configure the cap on the component; PettahPro splits the excess into a taxable portion automatically.

**The PAYE calculation looks low for someone earning a lot.**
PAYE uses the bracketed table; high earners pay a lot. Common reasons it could look "low":
- The employee has tax-free thresholds (relief amount) set on their record.
- A non-taxable component (medical, capped transport) is large.
- Their year-to-date earnings are low (e.g. they joined mid-year), pulling the bracket effective rate down.

Open the **Payroll calculator** to see the line-by-line breakdown.

**Loan repayments — are they a separate component or built into deductions?**
A separate component, type = Deduction, calculation rule = Lookup from Staff loans. Each employee with an active loan has the component automatically; the value is pulled from the loan schedule each run.

**Can I have a component that's both taxable and EPF-bearing in some cases but not others?**
A component has fixed flags. If it differs by case, create two components (e.g. "Allowance — taxable" and "Allowance — non-taxable"). Apply the right one per employee.

## Related

- [Employees](./employees.md) — where structures are assembled.
- [Payroll](./payroll.md) — where components are calculated.
- [Bonus runs](./bonus-runs.md) — for one-off payments.
