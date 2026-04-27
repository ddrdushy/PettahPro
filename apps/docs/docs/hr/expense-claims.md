---
title: Expense claims
sidebar_position: 7
---

# Expense claims

## What it does

An expense claim is what an employee submits to be reimbursed for money they spent on the company's behalf — taxi fare for a customer visit, a meal with a client, fuel for a business trip, a small office purchase. The employee paid out of their own pocket; you pay them back.

PettahPro handles the full workflow: employee submits with receipts, manager approves, finance reimburses (via payroll or separate payment), the expense posts to the right P&L account.

## Walkthrough

### Submitting a claim

Employee opens **HR → Expense claims → + New claim** (in the employee portal).

1. **Claim title** — one-line description ("Customer visit Kandy 27 April").
2. **Project / cost centre** — optional, helps with cost allocation.
3. **Add lines** — one per receipt:
   - **Date**.
   - **Category** — Travel / Meals / Fuel / Stationery / Communication / Other.
   - **Amount**.
   - **Description**.
   - **Receipt** — upload photo or PDF of the receipt.
4. **Save as draft** to keep editing, or **Submit** for approval.

Each line should have a receipt unless the category allows receiptless (e.g. small per-diem amounts under a threshold).

### Approving / rejecting

Approver (typically the employee's manager) sees pending claims in **My approvals**. For each:

- Review the lines, check the receipts.
- Approve, reject (with reason), or **send back** for revision.
- Approved claims move to finance for reimbursement.

For high-value claims, multi-step approval: manager → finance lead → CEO (over a threshold). Configured in **Settings → Approvals → Expense claims**.

### Reimbursement

Two patterns:

**Via payroll:** approved claims auto-add to the next payroll run as a non-taxable line on the employee's payslip. Net pay goes up by the reimbursement amount; the expense posts to the appropriate P&L account.

**Separate payment:** finance pays directly via bank transfer or cash, separate from payroll. Useful for urgent claims or when payroll is far away.

Either way, PettahPro:

- Books the expense to the P&L account configured for the category.
- Pays the employee.
- Marks the claim as **Reimbursed**.

## Common tasks

### Set spending policy by category

**Settings → Expense claims → Categories**. Per category, configure:

- **Account** — which expense account it posts to.
- **Receipt required** — Yes/No (with optional threshold).
- **Per-claim cap** — max reimbursable per claim.
- **Per-day cap** — max reimbursable per day per category (useful for meals).

If a claim exceeds a cap, it's flagged at submission with a warning; approver decides whether to override or reject.

### Bulk approve

Manager faces a queue of small claims. **HR → Expense claims → My approvals**, multi-select, approve all at once. Save time on review-by-review-by-review.

### Per-diem instead of receipted meals

Some businesses pay a flat per-diem (e.g. 1,500/day for travel meals) instead of expecting receipts. Set up a category "Per-diem" with no receipt requirement, fixed amount per claim line. Employees claim the per-diem days; payroll handles the rest.

### Travel advance + claim

For longer trips, employees often get a travel advance up front. The flow:

1. **Travel advance** — issued via Staff loans (a special "travel advance" loan type).
2. **Trip happens**.
3. **Expense claim** — employee submits with receipts.
4. **Reconciliation** — claim total compared to advance:
   - Claim > Advance: difference paid to employee.
   - Claim < Advance: difference recovered from employee (via payroll or cash return).
5. Travel advance loan closed.

### Claim with a foreign-currency receipt

Employee bought lunch overseas in USD. The line records the FC amount and currency; PettahPro converts to LKR at the receipt-date rate. Reimbursement happens in LKR.

### Claim mileage / fuel

For business use of personal vehicle: claim either fuel receipts or per-km mileage. PettahPro supports both. Per-km is configurable per employee (some get higher rates than others); mileage logs feed the calculation.

### Duplicate detection

PettahPro flags possibly-duplicate claims (same amount, same date, same employee, similar description). Useful when receipts are submitted twice by mistake.

## What gets posted

For a typical claim of 5,000 (taxi, meals, parking) reimbursed via payroll:

| Account | Debit | Credit |
|---|---|---|
| Travel expense | 2,500 | |
| Meals expense | 2,000 | |
| Other expense | 500 | |
| Salaries payable | | 5,000 |

The expense splits across categories per the claim lines. The Salaries payable line nets into the regular monthly payroll's salary disbursement.

If reimbursed via separate payment:

| Account | Debit | Credit |
|---|---|---|
| Travel expense | 2,500 | |
| Meals expense | 2,000 | |
| Other expense | 500 | |
| Bank | | 5,000 |

Either way, the expense lands on the P&L.

## FAQ

**An employee submitted without receipts, claiming they were lost.**
Per policy. Most businesses have a small "no-receipt allowance" (e.g. up to 500/claim, max 1 claim/month). Beyond that, no receipt = no reimbursement. PettahPro can enforce per-category receipt-required rules.

**The receipt is in the employee's name (rather than the company's). Is that OK?**
Usually — for small expenses paid out of pocket. For large purchases, ideally the receipt is in the company's name (the company can claim input VAT). For fuel, taxis, meals, employee-name receipts are normal.

**Who approves the manager's own expense claims?**
Their manager (skip-level), or another designated approver. **Settings → Approvals → Expense claims** lets you configure escalation rules so an approver can't approve their own claim.

**Can claims include input VAT we can claim back?**
For receipts that have VAT and are in the company's name: yes. The claim can include the VAT portion separately; PettahPro books the VAT to **VAT receivable** and the net to the expense account. For employee-name receipts or non-VAT receipts, no VAT claim — full amount goes to expense.

**An employee submitted a claim months after the trip. Can I still process?**
Per policy. Most businesses have a submission deadline (e.g. within 30 days of the expense). PettahPro can flag late claims at submission. Whether to accept is a management call.

**Can I see total expense per employee per month?**
Yes — **Reports → HR → Expense claims by employee**. Useful for spotting unusual patterns (one employee racking up much more than peers).

## Related

- [Payroll](./payroll.md) — for via-payroll reimbursement.
- [Staff loans](./staff-loans.md) — for travel advances.
- [Cost centres](../accounting/cost-centers.md) — for tagging claims to project / branch.
- [Settings → Approvals](../settings/overview.md) — approval matrix.
