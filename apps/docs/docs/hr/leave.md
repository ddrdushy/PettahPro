---
title: Leave
sidebar_position: 4
---

# Leave

## What it does

The Leave module tracks employee leave balances, leave requests, approvals, and how leave affects payroll. Each employee has separate balances for different leave types (annual, casual, medical, etc.); leave requests draw from these balances and are subject to manager approval.

Done well, leave management saves friction — employees know how much leave they have, managers approve from a queue, payroll automatically handles unpaid leave deductions. Done badly (in spreadsheets, in WhatsApp messages), it's a constant source of disputes.

## Leave types

PettahPro ships with the standard SL leave types:

- **Annual leave** — typically 14 days/year, accrues monthly.
- **Casual leave** — typically 7 days/year.
- **Medical leave** — varies by company; often 14 days/year.
- **Maternity leave** — statutory entitlement (currently 84 working days for the first two children).
- **Paternity leave** — varies; often 3 days.
- **Bereavement leave** — varies; usually 3–7 days.
- **No-pay leave** — for any leave taken when entitlements are exhausted; reduces payroll.

You can:
- Add custom leave types (study leave, special religious leave, etc.).
- Adjust the entitlement per type (some businesses give more annual leave than the legal minimum).
- Configure accrual rules (annual leave often accrues monthly; some businesses front-load).

## Setting up

**HR → Leave → Settings**.

For each leave type:
- **Entitlement** — number of days per year.
- **Accrual** — Front-load (full entitlement on Jan 1) / Monthly (1/12 each month) / Pro-rata-from-joining.
- **Carry-forward** — Yes/No, with optional cap on carried-over balance.
- **Encashable** — Whether unused leave can be cashed out at year-end or on exit.
- **Half-day allowed** — Yes/No.
- **Requires medical cert above X days** (typical for medical leave above 2-3 days).

Per-employee overrides are possible (e.g. senior employees with more annual leave).

## Walkthrough

### Submitting a leave request

Employee opens **HR → Leave → Apply** (in the employee portal).

1. Pick the leave type.
2. Pick the start and end date (and indicate half-day if applicable).
3. Reason (optional, often required for medical / bereavement).
4. Attach supporting docs if needed (medical cert).
5. Submit.

The request goes to the configured approver (default: their reporting manager).

### Approving / rejecting

Approver sees pending requests in **HR → Leave → My approvals**. For each:

- See the request, the employee's current balance, conflicts (other team members on leave the same week).
- Approve / Reject with optional comment.
- Approved leave is automatically deducted from the employee's balance.

### Recording leave taken without a request

For backfilling, or for cases where someone took unplanned leave (sick at home, called in): **HR → Leave → Record leave** lets a manager or HR enter leave on behalf of the employee. Same effect — balance reduces.

### Cancelling approved leave

Employee got approval but plans changed. **Cancel request** restores the balance. If the leave date has already passed, cancellation isn't allowed (it actually happened).

### Encashing leave at year-end

If your policy allows leave encashment, **HR → Leave → Encashment** lets you select employees and encash their balances. Encashment posts as a payment via payroll (taxable, EPF-bearing depending on your rules).

## Common tasks

### Bulk-credit leave at year start

If accrual is front-loaded (full entitlement on Jan 1): **HR → Leave → Year-end refresh**. Adds the year's entitlement to every active employee's balance, optionally carrying forward unused leave (within the cap).

### See team coverage during a holiday week

**HR → Leave → Team calendar** shows the calendar with everyone's approved leave. Filter by department to see your team's coverage. Useful when planning whether to approve a request that would overlap with others.

### Generate a leave balance report

**Reports → Leave → Balance per employee** shows current balance per leave type per employee. Filter by department, by date. Useful for monthly HR reviews.

### Convert pending leave for a leaver

When an employee resigns, their accrued-but-unused leave needs to be encashed (or paid as part of the final settlement). The **Final settlement** flow handles this automatically — it sees the leave balance and either pays it out or marks it forfeited based on your policy.

### Half-day leave

If half-day is allowed for a leave type, employees can pick "half day morning" or "half day afternoon" on the request. The balance deducts 0.5 days. Payroll calculations for unpaid half-days reduce gross by half a day's pay.

### No-pay leave

If an employee runs out of paid leave but still needs time off, they apply for **No-pay leave**. The request goes through approval (with a clear "this is unpaid" warning). Approved no-pay leave reduces gross pay in the affected payroll run by the number of days × daily rate.

## What gets posted

Leave requests don't post to your books directly — they're a balance event in the Leave module.

What posts:

- **Unpaid leave** affects the next payroll run — reducing gross pay by the no-pay days. The reduction flows into all the payroll-derived numbers (EPF, ETF, PAYE on the lower base).
- **Leave encashment** posts as a special payroll line, treated as taxable income (and EPF-bearing per your rules).
- **Final settlement leave payouts** post as part of the settlement journal (see [Final settlements](./final-settlements.md)).

## FAQ

**An employee says they have more leave than the system shows.**
Open their **Leave history** — every grant, deduction, and adjustment is listed. The balance equals (entitlement granted) + (carried forward) − (taken) − (encashed). If the math doesn't add up, there's a missing entry; investigate.

**Maternity leave — does it deduct from annual leave?**
No — maternity leave is its own type with its own entitlement. The two are separate. Statutory maternity leave is not deducted from any other balance.

**Holiday on a leave day — does it count?**
Most policies: public holidays falling within an approved leave period do **not** count against the leave balance. PettahPro can be configured to skip public holidays automatically. **HR → Leave → Settings → Skip holidays in leave count**.

**An approved leave request was for next month, but the employee has now resigned and their last day is this week. Cancel the leave?**
Cancel before the start date. The balance restores. The final settlement uses the (restored) balance for encashment / forfeiture per your policy.

**Can I configure escalation if the manager doesn't approve in time?**
Yes — **HR → Leave → Approval rules** has an SLA setting (e.g. "if not actioned in 48 hours, escalate to skip-level manager"). Stops requests stalling.

**Some employees should accrue leave faster than others (long-tenured staff, etc.).**
Set up tier-based entitlements. **HR → Leave → Tiers** — define tiers ("New", "5+ years", "10+ years") with different annual leave entitlements. Assign each employee to a tier.

## Related

- [Employees](./employees.md) — leave links to employee records.
- [Payroll](./payroll.md) — unpaid leave affects gross.
- [Final settlements](./final-settlements.md) — leave encashment on exit.
- [Attendance](./attendance.md) — for businesses tracking daily presence.
