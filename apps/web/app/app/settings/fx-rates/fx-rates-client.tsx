"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { api, ApiError, type FxRate } from "@/lib/api";

const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "AUD", "INR", "SGD", "AED"];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function FxRatesClient({ initial }: { initial: FxRate[] }) {
  const router = useRouter();
  const [rates, setRates] = useState(initial);
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("LKR");
  const [rate, setRate] = useState("");
  const [rateDate, setRateDate] = useState(today());
  const [source, setSource] = useState("manual");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const r = Number(rate);
    if (!Number.isFinite(r) || r <= 0) {
      setError("Enter a positive rate.");
      return;
    }
    if (from.toUpperCase() === to.toUpperCase()) {
      setError("From and to currency must differ.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createFxRate({
        fromCurrency: from.toUpperCase(),
        toCurrency: to.toUpperCase(),
        rateDate,
        rate: r,
        source: source.trim() || "manual",
        note: note.trim() || undefined,
      });
      setRates([res.rate, ...rates]);
      setRate("");
      setNote("");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Couldn't save rate.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await api.deleteFxRate(id);
      setRates(rates.filter((r) => r.id !== id));
      router.refresh();
    } catch {
      setError("Couldn't delete rate.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="mt-6 space-y-6">
      <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <h2 className="text-body font-medium text-charcoal">Add a rate</h2>
        <p className="mt-1 text-caption text-text-secondary">
          A rate of <code>320</code> for <code>USD → LKR</code> means 1 USD = 320 LKR. Each (from, to, date) combination can only be saved once — come back tomorrow for the next day's rate.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-6">
          <label className="text-small">
            <span className="mb-1 block text-caption text-text-secondary">From</span>
            <input
              list="fx-currencies"
              value={from}
              onChange={(e) => setFrom(e.target.value.toUpperCase().slice(0, 3))}
              className="w-full rounded-md border-hairline border-border bg-white px-3 py-2 text-body uppercase"
              maxLength={3}
            />
          </label>
          <label className="text-small">
            <span className="mb-1 block text-caption text-text-secondary">To</span>
            <input
              list="fx-currencies"
              value={to}
              onChange={(e) => setTo(e.target.value.toUpperCase().slice(0, 3))}
              className="w-full rounded-md border-hairline border-border bg-white px-3 py-2 text-body uppercase"
              maxLength={3}
            />
          </label>
          <label className="text-small">
            <span className="mb-1 block text-caption text-text-secondary">Date</span>
            <input
              type="date"
              value={rateDate}
              onChange={(e) => setRateDate(e.target.value)}
              className="w-full rounded-md border-hairline border-border bg-white px-3 py-2 text-body"
            />
          </label>
          <label className="text-small">
            <span className="mb-1 block text-caption text-text-secondary">Rate</span>
            <input
              type="number"
              step="0.000001"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="320.00"
              className="w-full rounded-md border-hairline border-border bg-white px-3 py-2 text-body"
            />
          </label>
          <label className="text-small">
            <span className="mb-1 block text-caption text-text-secondary">Source</span>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="manual / CBSL / bank"
              className="w-full rounded-md border-hairline border-border bg-white px-3 py-2 text-body"
            />
          </label>
          <label className="text-small sm:col-span-6">
            <span className="mb-1 block text-caption text-text-secondary">Note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="CBSL indicative middle rate"
              className="w-full rounded-md border-hairline border-border bg-white px-3 py-2 text-body"
            />
          </label>
          <datalist id="fx-currencies">
            <option value="LKR" />
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="btn-primary disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save rate
          </button>
          {error ? <span className="text-caption text-red-600">{error}</span> : null}
        </div>
      </div>

      <div className="rounded-card border-hairline border-border bg-surface-elevated">
        <div className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
          <h2 className="text-body font-medium text-charcoal">Recent rates</h2>
          <span className="text-caption text-text-tertiary">{rates.length} row{rates.length === 1 ? "" : "s"}</span>
        </div>
        {rates.length === 0 ? (
          <p className="px-6 py-8 text-body text-text-secondary">No rates yet. Add one above.</p>
        ) : (
          <table className="w-full text-small">
            <thead>
              <tr className="border-b-hairline border-border text-caption text-text-tertiary">
                <th className="px-6 py-3 text-left font-medium">Date</th>
                <th className="px-6 py-3 text-left font-medium">Pair</th>
                <th className="px-6 py-3 text-right font-medium">Rate</th>
                <th className="px-6 py-3 text-left font-medium">Source</th>
                <th className="px-6 py-3 text-left font-medium">Note</th>
                <th className="px-6 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-b-hairline border-border last:border-b-0">
                  <td className="px-6 py-3 text-charcoal">{r.rateDate}</td>
                  <td className="px-6 py-3 text-charcoal">
                    <span className="font-medium">{r.fromCurrency}</span>
                    <span className="mx-1 text-text-tertiary">→</span>
                    <span className="font-medium">{r.toCurrency}</span>
                  </td>
                  <td className="px-6 py-3 text-right text-charcoal tabular-nums">{Number(r.rate).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</td>
                  <td className="px-6 py-3 text-text-secondary">{r.source}</td>
                  <td className="px-6 py-3 text-text-secondary">{r.note ?? ""}</td>
                  <td className="px-6 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      disabled={deletingId === r.id}
                      aria-label={`Delete rate for ${r.fromCurrency}→${r.toCurrency} on ${r.rateDate}`}
                      className="text-text-tertiary hover:text-red-600 disabled:opacity-50"
                    >
                      {deletingId === r.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
