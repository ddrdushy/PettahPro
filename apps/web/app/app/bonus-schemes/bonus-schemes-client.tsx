"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Gift, Loader2, Plus } from "lucide-react";
import {
  api,
  ApiError,
  type BonusFormulaType,
  type BonusScheme,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

const FORMULA_LABELS: Record<BonusFormulaType, string> = {
  flat_amount: "Flat amount",
  percent_of_basic: "% of basic",
  days_of_basic: "Days of basic",
  manual: "Manual",
};

function describeFormula(s: BonusScheme): string {
  if (s.formulaValue === null) return "HR enters per employee";
  switch (s.formulaType) {
    case "flat_amount":
      return formatLKR(s.formulaValue);
    case "percent_of_basic":
      return `${(s.formulaValue / 100).toFixed(2)}% of basic`;
    case "days_of_basic":
      return `${s.formulaValue} days of basic`;
    default:
      return "—";
  }
}

const EMPLOYMENT_TYPES = ["permanent", "contract", "probation", "consultant", "intern"] as const;
const STATUSES = [
  "active",
  "confirmed",
  "on_probation",
  "on_leave",
  "resigned",
  "terminated",
] as const;

export function BonusSchemesClient({ initial }: { initial: BonusScheme[] }) {
  const router = useRouter();
  const [schemes, setSchemes] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    formulaType: "days_of_basic" as BonusFormulaType,
    formulaValue: "15",
    minTenureDays: "0",
    employmentTypes: ["permanent"] as string[],
    statuses: ["active", "confirmed", "on_probation"] as string[],
    countsForEpf: false,
    countsForEtf: false,
    countsForPaye: true,
  });

  function resetForm() {
    setForm({
      code: "",
      name: "",
      description: "",
      formulaType: "days_of_basic",
      formulaValue: "15",
      minTenureDays: "0",
      employmentTypes: ["permanent"],
      statuses: ["active", "confirmed", "on_probation"],
      countsForEpf: false,
      countsForEtf: false,
      countsForPaye: true,
    });
  }

  async function toggleActive(s: BonusScheme) {
    setError(null);
    try {
      const res = await api.updateBonusScheme(s.id, { isActive: !s.isActive });
      setSchemes((prev) => prev.map((x) => (x.id === s.id ? res.scheme : x)));
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
    let formulaValue: number | null = null;
    if (form.formulaType === "manual") {
      formulaValue = null;
    } else if (form.formulaType === "flat_amount") {
      const v = Number(form.formulaValue || "0");
      if (!(v > 0)) {
        setError("Flat amount must be > 0.");
        return;
      }
      formulaValue = Math.round(v * 100); // LKR → cents
    } else if (form.formulaType === "percent_of_basic") {
      const v = Number(form.formulaValue || "0");
      if (!(v > 0)) {
        setError("Percentage must be > 0.");
        return;
      }
      formulaValue = Math.round(v * 100); // % → bps
    } else if (form.formulaType === "days_of_basic") {
      const v = Number(form.formulaValue || "0");
      if (!(v > 0)) {
        setError("Days must be > 0.");
        return;
      }
      formulaValue = Math.round(v);
    }

    setBusy(true);
    try {
      const res = await api.createBonusScheme({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        formulaType: form.formulaType,
        formulaValue,
        eligibilityMinTenureDays: Number(form.minTenureDays) || 0,
        eligibilityEmploymentTypes: form.employmentTypes,
        eligibilityStatuses: form.statuses,
        countsForEpf: form.countsForEpf,
        countsForEtf: form.countsForEtf,
        countsForPaye: form.countsForPaye,
      });
      setSchemes((prev) =>
        [...prev, res.scheme].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setShowForm(false);
      resetForm();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  function toggleInList(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Bonus schemes"
        description="Library of bonus programs — Avurudu, Christmas, 13th-month, performance. Scheme defines the formula, eligibility, and tax treatment; runs apply a scheme to eligible employees."
        action={
          <button type="button" onClick={() => setShowForm((s) => !s)} className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            {showForm ? "Close" : "New scheme"}
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
                placeholder="VESAK, PERF_Q1"
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
                placeholder="Vesak bonus"
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
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Formula</label>
              <select
                value={form.formulaType}
                onChange={(e) =>
                  setForm({ ...form, formulaType: e.target.value as BonusFormulaType })
                }
                className="input mt-1.5"
              >
                <option value="flat_amount">Flat amount (LKR)</option>
                <option value="percent_of_basic">% of basic</option>
                <option value="days_of_basic">Days of basic</option>
                <option value="manual">Manual (HR enters per employee)</option>
              </select>
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                {form.formulaType === "flat_amount" && "Flat amount (LKR)"}
                {form.formulaType === "percent_of_basic" && "Percent (e.g. 50 = 50%)"}
                {form.formulaType === "days_of_basic" && "Days (e.g. 15 = half-month)"}
                {form.formulaType === "manual" && "Not used (manual)"}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.formulaValue}
                onChange={(e) => setForm({ ...form, formulaValue: e.target.value })}
                disabled={form.formulaType === "manual"}
                className="input mt-1.5 text-right tabular-nums disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Minimum tenure (days, 0 = no minimum)
              </label>
              <input
                type="number"
                min="0"
                value={form.minTenureDays}
                onChange={(e) => setForm({ ...form, minTenureDays: e.target.value })}
                className="input mt-1.5 text-right tabular-nums"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Employment types
              </label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {EMPLOYMENT_TYPES.map((t) => {
                  const on = form.employmentTypes.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        setForm({ ...form, employmentTypes: toggleInList(form.employmentTypes, t) })
                      }
                      className={`rounded-full px-2.5 py-0.5 text-caption font-medium transition ${
                        on
                          ? "bg-mint-surface text-mint-dark"
                          : "bg-surface-recessed text-text-secondary"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Employee statuses
              </label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {STATUSES.map((s) => {
                  const on = form.statuses.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        setForm({ ...form, statuses: toggleInList(form.statuses, s) })
                      }
                      className={`rounded-full px-2.5 py-0.5 text-caption font-medium transition ${
                        on
                          ? "bg-mint-surface text-mint-dark"
                          : "bg-surface-recessed text-text-secondary"
                      }`}
                    >
                      {s.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-small text-charcoal">
              <input
                type="checkbox"
                checked={form.countsForEpf}
                onChange={(e) => setForm({ ...form, countsForEpf: e.target.checked })}
                className="h-4 w-4 rounded border-border-emphasis"
              />
              Counts for EPF{" "}
              <span className="text-caption text-text-tertiary">(uncommon in SL)</span>
            </label>
            <label className="flex items-center gap-2 text-small text-charcoal">
              <input
                type="checkbox"
                checked={form.countsForEtf}
                onChange={(e) => setForm({ ...form, countsForEtf: e.target.checked })}
                className="h-4 w-4 rounded border-border-emphasis"
              />
              Counts for ETF
            </label>
            <label className="flex items-center gap-2 text-small text-charcoal">
              <input
                type="checkbox"
                checked={form.countsForPaye}
                onChange={(e) => setForm({ ...form, countsForPaye: e.target.checked })}
                className="h-4 w-4 rounded border-border-emphasis"
              />
              Counts for PAYE
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

      {schemes.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <Gift className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No bonus schemes yet.</p>
          <p className="mt-1 text-small text-text-secondary">
            Four SL-typical schemes (Avurudu, Christmas, 13th-month, performance) are seeded at tenant signup. If you don't see them, create a new one above.
          </p>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="w-36 px-4 py-3 text-left">Formula</th>
                <th className="w-40 px-4 py-3 text-left">Value</th>
                <th className="w-24 px-4 py-3 text-right">Min tenure</th>
                <th className="w-36 px-4 py-3 text-center">Statutory</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {schemes.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 tabular-nums font-medium text-charcoal">{s.code}</td>
                  <td className="px-4 py-3 text-text-primary">
                    {s.name}
                    {s.isSystem && <span className="ml-2 text-caption text-text-tertiary">System</span>}
                    {s.description && (
                      <p className="text-caption text-text-tertiary">{s.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {FORMULA_LABELS[s.formulaType]}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{describeFormula(s)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {s.eligibilityMinTenureDays > 0 ? `${s.eligibilityMinTenureDays} d` : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-1 text-caption">
                      {s.countsForEpf && (
                        <span className="rounded-full bg-warning-bg/60 px-1.5 py-0.5 text-warning">EPF</span>
                      )}
                      {s.countsForEtf && (
                        <span className="rounded-full bg-warning-bg/60 px-1.5 py-0.5 text-warning">ETF</span>
                      )}
                      {s.countsForPaye && (
                        <span className="rounded-full bg-surface-recessed px-1.5 py-0.5 text-text-secondary">PAYE</span>
                      )}
                      {!s.countsForEpf && !s.countsForEtf && !s.countsForPaye && (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => toggleActive(s)}
                      className={`rounded-full px-2.5 py-0.5 text-caption font-medium transition ${
                        s.isActive
                          ? "bg-mint-surface text-mint-dark hover:bg-mint"
                          : "bg-surface-recessed text-text-secondary hover:bg-warning-bg"
                      }`}
                    >
                      {s.isActive ? "Active" : "Inactive"}
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
