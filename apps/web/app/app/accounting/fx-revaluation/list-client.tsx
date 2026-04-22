"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { api, ApiError, type FxRevaluation } from "@/lib/api";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function endOfLastMonth(): string {
  const d = new Date();
  const firstOfThisMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  firstOfThisMonth.setDate(firstOfThisMonth.getDate() - 1);
  const y = firstOfThisMonth.getFullYear();
  const m = String(firstOfThisMonth.getMonth() + 1).padStart(2, "0");
  const day = String(firstOfThisMonth.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatLkr(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${(abs / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_BADGE: Record<FxRevaluation["status"], string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  posted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  voided: "bg-gray-50 text-text-tertiary border-border",
};

export function FxRevaluationListClient({ initial }: { initial: FxRevaluation[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [asOfDate, setAsOfDate] = useState<string>(endOfLastMonth());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      setError("Enter a valid date.");
      return;
    }
    if (asOfDate > today()) {
      setError("As-of date can't be in the future.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createFxRevaluation({
        asOfDate,
        notes: notes.trim() || undefined,
      });
      setRows([res.revaluation, ...rows]);
      setNotes("");
      router.push(`/app/accounting/fx-revaluation/${res.revaluation.id}`);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Couldn't create run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 space-y-6">
      <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <h2 className="text-body font-medium text-charcoal">New revaluation run</h2>
        <p className="mt-1 text-caption text-text-secondary">
          Pick the closing date (usually month-end). The run is created as a <span className="font-medium">draft</span> so
          you can review the numbers before posting to the ledger.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-6">
          <label className="text-small sm:col-span-2">
            <span className="mb-1 block text-caption text-text-secondary">As of</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="w-full rounded-md border-hairline border-border bg-white px-3 py-2 text-body"
            />
          </label>
          <label className="text-small sm:col-span-4">
            <span className="mb-1 block text-caption text-text-secondary">Note (optional)</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Month-end FX revaluation, Mar-2026"
              className="w-full rounded-md border-hairline border-border bg-white px-3 py-2 text-body"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="btn-primary disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Create draft
          </button>
          {error ? <span className="text-caption text-red-600">{error}</span> : null}
        </div>
      </div>

      <div className="rounded-card border-hairline border-border bg-surface-elevated">
        <div className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
          <h2 className="text-body font-medium text-charcoal">Recent runs</h2>
          <span className="text-caption text-text-tertiary">
            {rows.length} run{rows.length === 1 ? "" : "s"}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="px-6 py-8 text-body text-text-secondary">
            No runs yet. Create your first revaluation above.
          </p>
        ) : (
          <table className="w-full text-small">
            <thead>
              <tr className="border-b-hairline border-border text-caption text-text-tertiary">
                <th className="px-6 py-3 text-left font-medium">As of</th>
                <th className="px-6 py-3 text-left font-medium">Status</th>
                <th className="px-6 py-3 text-right font-medium">AR delta (LKR)</th>
                <th className="px-6 py-3 text-right font-medium">AP delta (LKR)</th>
                <th className="px-6 py-3 text-left font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const arDelta = r.arGainCents - r.arLossCents;
                const apDelta = r.apGainCents - r.apLossCents;
                return (
                  <tr key={r.id} className="border-b-hairline border-border last:border-b-0 hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <Link
                        href={`/app/accounting/fx-revaluation/${r.id}`}
                        className="font-medium text-charcoal hover:underline"
                      >
                        {r.asOfDate}
                      </Link>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-caption font-medium uppercase tracking-wide ${STATUS_BADGE[r.status]}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right text-charcoal tabular-nums">
                      {formatLkr(arDelta)}
                    </td>
                    <td className="px-6 py-3 text-right text-charcoal tabular-nums">
                      {formatLkr(-apDelta /* display: positive = liability increased */)}
                    </td>
                    <td className="px-6 py-3 text-text-secondary">{r.notes ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
