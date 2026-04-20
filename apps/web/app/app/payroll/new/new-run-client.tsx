"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Field } from "@/components/auth/field";
import { api, ApiError } from "@/lib/api";

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

export function NewPayrollRunClient() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;
  // Default pay date = last day of that month
  const defaultPayDate = new Date(Date.UTC(defaultYear, defaultMonth, 0))
    .toISOString()
    .slice(0, 10);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);

    try {
      const { runId } = await api.createPayrollRun({
        periodYear: Number(f.get("periodYear")),
        periodMonth: Number(f.get("periodMonth")),
        payDate: String(f.get("payDate") ?? "") || undefined,
        notes: String(f.get("notes") ?? "").trim() || undefined,
      });
      router.push(`/app/payroll/${runId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 rounded-card border-hairline border-border bg-surface-elevated p-6" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="periodMonth" className="block text-small font-medium text-charcoal">
            Period month
          </label>
          <select
            id="periodMonth"
            name="periodMonth"
            defaultValue={defaultMonth}
            className="mt-1.5 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
          >
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="Year"
          name="periodYear"
          type="number"
          min={2020}
          max={2099}
          defaultValue={defaultYear}
          required
        />
      </div>

      <Field
        label="Pay date"
        name="payDate"
        type="date"
        defaultValue={defaultPayDate}
        hint="When employees actually get paid — drives the GL entry date"
      />

      <div>
        <label htmlFor="notes" className="block text-small font-medium text-charcoal">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          placeholder="Optional — e.g. includes Avurudu bonus"
          className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
        />
      </div>

      {error && (
        <div role="alert" className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger">
          {error}
        </div>
      )}

      <p className="rounded-md bg-mint-surface/60 p-3 text-caption text-mint-dark">
        A draft run snapshots every active employee's basic salary and
        computes EPF, ETF, and PAYE per line. Review before posting to
        the ledger.
      </p>

      <div className="flex items-center justify-end gap-3">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Computing…
            </>
          ) : (
            "Create draft"
          )}
        </button>
      </div>
    </form>
  );
}
