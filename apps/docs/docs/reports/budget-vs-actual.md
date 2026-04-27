---
title: Budget vs. actual
sidebar_position: 10
---

# Budget vs. actual

## What it does

The Budget vs. actual report compares your current performance to the budget you set at the start of the period. It tells you, line by line, where you're ahead, where you're behind, and by how much. It's the report finance teams run at the end of every month to explain variance — "we beat budget on revenue but missed on gross margin because materials cost more than we expected".

The report is only as useful as the budget you've loaded. PettahPro lets you build budgets at the account level (or by category), at any granularity (monthly, quarterly, annual). For most SMEs, a monthly budget at the account level is the right balance of detail and effort.

## How to read it

Open **Reports → Budget vs. actual** and pick:

- **Budget** — which budget version to compare against (you can have multiple, e.g. "Original 2026" and "Revised Q3 2026").
- **Period** — the period to compare.

The report has columns:

- **Account** — the line item.
- **Budget** — the budgeted amount.
- **Actual** — what actually happened.
- **Variance** — Actual − Budget.
- **Variance %** — variance as a percentage of budget.
- **Trend** — sparkline of actuals over the last few periods, for context.

Variances are coloured:

- **Green** — favourable (revenue higher than budget, expense lower than budget).
- **Red** — unfavourable (revenue lower, expense higher).

Total revenue and total expenses get summary rows at the section level. Net profit shows at the bottom.

## Common tasks

### Run for the month just closed

Pick the previous month, the active budget version. Scan for material variances. Investigate anything red and large.

### Run year-to-date

Set the period to FY-start to today. Year-to-date variance smooths out month-to-month noise — the trend is more meaningful than any single month.

### Compare two budget scenarios

Pick **Compare budgets**. Useful when you've revised the budget mid-year and want to see whether you'd hit the original or the revised. The report shows actuals plus both budgets side by side.

### Drill into a variance

Click a red row to see the underlying actual transactions. From there you can usually figure out what drove the variance — a one-off bill, an unexpected sale, a missed posting.

### Set budget at category level instead of account level

For SMEs that find account-level budgeting too detailed, you can set budgets at the **category** level — e.g. "Total marketing spend" instead of separate budgets per marketing account. Reports roll the actuals up to match. Configure in **Accounting → Budgets → Settings**.

### Export

PDF and Excel. The Excel version is most useful for management discussion (each row clickable down to the GL).

### Lock the budget

Once a budget version is signed off, **Lock** it — that prevents anyone from editing it after the fact. The variance is then "actuals vs. the budget you actually committed to", not "actuals vs. whatever the budget happens to say today".

## What it draws from

| Side | Source |
|---|---|
| Budget | The active budget version (set in **Accounting → Budgets**) |
| Actual | Posted transactions, same as the P&L |
| Variance | Computed: Actual − Budget |
| Trend sparkline | Last 6 periods of actuals |

The **as-at logic** matters: actuals through the chosen period; budget for the same period. So "March actual vs. March budget" is genuinely comparable.

## FAQ

**My budget didn't load — every line shows zero on the budget side.**
Either no budget is configured for this period, or the wrong budget version is selected. Check **Accounting → Budgets → \[your budget\]** and confirm the period and accounts are populated. Pick the right version in the report's filter.

**The variance is huge — but I think it's because of one big bill.**
Click into the variance to see the underlying transactions. If it's one big bill that is a real one-off, your budget didn't account for it — accept the variance and consider whether the next period's budget should include similar contingency. If it's a misclassified transaction, fix the classification.

**Can I budget by cost centre / branch?**
Yes — when you set up the budget, tag each line with a cost centre. The report can then filter to that cost centre, showing branch-by-branch variance.

**Should expenses below budget be celebrated?**
Sometimes. If you under-spent on something planned (marketing, training), it might mean you didn't do what you intended — which could be a problem rather than a saving. Variance interpretation is human work; the report just tells you the numbers.

**My company doesn't have a formal budget — is this report useful?**
Less so. You can set a "soft budget" by copying last year's actuals as this year's budget — that gives you a "is this year tracking with last year?" view, which isn't a budget in the strict sense but is useful comparison.

**The budget is wrong — can I edit it mid-year?**
You can edit the active budget, but it's better practice to create a **revised version** rather than rewriting history. Revised versions get their own date and signoff; the original budget stays on record. Auditors and boards prefer the revised-version approach.

## Related

- **Budgets module** — where you actually set the budget.
- [Profit & Loss](./profit-loss.md) — the actuals side of the report.
- [Trends](./trends.md) — historical actuals (no budget overlay).
- [Cost centres](../accounting/chart-of-accounts.md) — for branch-level budgets.
