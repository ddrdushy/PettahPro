---
title: Budgets
sidebar_position: 5
---

# Budgets

## What it does

A budget is your plan for how much you expect to earn and spend over a period — by account, by month (or quarter, or year), optionally by cost centre. Once loaded, the **Budget vs. actual** report shows you, line by line, where you're hitting your plan and where you're missing.

For most SMEs, the value of budgeting isn't precision — it's the act of writing down expectations. Even a rough budget makes month-end variance reviews much more useful than reading actuals in isolation.

## Walkthrough

### Creating a budget

Open **Accounting → Budgets → + New budget**.

1. **Name** — e.g. "Original 2026", "Revised Q3 2026". Multiple versions are supported (see below).
2. **Period** — financial year, calendar year, or custom date range.
3. **Granularity** — monthly / quarterly / annual.
4. **Cost centre** (optional) — for branch-level or department-level budgets, pick the cost centre. Otherwise the budget covers the whole business.
5. **Budget type** — start blank, copy from prior year's actuals (a common starting point), or import from CSV.

### Entering the lines

The grid lays out:

- **Rows** — accounts from your chart (typically just income and expense accounts; balance-sheet accounts are budgeted less commonly).
- **Columns** — periods (12 monthly, 4 quarterly, etc.).

Type in the budgeted amount per cell. Common patterns:

- **Equal split** — type the annual figure, click **Spread evenly** to split across periods.
- **Seasonal weighting** — type the annual figure with a seasonal curve (e.g. 60% in H2 for retail businesses).
- **Per-account different shape** — fixed costs are flat per month, sales follow a seasonal curve, etc.

### Locking the budget

Once the budget is signed off (board, owner, finance lead), click **Lock**. Locked budgets can't be edited. Variance reports always compare to "what we actually committed to" rather than "whatever the budget says today".

### Revising

Need to change mid-year? Don't unlock the original — that breaks the audit trail. Instead, **Create revision**. Copy the original, edit the changes, lock the revised version. Variance reports can show either version (or both side by side).

## Common tasks

### Set a per-branch budget

Create one budget per cost centre (each branch is a cost centre). Each budget has its own line set; variance reports can be run per branch. Useful for accountability — each branch manager owns their numbers.

### Copy last year's actuals as this year's budget

Quick starting point. **+ New budget → Copy from → \[last year's actuals\]**. PettahPro fills the grid with last year's per-account, per-month actuals. Adjust upward (or downward) for expected growth. Lock.

### Import from a spreadsheet

If your finance team already builds budgets in Excel, **Import** takes a CSV with columns "Account, Period, Amount". Each row becomes a budget cell. Useful for the once-a-year load; ongoing edits happen in PettahPro.

### Budget at category level instead of account level

For SMEs with too many accounts to budget individually, set the budget granularity to **Category** rather than account. Budget covers the category total; reports roll up actuals to match. Less detailed but much faster to maintain.

### Update a single line

Open the budget → click into the cell → type the new value → save. PettahPro records the edit in the audit trail (only allowed if the budget isn't locked).

### Compare budget to last year's actuals

Two columns side by side. **Reports → Budget vs. actual → Compare with last year**. Useful for sanity-checking — "we budgeted 30% growth but last year we only grew 15%; is the budget realistic?"

### Run a budget for a closed period

Budgets are read-only after their period ends — you can't post a new budget for last year, only see what was budgeted. Useful for "did we hit the target?" reviews.

## What gets posted

**Nothing.** Budgets are plans, not transactions. They don't move any account.

What budgets affect:
- **Budget vs. actual report** — variance computation.
- **Variance alerts** — optional alerts when a line goes 20% over budget (configurable).
- **Cost centre dashboards** — branch managers see their actuals against budget.

## FAQ

**Should I budget every account?**
No — focus on the accounts that matter. Sales, key expenses (salaries, rent, COGS), and any line you care about controlling. Tiny incidentals (paper, parking) probably aren't worth budgeting individually; bundle them under a "miscellaneous expenses" line.

**A budget cell is much higher than the actual — should I bring the budget down?**
Don't retroactively edit a locked budget — that breaks the variance signal. The budget is what you committed to; variance is the reality. If the budget was wrong, the lesson is for next year's budgeting cycle.

If you genuinely need to revise (e.g. major business change), use the revision flow — keeps both the original and the revised version on record.

**Can I budget for the next 5 years?**
Yes — the period can span multiple years, with annual or quarterly granularity. Multi-year budgets are common for capital projects and long-cycle businesses.

**What if my budget total doesn't equal the sum of lines?**
The grid shows totals at the bottom. PettahPro doesn't enforce a relationship between line totals and any "budget total" — there isn't one. Each cell is independent; the report shows them aggregated however you want.

**Can I budget cash flow as well as P&L?**
The Budget vs. actual report covers P&L by default. For cash flow budgeting, use the **Cash flow forecast** module — separate from the P&L budget, focuses on actual money movement.

**My team doesn't budget. Should I make them?**
Budgeting is most useful when the team that's accountable for the numbers has input into the budget. Top-down budgets handed down ("hit this number") tend to be ignored. Bottom-up budgets ("what do you think you can do?") tend to be more useful for variance review and learning. Pick the level of formality that matches your team's culture.

## Related

- [Budget vs. actual report](../reports/budget-vs-actual.md).
- [Profit & Loss](../reports/profit-loss.md) — the actuals side.
- [Cost centres](./cost-centers.md) — for per-branch budgeting.
- [Chart of accounts](./chart-of-accounts.md) — the lines being budgeted.
