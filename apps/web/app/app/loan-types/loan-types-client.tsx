"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Layers, Loader2, Plus } from "lucide-react";
import { api, ApiError, type LoanType } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

export function LoanTypesClient({ initial }: { initial: LoanType[] }) {
  const router = useRouter();
  const [types, setTypes] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    maxAmount: "0",
    defaultRatePct: "0",
    defaultTenure: "6",
    maxTenure: "60",
    isInterestBearing: false,
  });

  async function toggleActive(t: LoanType) {
    setError(null);
    try {
      const res = await api.updateLoanType(t.id, { isActive: !t.isActive });
      setTypes((prev) => prev.map((x) => (x.id === t.id ? res.loanType : x)));
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
      const maxAmount = Number(form.maxAmount || "0");
      const res = await api.createLoanType({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        maxAmountCents: maxAmount > 0 ? Math.round(maxAmount * 100) : null,
        defaultInterestRateBps: Math.round(Number(form.defaultRatePct || "0") * 100),
        defaultTenureMonths: Number(form.defaultTenure) || 6,
        maxTenureMonths: Number(form.maxTenure) || 60,
        isInterestBearing: form.isInterestBearing,
      });
      setTypes((prev) => [...prev, res.loanType].sort((a, b) => a.name.localeCompare(b.name)));
      setShowForm(false);
      setForm({
        code: "",
        name: "",
        description: "",
        maxAmount: "0",
        defaultRatePct: "0",
        defaultTenure: "6",
        maxTenure: "60",
        isInterestBearing: false,
      });
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
        title="Loan types"
        description="Library of staff loan templates — festival, salary advance, emergency, housing, vehicle. Caps and defaults here prefill the application form."
        action={
          <button type="button" onClick={() => setShowForm((s) => !s)} className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            {showForm ? "Close" : "New loan type"}
          </button>
        }
      />

      {showForm && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Code</label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="HEALTH, EDU"
                maxLength={32}
                className="input mt-1.5 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Medical loan"
                className="input mt-1.5"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="One-line description"
                className="input mt-1.5"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Max amount (LKR, 0 = no cap)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.maxAmount}
                onChange={(e) => setForm({ ...form, maxAmount: e.target.value })}
                className="input mt-1.5 text-right tabular-nums"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Default interest rate (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.defaultRatePct}
                onChange={(e) => setForm({ ...form, defaultRatePct: e.target.value })}
                className="input mt-1.5 text-right tabular-nums"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Default tenure (months)</label>
              <input
                type="number"
                min="1"
                max="120"
                value={form.defaultTenure}
                onChange={(e) => setForm({ ...form, defaultTenure: e.target.value })}
                className="input mt-1.5 text-right tabular-nums"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Max tenure (months)</label>
              <input
                type="number"
                min="1"
                max="120"
                value={form.maxTenure}
                onChange={(e) => setForm({ ...form, maxTenure: e.target.value })}
                className="input mt-1.5 text-right tabular-nums"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-small text-charcoal">
              <input
                type="checkbox"
                checked={form.isInterestBearing}
                onChange={(e) => setForm({ ...form, isInterestBearing: e.target.checked })}
                className="h-4 w-4 rounded border-border-emphasis"
              />
              Interest-bearing <span className="text-caption text-text-tertiary">(applicants can set a rate)</span>
            </label>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            {error && <span className="text-small text-danger">{error}</span>}
            <button type="button" onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Create
            </button>
          </div>
        </section>
      )}

      {types.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <Layers className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No loan types yet.</p>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-24 px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="w-32 px-4 py-3 text-right">Cap</th>
                <th className="w-24 px-4 py-3 text-right">Rate</th>
                <th className="w-28 px-4 py-3 text-right">Default tenure</th>
                <th className="w-28 px-4 py-3 text-right">Max tenure</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {types.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 tabular-nums font-medium text-charcoal">{t.code}</td>
                  <td className="px-4 py-3 text-text-primary">
                    {t.name}
                    {t.isSystem && <span className="ml-2 text-caption text-text-tertiary">System</span>}
                    {t.description && (
                      <p className="text-caption text-text-tertiary">{t.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {t.maxAmountCents != null ? formatLKR(t.maxAmountCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {(t.defaultInterestRateBps / 100).toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {t.defaultTenureMonths} mo
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {t.maxTenureMonths} mo
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => toggleActive(t)}
                      className={`rounded-full px-2.5 py-0.5 text-caption font-medium transition ${
                        t.isActive
                          ? "bg-mint-surface text-mint-dark hover:bg-mint"
                          : "bg-surface-recessed text-text-secondary hover:bg-warning-bg"
                      }`}
                    >
                      {t.isActive ? "Active" : "Inactive"}
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
