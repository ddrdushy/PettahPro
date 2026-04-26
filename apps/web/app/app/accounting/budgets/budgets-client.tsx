"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  ApiError,
  api,
  type Account,
  type Budget,
  type BudgetLine,
  type CostCenter,
} from "@/lib/api";

// Budgets editor (#133 / gaps B2). Tight v1 UX:
//   * Header form (name / fiscal year / status / notes) at the top
//   * Spreadsheet-style line editor (account + cost center + amount)
//   * Replace-all PUT for lines on save — same model as document
//     templates, lighter than per-row CRUD.
//
// Future polish (deferred): per-month split, copy-from-prior-year,
// CSV import.

interface LineDraft {
  id: string;
  accountId: string;
  costCenterId: string;
  amountInput: string; // LKR major as user types
  notes: string;
}

function emptyLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    accountId: "",
    costCenterId: "",
    amountInput: "",
    notes: "",
  };
}

function fromBudgetLine(line: BudgetLine): LineDraft {
  return {
    id: line.id,
    accountId: line.accountId,
    costCenterId: line.costCenterId ?? "",
    amountInput: (line.amountCents / 100).toString(),
    notes: line.notes ?? "",
  };
}

function toCents(s: string): number {
  const v = Number(s);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100);
}

function formatLkr(cents: number): string {
  return `LKR ${(cents / 100).toLocaleString("en-LK", {
    maximumFractionDigits: 0,
  })}`;
}

const STATUS_LABEL: Record<Budget["status"], string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

