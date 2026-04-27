---
title: Cost centres
sidebar_position: 4
---

# Cost centres

## What it does

A cost centre is a tag you can put on each line of a transaction — used to slice your reports by department, branch, project, or any other dimension your business cares about, without having to create separate accounts for each. The classic case: you want to see your P&L per branch, but you don't want a separate "Sales — Colombo", "Sales — Kandy", "Sales — Galle" account on your chart for each branch. Instead, you have one "Sales" account, and you tag each invoice with the branch as the cost centre.

Cost centres are optional. Smaller single-branch businesses don't need them. Multi-branch / multi-department / project-based businesses use them heavily.

## Walkthrough

### Setting up cost centres

Open **Accounting → Cost centres**. The list shows all cost centres with code, name, type (Branch / Department / Project / Other), and active status.

To add: **+ New cost centre**. Fill in the code (a short identifier — `COL` for Colombo, `R&D` for research, etc.), the name, the type, and an optional default account. Save.

You can have a hierarchy — sub-cost-centres under a parent. Useful for "Sales department > Sales — domestic / Sales — export" structures.

### Tagging transactions

Once cost centres exist, every transaction line has an optional **Cost centre** field. Pick the relevant one. The cost centre is stored on the line and flows into reports.

### Requiring cost centres

By default cost centres are optional — leaving the field blank is fine. To enforce: **Accounting → Cost centres → Settings → Require cost centre on all lines**. Now every transaction must have a cost centre on every line, or it can't post.

You can require cost centres only for specific account types (e.g. all expense accounts must be tagged) — useful when you don't care about cost-centre tagging on, say, bank or tax accounts.

## Common tasks

### Run a per-branch P&L

**Reports → Profit & Loss → Filter by cost centre = \[branch\]**. Or use **Compare by cost centre** for side-by-side P&L per branch on a single screen.

### Set a default cost centre per user

A cashier at the Colombo branch always tags Colombo. Setting their **Default cost centre** in their user profile means transactions they create auto-tag with Colombo. They can override per line if needed, but it saves clicks.

### Set a default cost centre per item

Similar — items can have a default cost centre. When the item appears on a transaction, the line auto-tags with that cost centre. Useful when an item only ever applies to one department.

### Reorganise cost centres

You used "Department" cost centres for a year, now you want to switch to "Project" cost centres. You can rename existing cost centres, change types, restructure the hierarchy. Historical transactions keep their original cost-centre tag — the data doesn't move, only the structural classification changes.

### Run a budget per cost centre

Budgets can be set per cost centre. **Accounting → Budgets → New budget → \[per cost centre\]**. Then **Reports → Budget vs. actual** filtered to that cost centre shows the variance.

### Hide a cost centre from new transactions

Mark it **Inactive**. New transactions can't pick it; historical reports still show it (with its label). Useful for projects that ended.

## What gets posted

Cost centres don't change what posts where — they're a tag, not an account. Every journal entry posts to the same accounts whether tagged or not. The cost centre travels with each line on the journal so reports can slice by it.

The chart of accounts and the GL stay simple — you don't need 30 versions of "Sales" for 30 branches. The cost-centre dimension is layered on top, queried at report time.

## FAQ

**Should I use cost centres or separate accounts?**
Cost centres almost always. The benefit is that your chart of accounts stays simple (one "Sales", one "Salaries", one "Rent") while reports can still slice by branch / department / project. Separate accounts force you to maintain a parallel structure for every dimension you care about — quickly unmanageable.

**Can a transaction line have two cost centres at once?**
No — one cost centre per line. If a sale genuinely benefits two departments, split it across two lines, each with its own cost centre.

**My branch managers want their own P&L. Can I give them limited access?**
Yes — set up a role with **View own cost centre's P&L**. Branch manager users are tagged with their cost centre; their P&L access is filtered automatically. They can't see other branches' numbers.

**Can cost centres apply to balance-sheet accounts?**
Some — typically receivables and payables can be tagged (so you can see "AR per branch"), bank accounts often can't (a single bank account doesn't naturally belong to one branch). Configurable per account.

**Can I bulk-add cost centres on existing transactions?**
Not easily. Cost centres are meant to be tagged at posting time. Backfilling for historical data requires a careful import process; talk to support.

**My business has only one branch — should I bother?**
Probably not. Set up cost centres only when you actually need to slice reports. Single-location, single-department businesses don't gain anything from the overhead.

## Related

- [Chart of accounts](./chart-of-accounts.md) — what cost centres complement.
- [Profit & Loss](../reports/profit-loss.md) — sliceable by cost centre.
- [Budgets](./budgets.md) — set per cost centre for branch-level variance.
- **Reports → Cost centre P&L** — dedicated multi-cost-centre comparison view.
