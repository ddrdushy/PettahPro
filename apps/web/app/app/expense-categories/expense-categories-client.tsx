"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Layers, Loader2, Plus } from "lucide-react";
import {
  api,
  ApiError,
  type Account,
  type ExpenseCategory,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

export function ExpenseCategoriesClient({
  categories: initial,
  accounts,
}: {
  categories: ExpenseCategory[];
  accounts: Account[];
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const emptyForm = {
    code: "",
    name: "",
    description: "",
    expenseAccountId: "",
    isTaxable: false,
  };
  const [form, setForm] = useState(emptyForm);

  const expenseAccounts = useMemo(
    () =>
      accounts
        .filter(
          (a) =>
            a.isActive &&
            a.accountType === "expense",
        )
        .sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );

  function accountLabel(id: string | null) {
    if (!id) return "—";
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} · ${a.name}` : "—";
  }

  async function toggleActive(c: ExpenseCategory) {
    setError(null);
    try {
      const res = await api.updateExpenseCategory(c.id, { isActive: !c.isActive });
      setCategories((prev) =>
        prev.map((x) => (x.id === c.id ? res.category : x)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update.");
    }
  }

  async function save() {
    setError(null);
    if (!form.code.trim() || !form.name.trim()) {
      setError("Code and name are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createExpenseCategory({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        expenseAccountId: form.expenseAccountId || null,
        isTaxable: form.isTaxable,
      });
      setCategories((prev) =>
        [...prev, res.category].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setShowForm(false);
      setForm(emptyForm);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Expense categories"
        description="Library for employee expense claims — travel, meals, fuel, and so on. Each category maps to a GL expense account so approved claims post to the right place."
        action={
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {showForm ? "Close" : "New category"}
          </button>
        }
      />

      {showForm && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Code
              </label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="MILEAGE, CLIENT_ENT"
                maxLength={32}
                className="input mt-1.5 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Mileage reimbursement"
                className="input mt-1.5"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Description
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="One-line description"
                className="input mt-1.5"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Expense account
              </label>
              <select
                value={form.expenseAccountId}
                onChange={(e) =>
                  setForm({ ...form, expenseAccountId: e.target.value })
                }
                className="input mt-1.5"
              >
                <option value="">Select account…</option>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-caption text-text-tertiary">
                Claims in this category post DR here on approval.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-small text-charcoal">
              <input
                type="checkbox"
                checked={form.isTaxable}
                onChange={(e) => setForm({ ...form, isTaxable: e.target.checked })}
                className="h-4 w-4 rounded border-border-emphasis"
              />
              Taxable{" "}
              <span className="text-caption text-text-tertiary">
                (counts toward EPF/ETF/PAYE if bundled in payroll)
              </span>
            </label>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            {error && <span className="text-small text-danger">{error}</span>}
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="btn-primary disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Create
            </button>
          </div>
        </section>
      )}

      {categories.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <Layers className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No expense categories yet.</p>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Expense account</th>
                <th className="w-24 px-4 py-3 text-center">Taxable</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {categories.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 tabular-nums font-medium text-charcoal">
                    {c.code}
                  </td>
                  <td className="px-4 py-3 text-text-primary">
                    {c.name}
                    {c.isSystem && (
                      <span className="ml-2 text-caption text-text-tertiary">System</span>
                    )}
                    {c.description && (
                      <p className="text-caption text-text-tertiary">{c.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary tabular-nums">
                    {accountLabel(c.expenseAccountId)}
                  </td>
                  <td className="px-4 py-3 text-center text-text-secondary">
                    {c.isTaxable ? "Yes" : "No"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => toggleActive(c)}
                      className={`rounded-full px-2.5 py-0.5 text-caption font-medium transition ${
                        c.isActive
                          ? "bg-mint-surface text-mint-dark hover:bg-mint"
                          : "bg-surface-recessed text-text-secondary hover:bg-warning-bg"
                      }`}
                    >
                      {c.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
