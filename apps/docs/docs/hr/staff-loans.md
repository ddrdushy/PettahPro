---
title: Staff loans
sidebar_position: 5
---

# Staff loans

## What it does

Staff loans are advances or longer-term loans you give employees, typically recovered from monthly salary in installments. Common in SL businesses — staff need money for emergencies, weddings, education; the company lends and recovers from payroll without interest (or at a low interest rate).

PettahPro tracks each loan from disbursement through repayment to closure: the principal, the schedule of monthly deductions, the running balance, the interest if any. The repayment line auto-appears on each payroll run for the relevant employee.

For businesses where staff loans are routine, the module saves a lot of bookkeeping. For businesses that don't lend to staff, you can ignore it.

## Walkthrough

### Disbursing a loan

Open **HR → Staff loans → + New loan**.

1. **Employee** — pick from the active list.
2. **Loan type** — Salary advance / Personal loan / Education loan / Festival loan / Other.
3. **Principal** — amount being lent.
4. **Disbursement date** — when the money goes to the employee.
5. **Disbursement method** — Bank transfer / Cash / Cheque.
6. **Repayment schedule:**
   - **Number of installments** — how many months to recover over.
   - **Installment amount** — auto-calculated, or override.
   - **First repayment month** — typically the next payroll cycle.
7. **Interest rate** — usually 0 for SL staff loans; some businesses charge a token rate (e.g. 5% p.a.) for compliance.
8. **Approver** — depending on your approval matrix.

Save and **Disburse**. PettahPro:

- Books the loan as an asset on your balance sheet (Staff loans receivable).
- Adds the repayment as a deduction component on the employee's payroll structure (auto-removed when the loan is fully repaid).
- Generates a loan agreement PDF for the employee to sign.

### Recovery via payroll

From the next payroll run onwards, PettahPro automatically deducts the installment from the employee's salary. The deduction:

- Reduces the employee's net pay by the installment amount.
- Reduces the loan balance by the same amount.
- Doesn't touch any P&L expense — it's a balance-sheet movement (Staff loans receivable down, Salaries payable down).

When the loan is fully recovered, the deduction component drops off the employee's payroll structure automatically.

### Early settlement

Employee wants to settle the remaining balance in one go (e.g. they got a bonus and want to clear the loan).

**HR → Staff loans → \[the loan\] → Settle**. Pick the settlement source:

- **From bonus / payroll** — deducted from the next payroll run.
- **Cash / bank** — employee pays back in cash; record as a receipt.

The loan is closed; the deduction component drops off.

### Default

Employee leaves the company with an outstanding loan. Two paths:

- **Recover from final settlement** — the final-settlement payout deducts the outstanding loan first, then pays the net.
- **Write off** — if the final settlement isn't enough or the employee disputes: write off the balance via a journal (Loan written off expense, against the receivable). The lost amount is a real cost.

### Loan adjustments

Sometimes the schedule needs to change — employee on extended leave can't afford the installment, or has been promoted and can pay more. **Open the loan → Reschedule**. Adjust the remaining installments; the new schedule kicks in from the chosen month.

## Common tasks

### Check who has open loans

**HR → Staff loans → Active loans**. Lists every employee with an open balance. Sortable by balance, by remaining installments, by disbursement date.

### Run a loan disclosure for the employee

Each loan has a **Statement** option — produces a PDF showing the loan agreement, all installments paid, all installments remaining, current balance. Useful when an employee asks "how much do I still owe?"

### Manage interest if charged

If you charge interest, PettahPro calculates per-installment interest and breaks down each repayment into principal vs interest. The interest portion posts as **Interest income** on your P&L (the principal portion just reduces the receivable).

### Festival loan campaign

Around Sinhala/Tamil New Year or Christmas, businesses sometimes offer festival loans to many employees. **HR → Staff loans → Bulk disburse** lets you create multiple loans at once with the same terms. Useful for coordinated festival-loan rounds.

### Block new loans for an employee

If an employee already has high outstanding balances, you might not want to lend more. Set **Loan eligibility = blocked** on their employee record; any new loan request fails approval.

### Approval matrix

Set up approval thresholds in **Settings → Approvals → Staff loans**. Common pattern: small loans (under 50,000) get manager approval; medium (50,000–500,000) finance head; large (500,000+) owner. PettahPro routes accordingly.

## What gets posted

### Disbursement

| Account | Debit | Credit |
|---|---|---|
| Staff loans receivable | principal | |
| Bank | | principal |

The loan moves from your bank to a receivable. Your overall asset value is unchanged; just shifted from cash to "money the employee will pay back".

### Each repayment (via payroll)

| Account | Debit | Credit |
|---|---|---|
| Salaries payable | repayment | |
| Staff loans receivable | | repayment |

The repayment reduces what you'd have paid the employee in salary, and reduces the loan balance by the same amount. Net effect on bank: less cash going out (because the loan is being recovered).

### If interest is charged

The repayment splits:

| Account | Debit | Credit |
|---|---|---|
| Salaries payable | total deduction | |
| Staff loans receivable | | principal portion |
| Interest income | | interest portion |

### At write-off

| Account | Debit | Credit |
|---|---|---|
| Loan written off (expense) | balance | |
| Staff loans receivable | | balance |

## FAQ

**Can a salary advance be same-month?**
Yes — you give the advance during the month, recover it in the same month's payroll. The loan exists for a few weeks; the journal flows through at month-end. Useful for "I'll pay you back from next salary" situations.

**Can a single loan be repaid over more months than the employment expects?**
PettahPro flags loans whose repayment schedule extends beyond the employee's contract end date. Confirm or shorten the schedule. For a long-tenured employee on a permanent contract, it's fine to schedule over 12+ months.

**An employee says the loan deduction shouldn't be on this month's payroll.**
Their payroll is on autopilot — the deduction happens unless overridden. To skip a single month (e.g. employee on no-pay leave for that month), open the loan → **Skip next installment**. The schedule extends by one month; this month's deduction doesn't happen.

**A loan was disbursed but never properly recovered — is it written off?**
Only if you write it off explicitly. Sitting unpaid doesn't change anything — it's just an old, stale receivable. Some businesses age their staff loans like AR; others trust that recovery will eventually happen. Periodic review and write-off of irrecoverable amounts is good hygiene.

**Tax treatment of loans?**
Principal isn't taxable income (it's a loan, not a payment). If interest is charged, that's interest expense to the employee (typically not deductible from their PAYE). If the loan is forgiven, the forgiven amount becomes taxable income — talk to your accountant about the right journal.

**Multi-currency loans?**
Pick the loan currency on disbursement. Repayments in the same currency (or converted at run-date FX rates if employee paid in different currency). PettahPro tracks the loan in its currency; reports show LKR equivalents at current rates.

## Related

- [Payroll](./payroll.md) — where loan deductions appear.
- [Employees](./employees.md) — loans link to employee records.
- [Final settlements](./final-settlements.md) — outstanding loans deducted at exit.
- [Salary components](./salary-components.md) — the deduction component is auto-managed.
