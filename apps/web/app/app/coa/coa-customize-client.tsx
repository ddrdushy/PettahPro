"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Check,
  X,
  EyeOff,
  Eye,
  Trash2,
  Loader2,
} from "lucide-react";
import { api, ApiError, type Account } from "@/lib/api";

// #I3 / gaps I3 — CoA customisation wizard.
//
// This is the "wizard" for I3, but it's a flat editor rather than a
// stepper because the mental model is "review my CoA section by
// section" — there's no first/last/next state. Sections expand by
// default; users see everything they have, can rename inline, can
// deactivate the lines they don't need, and can add custom accounts.
// The same surface keeps working after first use as the day-to-day
// CoA editor.

type AccountType = Account["accountType"];

const TYPE_ORDER: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
];

const TYPE_LABEL: Record<AccountType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

const TYPE_DESCRIPTION: Record<AccountType, string> = {
  asset:
    "What your business owns — bank balances, AR, inventory, fixed assets.",
  liability:
    "What your business owes — AP, taxes payable, EPF/ETF, loans.",
  equity:
    "Owner contributions, retained earnings, dividends.",
  income:
    "Revenue from sales and other income streams.",
  expense:
    "Cost of goods sold, salaries, rent, utilities, and other operating costs.",
};

const TYPE_BADGE: Record<AccountType, string> = {
  asset: "bg-mint-surface text-mint-dark",
  liability: "bg-warning-bg text-warning",
  equity: "bg-surface-recessed text-text-secondary",
  income: "bg-mint-surface text-mint-dark",
  expense: "bg-danger-bg/50 text-danger",
};