export function BudgetsClient({
  initialBudgets,
  accounts,
  costCenters,
}: {
  initialBudgets: Budget[];
  accounts: Account[];
  costCenters: CostCenter[];
}) {
  const router = useRouter();
  const [budgets, setBudgets] = useState(initialBudgets);
  const [activeId, setActiveId] = useState<string | null>(
    initialBudgets[0]?.id ?? null,
  );
  const [activeLines, setActiveLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  // Header form state — shadow of the active budget; lets us edit
  // name/status without re-fetching.
  const [headerForm, setHeaderForm] = useState<{
    name: string;
    fiscalYear: number;
    status: Budget["status"];
    notes: string;
  }>({
    name: "",
    fiscalYear: new Date().getUTCFullYear(),
    status: "draft",
    notes: "",
  });

  const activeBudget = useMemo(
    () => budgets.find((b) => b.id === activeId) ?? null,
    [budgets, activeId],
  );

  // Load lines whenever activeId changes.
  useEffect(() => {
    if (!activeId) {
      setActiveLines([emptyLine()]);
      return;
    }
    api
      .getBudget(activeId)
      .then(({ budget, lines }) => {
        setHeaderForm({
          name: budget.name,
          fiscalYear: budget.fiscalYear,
          status: budget.status,
          notes: budget.notes ?? "",
        });
        setActiveLines(
          lines.length > 0 ? lines.map(fromBudgetLine) : [emptyLine()],
        );
      })
      .catch(() => {
        setError("Couldn't load this budget.");
      });
  }, [activeId]);

  function refreshList() {
    api
      .listBudgets()
      .then((r) => setBudgets(r.budgets))
      .catch(() => {});
    router.refresh();
  }

  async function onCreate() {
    setError(null);
    setBusy(true);
    try {
      const { budget } = await api.createBudget({
        name: `Budget ${new Date().getUTCFullYear()}`,
        fiscalYear: new Date().getUTCFullYear(),
        status: "draft",
      });
      refreshList();
      setBudgets((b) => [...b, budget]);
      setActiveId(budget.id);
      setCreating(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Create failed."
          : "Network error.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onSaveHeader() {
    if (!activeId) return;
    setError(null);
    setBusy(true);
    try {
      const { budget } = await api.updateBudget(activeId, {
        name: headerForm.name,
        status: headerForm.status,
        notes: headerForm.notes || null,
      });
      setBudgets((b) => b.map((x) => (x.id === budget.id ? budget : x)));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Update failed."
          : "Network error.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onSaveLines() {
    if (!activeId) return;
    setError(null);
    const filtered = activeLines.filter((l) => l.accountId);
    setBusy(true);
    try {
      await api.replaceBudgetLines(
        activeId,
        filtered.map((l) => ({
          accountId: l.accountId,
          costCenterId: l.costCenterId || null,
          amountCents: toCents(l.amountInput),
          notes: l.notes.trim() || null,
        })),
      );
      // Refetch lines to pick up server-assigned ids
      const fresh = await api.getBudget(activeId);
      setActiveLines(
        fresh.lines.length > 0 ? fresh.lines.map(fromBudgetLine) : [emptyLine()],
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Save failed."
          : "Network error.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!activeId || !activeBudget) return;
    if (
      !confirm(
        `Delete budget "${activeBudget.name}"? Existing lines are removed; the actuals (journal entries) stay untouched.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await api.deleteBudget(activeId);
      const remaining = budgets.filter((b) => b.id !== activeId);
      setBudgets(remaining);
      setActiveId(remaining[0]?.id ?? null);
      refreshList();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Delete failed."
          : "Network error.",
      );
    }
  }

  function addLine() {
    setActiveLines((r) => [...r, emptyLine()]);
  }
  function removeLine(id: string) {
    setActiveLines((r) =>
      r.length <= 1 ? [emptyLine()] : r.filter((l) => l.id !== id),
    );
  }
  function patchLine(id: string, patch: Partial<LineDraft>) {
    setActiveLines((r) =>
      r.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  const totalCents = activeLines.reduce(
    (s, l) => s + toCents(l.amountInput),
    0,
  );

  return (
    <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      {/* Sidebar list */}
      <aside>
        <div className="flex items-center justify-between">
          <h2 className="text-small font-medium uppercase tracking-wide text-text-secondary">
            All budgets
          </h2>
          <button
            type="button"
            onClick={onCreate}
            disabled={busy || creating}
            className="text-caption text-mint hover:underline disabled:opacity-50"
          >
            + New
          </button>
        </div>
        <div className="mt-3 space-y-1">
          {budgets.length === 0 ? (
            <p className="text-small text-text-secondary">
              No budgets yet. Click "+ New" to create one.
            </p>
          ) : (
            budgets.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setActiveId(b.id)}
                className={`w-full rounded-md border px-3 py-2 text-left text-small ${
                  activeId === b.id
                    ? "border-mint/50 bg-mint-surface text-text-primary"
                    : "border-border-subtle bg-surface hover:bg-surface-recessed text-text-primary"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-caption text-text-secondary">
                    FY {b.fiscalYear}
                  </span>
                </div>
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-caption ${
                    b.status === "active"
                      ? "bg-emerald-100 text-emerald-900"
                      : b.status === "draft"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-neutral-200 text-neutral-700"
                  }`}
                >
                  {STATUS_LABEL[b.status]}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main editor */}
      <section>
        {!activeBudget ? (
          <p className="text-body text-text-secondary">
            Pick a budget on the left to edit its lines.
          </p>
        ) : (
          <>
            {/* Header form */}
            <div className="rounded-card border border-border-subtle bg-surface p-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="block text-caption uppercase tracking-wide text-text-secondary">
                    Name
                  </label>
                  <input
                    type="text"
                    value={headerForm.name}
                    onChange={(e) =>
                      setHeaderForm((f) => ({ ...f, name: e.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-body text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-caption uppercase tracking-wide text-text-secondary">
                    Fiscal year
                  </label>
                  <input
                    type="number"
                    value={headerForm.fiscalYear}
                    disabled
                    className="mt-1 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-body text-text-primary disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-caption uppercase tracking-wide text-text-secondary">
                    Status
                  </label>
                  <select
                    value={headerForm.status}
                    onChange={(e) =>
                      setHeaderForm((f) => ({
                        ...f,
                        status: e.target.value as Budget["status"],
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-body text-text-primary"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-caption uppercase tracking-wide text-text-secondary">
                  Notes
                </label>
                <textarea
                  value={headerForm.notes}
                  onChange={(e) =>
                    setHeaderForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  rows={2}
                  className="mt-1 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-small text-text-primary"
                />
              </div>
              <div className="mt-3 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={onDelete}
                  className="btn-secondary text-small"
                >
                  Delete budget
                </button>
                <button
                  type="button"
                  onClick={onSaveHeader}
                  disabled={busy}
                  className="btn-primary text-small disabled:opacity-50"
                >
                  Save header
                </button>
              </div>
            </div>

            {/* Lines spreadsheet */}
            <div className="mt-6 rounded-card border border-border-subtle bg-surface p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-h3 text-text-primary">Budget lines</h3>
                <span className="text-small text-text-secondary">
                  Total: {formatLkr(totalCents)}
                </span>
              </div>

              {error && (
                <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-small text-red-700">
                  {error}
                </div>
              )}

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-small">
                  <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left">Account</th>
                      <th className="px-3 py-2 text-left">Cost center</th>
                      <th className="px-3 py-2 text-right">Annual amount</th>
                      <th className="px-3 py-2 text-left">Notes</th>
                      <th className="w-10 px-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {activeLines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2">
                          <select
                            value={line.accountId}
                            onChange={(e) =>
                              patchLine(line.id, { accountId: e.target.value })
                            }
                            className="w-full rounded-md border border-border-subtle bg-bg-base px-2 py-1.5 text-small text-text-primary"
                          >
                            <option value="">— Pick account —</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} — {a.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={line.costCenterId}
                            onChange={(e) =>
                              patchLine(line.id, {
                                costCenterId: e.target.value,
                              })
                            }
                            className="w-full rounded-md border border-border-subtle bg-bg-base px-2 py-1.5 text-small text-text-primary"
                          >
                            <option value="">— All centers —</option>
                            {costCenters.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.code} — {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={line.amountInput}
                            onChange={(e) =>
                              patchLine(line.id, {
                                amountInput: e.target.value,
                              })
                            }
                            placeholder="0"
                            className="w-full rounded-md border border-border-subtle bg-bg-base px-2 py-1.5 text-small text-text-primary text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={line.notes}
                            onChange={(e) =>
                              patchLine(line.id, { notes: e.target.value })
                            }
                            className="w-full rounded-md border border-border-subtle bg-bg-base px-2 py-1.5 text-small text-text-primary"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            className="text-text-tertiary hover:text-rose-700"
                            aria-label="Remove line"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex justify-between">
                <button
                  type="button"
                  onClick={addLine}
                  className="btn-secondary text-small"
                >
                  <Plus className="h-3.5 w-3.5" /> Add line
                </button>
                <button
                  type="button"
                  onClick={onSaveLines}
                  disabled={busy}
                  className="btn-primary text-small disabled:opacity-50"
                >
                  Save lines
                </button>
              </div>
            </div>

            <p className="mt-6 text-caption text-text-secondary">
              <Link href="/app/reports/budget-vs-actual" className="btn-link">
                Open budget vs actual report →
              </Link>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
