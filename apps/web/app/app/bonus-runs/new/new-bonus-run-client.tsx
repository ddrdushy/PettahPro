"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api, ApiError, type BonusScheme } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

function describeScheme(s: BonusScheme): string {
  const parts: string[] = [];
  if (s.formulaValue === null) {
    parts.push("Manual per employee");
  } else {
    switch (s.formulaType) {
      case "flat_amount":
        parts.push(`LKR ${(s.formulaValue / 100).toLocaleString()} flat`);
        break;
      case "percent_of_basic":
        parts.push(`${(s.formulaValue / 100).toFixed(2)}% of basic`);
        break;
      case "days_of_basic":
        parts.push(`${s.formulaValue} days of basic`);
        break;
    }
  }
  if (s.eligibilityMinTenureDays > 0) {
    parts.push(`min tenure ${s.eligibilityMinTenureDays}d`);
  }
  if (s.countsForPaye) parts.push("PAYE applies");
  return parts.join(" · ");
}

export function NewBonusRunClient({ schemes }: { schemes: BonusScheme[] }) {
  const router = useRouter();
  const active = schemes.filter((s) => s.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    schemeId: active[0]?.id ?? "",
    label: "",
    payDate: today,
    notes: "",
  });

  const selectedScheme = active.find((s) => s.id === form.schemeId) ?? null;

  async function submit() {
    setError(null);
    if (!form.schemeId) {
      setError("Pick a scheme.");
      return;
    }
    if (!form.label.trim()) {
      setError("Label is required (e.g. 'Avurudu 2026').");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createBonusRun({
        schemeId: form.schemeId,
        label: form.label.trim(),
        payDate: form.payDate,
        notes: form.notes.trim() || undefined,
      });
      router.push(`/app/bonus-runs/${res.runId}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "NO_ELIGIBLE_EMPLOYEES") {
          setError(
            "No employees match this scheme's eligibility. Check employment type, status, and minimum tenure filters.",
          );
        } else if (err.code === "SCHEME_INACTIVE") {
          setError("This scheme is inactive. Re-activate it first.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Couldn't create run.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="New bonus run"
        description="Applies the scheme's formula to all eligible employees, seeding per-person amounts you can review and adjust before posting."
        action={
          <Link href="/app/bonus-runs" className="btn-secondary">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Link>
        }
      />

      {active.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-charcoal">No active bonus schemes.</p>
          <p className="mt-1 text-small text-text-secondary">
            Create or re-activate a scheme first.
          </p>
          <Link href="/app/bonus-schemes" className="btn-primary mt-4 inline-flex">
            Go to schemes
          </Link>
        </div>
      ) : (
        <section className="mt-8 max-w-2xl rounded-card border-hairline border-border bg-surface-elevated p-5">
          <div className="grid gap-4">
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Scheme
              </label>
              <select
                value={form.schemeId}
                onChange={(e) => setForm({ ...form, schemeId: e.target.value })}
                className="input mt-1.5"
              >
                {active.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
              {selectedScheme && (
                <p className="mt-2 text-caption text-text-secondary">
                  {describeScheme(selectedScheme)}
                </p>
              )}
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Label
              </label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Avurudu 2026"
                maxLength={128}
                className="input mt-1.5"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Pay date
              </label>
              <input
                type="date"
                value={form.payDate}
                onChange={(e) => setForm({ ...form, payDate: e.target.value })}
                className="input mt-1.5 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Notes (optional)
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="input mt-1.5"
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              {error && <span className="text-small text-danger">{error}</span>}
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="btn-primary disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Create draft
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
