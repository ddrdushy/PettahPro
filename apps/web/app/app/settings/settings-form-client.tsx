"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { api, ApiError, type TenantSettings } from "@/lib/api";

export function SettingsFormClient({
  initial,
  defaults,
}: {
  initial: TenantSettings;
  defaults: TenantSettings;
}) {
  const router = useRouter();
  const [salaryDaysPerMonth, setSalaryDaysPerMonth] = useState<number>(initial.salaryDaysPerMonth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = salaryDaysPerMonth !== initial.salaryDaysPerMonth;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (salaryDaysPerMonth < 20 || salaryDaysPerMonth > 31) {
      setError("Salary days per month must be between 20 and 31.");
      return;
    }
    setBusy(true);
    try {
      await api.updateSettings({ salaryDaysPerMonth });
      setSavedAt(new Date());
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save settings. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-8">
      <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <h2 className="text-body font-medium text-charcoal">Payroll</h2>
        <p className="mt-1 text-caption text-text-secondary">
          How no-pay leave and other pro-rated deductions are calculated against a full month of salary.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="salaryDays" className="block text-caption uppercase tracking-wide text-text-tertiary">
              Salary days per month
            </label>
            <input
              id="salaryDays"
              type="number"
              min={20}
              max={31}
              step={1}
              value={salaryDaysPerMonth}
              onChange={(e) => setSalaryDaysPerMonth(Number(e.target.value))}
              className="input mt-1.5 w-32"
            />
            <p className="mt-1.5 text-caption text-text-tertiary">
              Default {defaults.salaryDaysPerMonth}. Sri Lankan convention is 30. Set to the number of working days you pay per month if you use a different basis (e.g. 26).
            </p>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !dirty}
          className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Save settings
        </button>
        {savedAt && !dirty && !busy && (
          <span className="inline-flex items-center gap-1.5 text-caption text-mint-dark">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Saved
          </span>
        )}
        {error && <span className="text-caption text-danger">{error}</span>}
      </div>
    </form>
  );
}
