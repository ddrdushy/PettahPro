---
title: Final settlements
sidebar_position: 9
---

# Final settlements

## What it does

A final settlement is the last payment to an employee who's leaving — the wrap-up that ties off everything outstanding. It includes:

- Salary for the partial month worked.
- Encashment of accrued leave (or forfeiture, per your policy).
- Gratuity, if eligible (typically 5+ years of service in SL).
- EPF and ETF on the above.
- PAYE on the taxable portion.
- Recovery of any outstanding loans, advances, or other balances.

The settlement produces a **settlement letter** — a separate document type with its own template — that goes to the departing employee.

Final settlements are sensitive. Get them right: legally, morally, and for the goodwill of departing staff who may speak about your business after they leave.

## Walkthrough

### Initiating a settlement

Open the employee's record → **Initiate exit** (sets the last working day and exit reason). PettahPro opens the **Final settlement** flow.

Or directly: **HR → Settlements → + New settlement** → pick the employee.

### The settlement screen

PettahPro pre-calculates everything:

- **Salary for the partial month** — pro-rated based on last working day. (If the employee worked 15 days of a 30-day month, half a month's salary.)
- **Leave encashment** — the unused leave balance × daily rate. Per your policy, all leave types or only specific ones (e.g. annual encashable, casual not).
- **Gratuity** — for 5+ years service: half a month's salary × number of years (the standard SL formula). PettahPro calculates based on the employee's last basic + tenure.
- **Other payouts** — anything else due (final commission, pending bonus, etc. — manually added).
- **Loan recovery** — outstanding balance on staff loans, deducted from settlement.
- **Other recoveries** — return of laptop / phone (if not returned: deduct value), training bond breaks, etc.
- **PAYE** — calculated on the taxable portion of the settlement, including the year-to-date earnings to that point.
- **EPF and ETF** — applied to the EPF-bearing portions.

Review each line. Adjust where needed (some items, like gratuity formula or training bond, may need management discretion).

### Approving and disbursing

**Approve** locks the settlement, generates the settlement letter, books the journal. **Disburse** pays the net amount to the employee (typically a single bank transfer; sometimes a cheque).

The settlement letter is the formal document — itemised breakdown of every component, the gross, deductions, net, and an acknowledgment line for the employee to sign. Some businesses include a clearance note (employee has returned all company property, has no outstanding obligations, etc.).

### Marking exited

After the settlement is paid and the employee has left, mark the employee record as **Exited**. The record stays in the system permanently.

## Common tasks

### Resignation with notice period

Standard case. Employee worked their notice period, last working day is clear, no termination drama. Settlement covers the partial month, leave encashment, gratuity if eligible. Loan deductions if any. Standard letter, standard payment.

### Termination for misconduct

Different treatment. Per labour law, gross misconduct often forfeits gratuity (a substantial financial impact). Notice-in-lieu may apply (paying the notice period since the employee is leaving immediately, not working it). PettahPro lets you mark gratuity as **Forfeited — misconduct** and PAYE-treat the notice-in-lieu correctly.

This is high-stakes — get legal advice for any termination dispute before processing the settlement.

### Resignation without notice

Some businesses claim a deduction for skipped notice (notice-in-lieu against the employee). Configurable. Common pattern: the employee owes the company N days of salary (the unfulfilled notice period); deducted from the final settlement.

### Long-service exit

10+ years of service. Gratuity is significant; leave balance often substantial; emotional moment. Time the settlement carefully, consider a final-day ceremony, ensure the settlement is generous and accurate. Goodwill matters.

### Death-in-service

Sad but happens. Settlement is paid to the beneficiary (specified on the employee record, or to next-of-kin per labour law). Special tax treatment may apply. Consult HR / legal advisor; PettahPro can model it but the policy is human.

### Employee returning company property

Laptop, phone, vehicle, ID card — usually handed over on the last day. PettahPro's exit checklist tracks each item. If anything isn't returned, the value can be deducted from settlement (with employee acknowledgment). Or pursued separately.

### Reverse a settlement

Mistake. **Reverse** the settlement. Books restore. The employee is back to active status (possibly mid-process). Re-initiate with corrections.

## What gets posted

For an employee with: partial salary 25,000, leave encashment 30,000, gratuity 200,000, total gross 255,000; EPF 8% of EPF-bearing portion (say 25,000 of that is EPF-bearing, so 2,000); employer EPF 12% (3,000); ETF 3% (750); PAYE 30,000; loan recovery 50,000:

| Account | Debit | Credit |
|---|---|---|
| Salaries — gross | 25,000 | |
| Leave encashment | 30,000 | |
| Gratuity expense | 200,000 | |
| EPF — employer | 3,000 | |
| ETF — employer | 750 | |
| EPF payable | | 5,000 (2k employee + 3k employer) |
| ETF payable | | 750 |
| PAYE payable | | 30,000 |
| Staff loans receivable | | 50,000 |
| Salaries payable | | 173,000 (255k − 2k EPF − 30k PAYE − 50k loan) |

Disbursement clears Salaries payable against Bank.

If the employee had a gratuity provision built up in earlier periods, the gratuity-expense line might be smaller (or absent) — the cost was already recognised. Talk to your accountant if you have a formal gratuity provision policy.

## FAQ

**Gratuity — is it always payable?**
SL labour law: gratuity is payable to employees with **5+ years of continuous service**. Less than 5 years = no gratuity. The formula is **half a month's basic salary × number of years of service**. Some businesses pay more generously by policy (1 month per year, etc.).

**Leave encashment — should I always pay it out?**
Per your policy. Many businesses pay annual leave encashment (it's accrued benefit) but not casual leave (it's "use it or lose it"). PettahPro's settlement pulls from your configured policy per leave type.

**The employee disputes the gratuity calculation.**
Walk them through the formula in writing — basic × years × half = gratuity. If their basic was revised mid-tenure, the calculation uses the **last basic** (the formula at exit). Show the calculation, show the dates and basics, document signed acknowledgment.

**The exit was abrupt — they walked off without notice. What about the settlement?**
You owe them what they're owed (salary for days worked, gratuity if eligible). They might owe you for skipped notice. Net the two; pay the difference (or claim if it's negative). PettahPro handles the netting; the labour-law angle is sometimes contested — get advice.

**An employee who left came back six months later. Does the prior tenure count?**
Generally no — gratuity is for **continuous** service. A break resets the clock. Unless your policy explicitly bridges (and many do for short re-hire gaps), the new tenure starts at zero.

**Final settlement was short by 1,000. Can I add it later?**
Yes — post a "supplementary settlement" via a payroll-style adjustment. Files a new settlement document for the difference. Don't reverse and re-do the original; that's messy.

## Related

- [Employees](./employees.md) — exit flow starts here.
- [Payroll](./payroll.md) — settlements use the payroll calculator.
- [Leave](./leave.md) — leave balance feeds encashment.
- [Staff loans](./staff-loans.md) — loan balances are recovered.
- [Settings → Document templates](../settings/overview.md) — the settlement letter template.
