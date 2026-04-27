---
title: Employees
sidebar_position: 2
---

# Employees

## What it does

Employees is the master data for everyone you pay through payroll. Each employee record holds personal details, contract terms, salary structure, EPF / ETF / PAYE-relevant info, and bank details for salary disbursement. Every payroll run, leave request, staff loan, and expense claim links back to one of these records.

For a small business with five staff, this is just five forms to fill in. For larger businesses with turnover, the employee module is doing real work — onboarding, transfers, exits, statutory filings.

## Walkthrough

### Adding an employee

Open **HR → Employees → + New employee**.

The form has several sections:

**Personal**
- Name (as per NIC, for statutory filings).
- NIC number.
- Date of birth.
- Address.
- Personal email + phone.

**Employment**
- Employee code (your internal ID).
- Designation.
- Department / branch (links to a cost centre, optional).
- Employment type — Permanent / Contract / Trainee / Probation.
- Date of joining.
- Probation end date (if probation type).
- Reporting manager.

**Statutory**
- TIN (if they're a PAYE-registered earner).
- EPF member number (assigned by the Central Bank's EPF department).
- ETF member number.

**Bank**
- Bank name.
- Branch.
- Account number.
- Account holder name (sometimes differs from employee name — joint accounts, etc.).

**Salary**
- Pay frequency (monthly is standard).
- Currency (LKR for most, USD for foreign-pay employees).
- Salary structure (pick from templates or build line-by-line — see [Salary components](./salary-components.md)).

Save. The employee is now active and will appear on the next payroll run.

### Probation lifecycle

Employees on probation typically need a confirmation step before becoming permanent. **Open employee → Confirm**. PettahPro updates the employment type, records the confirmation date, and notifies the employee (and the manager). Audit trail preserved.

### Transfers

Employee moves between departments / branches. **Open employee → Transfer**. Pick the new department and effective date. Salary structure can update if the new role pays differently; that change posts as a salary revision (see below).

### Salary revision

When an employee's salary changes (annual increase, promotion, market adjustment), don't edit the salary structure directly — use **Open employee → Revise salary**. Set the effective date and the new structure. PettahPro records the revision history; old structure stays on file for context.

The revision applies from the effective date onwards — past payroll runs are unaffected.

### Exit / termination

Employee leaves. **Open employee → Initiate exit**. Set the last working day, the reason (resignation / termination / retirement). PettahPro:

- Marks the employee as exiting.
- Triggers the **Final settlement** flow (separate page) for gratuity, leave encashment, final salary.
- Stops including the employee on future payroll runs after the last working day.

After final settlement is paid, mark the employee as **Exited**. The record stays in the system permanently for audit and statutory purposes.

## Common tasks

### Bulk-import employees

Migrating from another system or going live with a large team. **HR → Employees → Import**. CSV with one row per employee covering all the fields above. PettahPro creates each record; per-row success / failure report.

### Update statutory numbers across employees

If you're correcting a batch of EPF numbers (e.g. you got the right format from the EPF department after launching), **HR → Employees → Bulk edit** lets you update specific fields across multiple employees at once. Audit log records each change.

### Manage employee documents

Each employee record has a **Documents** tab — appointment letter, NIC scan, academic certificates, reference letters, signed contract. Upload, name, attach. Documents stay with the record permanently.

### See employee history

The **Activity** tab on each employee shows every change to their record, payroll runs they were on, leave taken, loans, expense claims. Useful for performance reviews and exit interviews.

### Run a headcount report

**Reports → HR → Headcount**. By department, by employment type, by branch. Filter by date for "headcount as at X". Useful for monthly board updates and for planning.

### Mark an employee as inactive without exiting

For employees on long unpaid leave, sabbaticals, or extended overseas assignments — they're still on the books but not on payroll. Use **Status = Inactive**. They don't appear on payroll runs but the record stays full. Re-activate when they return.

## What gets posted

**Nothing.** The employee record itself is master data, not a transaction. Creating, editing, or deleting an employee record doesn't move any account.

What employee records affect:
- **Payroll runs** — every employee with status Active gets calculated.
- **Statutory filings** (Form C, ETF, PAYE return) — the data flows from employee records.
- **Reports** — headcount, payroll cost analysis, leave balances.

## FAQ

**An employee's NIC was entered wrong — can I edit it?**
Yes. Edit the field; PettahPro updates and records the change in the audit log. If statutory filings have already been submitted with the old NIC, you may need to file corrections — check with the EPF department.

**Can I have an employee with no salary structure?**
Technically yes (e.g. interns who aren't paid through payroll). They'd be on the employee list but excluded from payroll runs. Most businesses don't bother — if someone isn't on payroll, just don't add them as an employee.

**Two employees with the same NIC — what happened?**
Shouldn't happen. PettahPro flags duplicate NICs at save time. If you see two records, one is a data-entry error; merge by transferring the second's history to the first (contact support for the merge — it's a careful operation).

**A new hire's EPF number isn't issued yet. What do I enter?**
Leave it blank for now. Their first payroll run will compute EPF based on their salary, but the actual filing waits until you have the EPF number. Once you have it, edit and re-include them in that month's Form C.

**Can employees see their own record?**
If you've enabled the **Employee portal**, yes — they log in and can see their personal details (some editable, some not), payslips, leave balance, attendance. Configurable per role.

**How do I terminate an employee for misconduct?**
**Initiate exit → Reason = Termination → Termination type = Misconduct**. The final settlement may differ from a resignation (e.g. notice-in-lieu, no gratuity if the misconduct is gross). The settlement screen handles the variants.

## Related

- [Payroll](./payroll.md) — runs against the active employee list.
- [Salary components](./salary-components.md) — what makes up the salary structure.
- [Leave](./leave.md) — feeds into payroll for unpaid leave.
- [Staff loans](./staff-loans.md) — loans linked to employees.
- [Final settlements](./final-settlements.md) — the exit flow.
