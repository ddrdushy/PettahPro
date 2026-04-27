---
title: Chart of accounts
sidebar_position: 1
---

# Chart of accounts

## What it does

Your chart of accounts is the list of every "bucket" your money can sit in — your bank account, customer balances, sales income, salaries, VAT payable, and so on. Every transaction in PettahPro moves money between two or more of these buckets. The chart is the structure that makes your reports possible: the trial balance, P&L, and balance sheet all draw from it.

PettahPro starts you off with a Sri Lankan-typical chart of accounts when you sign up — you can use it as-is, rename things to match how you talk about your business, or add accounts of your own.

## Walkthrough

Open **Accounting → Chart of accounts**. You'll see the full list, grouped into five sections:

- **Assets** — your cash, bank accounts, money customers owe you, inventory, fixed assets.
- **Liabilities** — money you owe (suppliers, VAT, EPF/ETF/PAYE, salaries).
- **Equity** — owner's equity, retained earnings.
- **Income** — sales revenue, other income.
- **Expenses** — cost of goods sold, salaries, rent, utilities, etc.

Each row has:
- **Code** — a short numeric identifier (e.g. `1010`, `4000`).
- **Name** — what the account is called.
- **Type** — Asset / Liability / Equity / Income / Expense.
- **Balance** — the current running total.
- **Active** — whether it's available on transaction screens.

### Renaming an account

Click any account row → **Edit** → change the name → **Save**. Renaming is safe — it doesn't affect any historical transaction; it just changes the label going forward. Common renames:

- `Bank — primary` → `Sampath Current Account`
- `Sales revenue` → `Sales — restaurant` (if you want different income categories per division)

### Hiding an account you won't use

If a built-in account doesn't apply to your business (a service business doesn't need "Inventory", a small business might not need "Petty cash"), open it and tick **Inactive**. It stops appearing on transaction screens. You can flip it back on any time.

You can't deactivate an account that has a non-zero balance — clear the balance first by reclassifying entries or settling, then deactivate.

### Adding a custom account

Click **+ New account**. Fill in:
- **Section** (Asset / Liability / Equity / Income / Expense).
- **Code** — pick a number that fits the section (assets are 1xxx, liabilities 2xxx, equity 3xxx, income 4xxx, expenses 5xxx–6xxx). Many people use blocks of 10 so they have room to add related accounts later.
- **Name** — what you want to call it.
- **Type** — defaults to match the section, but for some accounts you may pick a sub-type (e.g. an asset can be Bank, Cash, AR, Inventory, etc.).

Save. The new account appears in the list and is available on every transaction screen.

### Restrictions on built-in accounts

For the accounts PettahPro ships, you can:

- ✅ Rename them.
- ✅ Deactivate them (if balance is zero).
- ✅ Reorder them in display.
- ❌ Change the **code** — modules look these up by code (e.g. invoice posting always credits "VAT payable", which is identified by code).
- ❌ Change the **type** — an account that's wired up as a bank account must remain a bank account.

For accounts you create yourself, you can change anything you like.

## Common tasks

### Add a second bank account

You opened a new bank account (e.g. a USD account, or moved to a different bank). Add it as an asset of type **Bank** with a free numeric code in the 1000s (1011, 1012, etc.). Once saved, it shows up wherever bank accounts are pickable — receipts, payments, transfers, reconciliation.

### Track multiple sales lines separately

If you want your P&L to show, say, "Restaurant sales", "Bar sales", and "Delivery sales" as separate lines, add three custom income accounts and assign each to the relevant items via the item's **Income account** field. Posted invoices then book to the right account, and the P&L shows the three lines automatically.

### Show different expense categories than the defaults

Same idea — add custom expense accounts with codes in the 5000s/6000s, and either point items/services at them, or use the right one when posting bills and journals.

### Use cost centres instead of separate accounts

If you want to slice sales by branch or department but you don't actually want a separate income account per branch, **cost centres** are usually the right tool. They're a tag you put on each line of a transaction; reports can then group by cost centre without needing one account per slice. Add cost centres in **Accounting → Cost centres**, then turn on **Require cost centre** if you want every transaction line to have one.

### Find what's posting to a given account

Click any account in the chart → **View ledger**. That opens the general ledger filtered to just this account, oldest-first. From there you can drill into any line to see the source transaction.

## What gets posted

Editing the chart of accounts itself doesn't post anything to your books — it's structural, not transactional. Renaming, hiding, or adding an account doesn't move a single rupee.

What's relevant is **what posts to which account** when you do other things:

| You do | These accounts move |
|---|---|
| Post an invoice | Accounts receivable (DR), Sales revenue (CR), VAT payable (CR) |
| Receive a payment | Bank (DR), Accounts receivable (CR) |
| Post a bill | Expense or Inventory (DR), VAT receivable (DR), Accounts payable (CR) |
| Pay a supplier | Accounts payable (DR), Bank (CR) |
| Approve a payroll run | Salaries — gross (DR), EPF/ETF/PAYE payable (CR), Salaries payable (CR) |
| Post a manual journal | Whatever you specify on the lines |

The chart is the menu of possible buckets. The transactions decide which buckets actually move.

## FAQ

**Why did PettahPro pre-load a chart of accounts? Can I delete it and start blank?**
The pre-loaded chart covers the standard accounts every Sri Lankan SME needs (bank, AR, AP, VAT payable, EPF/ETF/PAYE payable, sales, COGS, etc.) and it's wired into the modules — invoices know to post VAT to "VAT payable", payroll knows to credit "EPF payable", and so on. Starting blank would mean reconnecting all that yourself, so we don't support it. You can rename, hide, and add freely; you can't replace the chart wholesale.

**My accountant uses a different code numbering system. Can I change codes?**
Not on the built-in accounts — modules look them up by code. You can rename them freely, and you can use whatever codes you like on accounts you add yourself. If your accountant has strong opinions about codes, they almost always come around once they see the rest of the chart is sensibly numbered.

**The trial balance has an account I don't recognise.**
Click the account in the chart of accounts and view its ledger. The first transaction will tell you why it exists — usually it's an opening balance you imported, an automatic entry from a module, or a one-off journal someone posted. From there you can decide whether to leave it or reclassify.

**An account has a balance going the "wrong" way (e.g. AP showing a debit).**
Usually that's a signal of a real condition — e.g. a supplier paid back a credit and AP is now in your favour, so it shows as a debit (an "advance to supplier", which is technically an asset). Don't fix it by editing the chart; investigate the transactions and if it's a genuine error, reverse the offending entry.

**Can different branches have different charts?**
No — there's one chart per business. Use **cost centres** to slice the same chart by branch instead. That way reports can show per-branch P&L without you having to maintain N parallel charts.

## Related

- **Journal entries** — how to post manual transactions across accounts.
- **Cost centres** — slicing reports by department or branch without adding accounts.
- **Opening balance** — loading the chart with starting balances when migrating from another system.
- **General ledger report** — drilling into any account's transaction history.
- [Glossary — DR/CR](../concepts/glossary.md#dr--cr--debit--credit) — how debits and credits work.