export function CoaCustomizeClient({
  initialAccounts,
}: {
  initialAccounts: Account[];
}) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingType, setAddingType] = useState<AccountType | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const grouped = useMemo(() => {
    const map: Record<AccountType, Account[]> = {
      asset: [],
      liability: [],
      equity: [],
      income: [],
      expense: [],
    };
    for (const a of accounts) map[a.accountType].push(a);
    for (const t of TYPE_ORDER) {
      map[t].sort((a, b) => a.code.localeCompare(b.code));
    }
    return map;
  }, [accounts]);

  function applyAccount(updated: Account) {
    setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }
  function appendAccount(account: Account) {
    setAccounts((prev) => [...prev, account]);
  }
  function removeAccount(id: string) {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-md border-hairline border-border bg-surface-elevated px-4 py-3">
        <p className="text-small text-text-secondary">
          {accounts.filter((a) => a.isActive).length} active accounts ·{" "}
          {accounts.filter((a) => !a.isActive).length} inactive
        </p>
        <button
          type="button"
          onClick={() => setShowInactive((v) => !v)}
          className="inline-flex items-center gap-1.5 text-small text-charcoal hover:underline"
        >
          {showInactive ? (
            <>
              <EyeOff className="h-3.5 w-3.5" aria-hidden /> Hide inactive
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" aria-hidden /> Show inactive
            </>
          )}
        </button>
      </div>

      {TYPE_ORDER.map((type) => {
        const rows = grouped[type].filter((a) => showInactive || a.isActive);
        return (
          <section
            key={type}
            className="rounded-card border-hairline border-border bg-surface-elevated"
          >
            <header className="flex items-start justify-between gap-4 border-b-hairline border-border px-5 py-4">
              <div>
                <h2 className="text-body font-medium text-charcoal">
                  {TYPE_LABEL[type]}
                  <span className="ml-2 text-caption font-normal text-text-tertiary">
                    {grouped[type].length} accounts
                  </span>
                </h2>
                <p className="mt-1 text-caption text-text-secondary">
                  {TYPE_DESCRIPTION[type]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAddingType(type)}
                disabled={addingType !== null}
                className="inline-flex items-center gap-1.5 rounded-md border-hairline border-border-emphasis bg-charcoal px-3 py-1.5 text-small font-medium text-white hover:bg-charcoal/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add
              </button>
            </header>

            <div className="divide-y-hairline divide-border">
              {addingType === type && (
                <AddRow
                  type={type}
                  onCancel={() => setAddingType(null)}
                  onCreate={(a) => {
                    appendAccount(a);
                    setAddingType(null);
                  }}
                />
              )}
              {rows.length === 0 && addingType !== type ? (
                <p className="px-5 py-6 text-small text-text-tertiary">
                  No accounts in this section.
                </p>
              ) : (
                rows.map((a) =>
                  editingId === a.id ? (
                    <EditRow
                      key={a.id}
                      account={a}
                      onCancel={() => setEditingId(null)}
                      onSave={(updated) => {
                        applyAccount(updated);
                        setEditingId(null);
                      }}
                    />
                  ) : (
                    <DisplayRow
                      key={a.id}
                      account={a}
                      onEdit={() => setEditingId(a.id)}
                      onToggleActive={(updated) => applyAccount(updated)}
                      onDelete={() => removeAccount(a.id)}
                    />
                  ),
                )
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DisplayRow({
  account,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  account: Account;
  onEdit: () => void;
  onToggleActive: (updated: Account) => void;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState<"toggle" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    setBusy("toggle");
    setError(null);
    try {
      const { account: updated } = await api.updateAccount(account.id, {
        isActive: !account.isActive,
      });
      onToggleActive(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (
      !confirm(
        `Delete account ${account.code} — ${account.name}? This is only possible if no journal entries reference it.`,
      )
    )
      return;
    setBusy("delete");
    setError(null);
    try {
      await api.deleteAccount(account.id);
      onDelete();
    } catch (err) {
      setError(
        err instanceof ApiError && err.message
          ? err.message
          : "Couldn't delete.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-5 py-3 ${
        account.isActive ? "" : "bg-surface-recessed/30"
      }`}
    >
      <div className="w-20 shrink-0 tabular-nums font-medium text-charcoal">
        {account.code}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`text-small ${
            account.isActive ? "text-charcoal" : "text-text-tertiary line-through"
          }`}
        >
          {account.name}
        </p>
        {account.accountSubtype && (
          <p className="text-caption text-text-tertiary">
            {account.accountSubtype}
          </p>
        )}
      </div>
      <span className="text-caption uppercase text-text-tertiary">
        {account.normalSide}
      </span>
      {account.isSystem ? (
        <span className="rounded-full bg-surface-recessed px-2 py-0.5 text-caption text-text-secondary">
          System
        </span>
      ) : (
        <span className="rounded-full bg-mint-surface/40 px-2 py-0.5 text-caption text-mint-dark">
          Custom
        </span>
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-recessed/40 hover:text-charcoal"
          title="Rename"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={handleToggle}
          disabled={busy !== null}
          className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-recessed/40 hover:text-charcoal disabled:opacity-50"
          title={account.isActive ? "Deactivate" : "Activate"}
        >
          {busy === "toggle" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : account.isActive ? (
            <EyeOff className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Eye className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
        {!account.isSystem && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy !== null}
            className="rounded-md p-1.5 text-text-tertiary hover:bg-danger-bg/40 hover:text-danger disabled:opacity-50"
            title="Delete"
          >
            {busy === "delete" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="basis-full text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function EditRow({
  account,
  onCancel,
  onSave,
}: {
  account: Account;
  onCancel: () => void;
  onSave: (updated: Account) => void;
}) {
  const [name, setName] = useState(account.name);
  const [code, setCode] = useState(account.code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const updates: { name?: string; code?: string } = {};
      if (name.trim() && name !== account.name) updates.name = name.trim();
      if (!account.isSystem && code.trim() && code !== account.code) {
        updates.code = code.trim();
      }
      if (Object.keys(updates).length === 0) {
        onCancel();
        return;
      }
      const { account: updated } = await api.updateAccount(account.id, updates);
      onSave(updated);
    } catch (err) {
      setError(
        err instanceof ApiError && err.message
          ? err.message
          : "Couldn't save.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 bg-mint-surface/20 px-5 py-3">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        disabled={account.isSystem}
        className="w-20 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1 text-small tabular-nums text-charcoal disabled:bg-surface-recessed/40 disabled:text-text-tertiary"
        title={account.isSystem ? "System account code is fixed." : "Edit code"}
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-0 flex-1 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1 text-small text-charcoal"
        placeholder="Account name"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={busy}
        className="rounded-md p-1.5 text-mint-dark hover:bg-mint-surface/40 disabled:opacity-50"
        title="Save"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Check className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-recessed/40 hover:text-charcoal"
        title="Cancel"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      {error && (
        <p role="alert" className="basis-full text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function AddRow({
  type,
  onCancel,
  onCreate,
}: {
  type: AccountType;
  onCancel: () => void;
  onCreate: (a: Account) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  // Sensible default: assets+expenses are debit-normal, liabilities+equity+income are credit-normal.
  const defaultSide: Account["normalSide"] =
    type === "asset" || type === "expense" ? "dr" : "cr";
  const [normalSide, setNormalSide] = useState<Account["normalSide"]>(defaultSide);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const { account } = await api.createAccount({
        code: code.trim(),
        name: name.trim(),
        accountType: type,
        normalSide,
      });
      onCreate(account);
    } catch (err) {
      setError(
        err instanceof ApiError && err.message
          ? err.message
          : "Couldn't create.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 bg-mint-surface/20 px-5 py-3">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Code"
        className="w-20 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1 text-small tabular-nums text-charcoal"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`New ${TYPE_LABEL[type].toLowerCase().slice(0, -1)} account`}
        className="min-w-0 flex-1 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1 text-small text-charcoal"
      />
      <select
        value={normalSide}
        onChange={(e) => setNormalSide(e.target.value as Account["normalSide"])}
        className="rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1 text-caption uppercase text-charcoal"
      >
        <option value="dr">Debit</option>
        <option value="cr">Credit</option>
      </select>
      <span className={`rounded-full px-2 py-0.5 text-caption capitalize ${TYPE_BADGE[type]}`}>
        {type}
      </span>
      <button
        type="button"
        onClick={handleCreate}
        disabled={busy || !code.trim() || !name.trim()}
        className="rounded-md p-1.5 text-mint-dark hover:bg-mint-surface/40 disabled:opacity-50"
        title="Create"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Check className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-recessed/40 hover:text-charcoal"
        title="Cancel"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      {error && (
        <p role="alert" className="basis-full text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
