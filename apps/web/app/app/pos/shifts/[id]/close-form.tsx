"use client";

// Close-shift form: denomination breakdown, counted cash, variance reason.
//
// Denomination inputs are the big win here — cashiers count physical notes,
// not rupees. We sum them up client-side to produce closing_cash_cents so
// the server just validates against expected.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { api, type PosVarianceReasonCode } from "@/lib/api";
import { formatLKR } from "@/lib/format";

// LKR note + coin denominations. 'coinsCents' catches the fiddly bits that
// don't match a standard denomination (sometimes cashiers bundle everything
// under 20 into a "coins" pile).
const NOTE_DENOMINATIONS: Array<{ key: string; rupees: number; label: string }> = [
  { key: "5000", rupees: 5000, label: "5,000" },
  { key: "1000", rupees: 1000, label: "1,000" },
  { key: "500", rupees: 500, label: "500" },
  { key: "100", rupees: 100, label: "100" },
  { key: "50", rupees: 50, label: "50" },
  { key: "20", rupees: 20, label: "20" },
];

const VARIANCE_REASONS: Array<{ code: PosVarianceReasonCode; label: string }> = [
  { code: "change_error", label: "Change given incorrectly" },
  { code: "miscount", label: "Miscount" },
  { code: "theft_suspicion", label: "Theft suspected" },
  { code: "other", label: "Other" },
];

export function CloseShiftForm({
  shiftId,
  expectedCashCents,
}: {
  shiftId: string;
  expectedCashCents: number;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [coinsCents, setCoinsCents] = useState("");
  const [reason, setReason] = useState<PosVarianceReasonCode | "">("");
  const [notes, setNotes] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countedCents = useMemo(() => {
    let cents = 0;
    for (const d of NOTE_DENOMINATIONS) {
      const n = Number(counts[d.key] || 0);
      cents += Math.max(0, Math.floor(n)) * d.rupees * 100;
    }
    cents += Math.max(0, Math.floor(Number(coinsCents || 0) * 100));
    return cents;
  }, [counts, coinsCents]);

  const varianceCents = countedCents - expectedCashCents;
  const needsReason = Math.abs(varianceCents) >= 100;

  const submit = async () => {
    if (needsReason && !reason) {
      setError("Pick a variance reason — over/short by more than LKR 1 needs one.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const closingDenominations: Record<string, number> = {};
      for (const d of NOTE_DENOMINATIONS) {
        const n = Math.max(0, Math.floor(Number(counts[d.key] || 0)));
        if (n > 0) closingDenominations[d.key] = n;
      }
      const coins = Math.max(0, Math.floor(Number(coinsCents || 0) * 100));
      if (coins > 0) closingDenominations.coins_cents = coins;

      await api.closePosShift(shiftId, {
        closingCashCents: countedCents,
        closingDenominations,
        varianceReasonCode: reason || undefined,
        varianceReasonNotes: notes || undefined,
        supervisorSignature: supervisor || undefined,
      });
      router.refresh();
      router.push(`/app/pos/shifts/${shiftId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close shift");
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
      <h2 className="text-h3 text-charcoal">Close shift · count the till</h2>
      <p className="mt-1 text-small text-text-secondary">
        Enter how many of each note is physically in the drawer. We'll compute
        the total and compare to expected.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {NOTE_DENOMINATIONS.map((d) => (
          <div key={d.key}>
            <label className="text-caption text-text-tertiary">LKR {d.label}</label>
            <input
              type="number"
              min="0"
              step="1"
              value={counts[d.key] ?? ""}
              onChange={(e) =>
                setCounts((prev) => ({ ...prev, [d.key]: e.target.value }))
              }
              placeholder="0"
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-base focus:border-primary focus:outline-none"
            />
          </div>
        ))}
        <div className="col-span-2">
          <label className="text-caption text-text-tertiary">
            Coins / loose (LKR)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={coinsCents}
            onChange={(e) => setCoinsCents(e.target.value)}
            placeholder="0.00"
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-base focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded bg-surface-recessed p-3">
          <p className="text-caption text-text-tertiary">Expected</p>
          <p className="text-base font-semibold text-charcoal">
            {formatLKR(expectedCashCents)}
          </p>
        </div>
        <div className="rounded bg-surface-recessed p-3">
          <p className="text-caption text-text-tertiary">Counted</p>
          <p className="text-base font-semibold text-charcoal">
            {formatLKR(countedCents)}
          </p>
        </div>
        <div
          className={`rounded p-3 ${
            varianceCents === 0
              ? "bg-mint-surface"
              : varianceCents < 0
              ? "bg-danger-bg/50"
              : "bg-warning-bg/60"
          }`}
        >
          <p className="text-caption text-text-tertiary">Variance</p>
          <p
            className={`text-base font-semibold ${
              varianceCents === 0
                ? "text-mint-dark"
                : varianceCents < 0
                ? "text-destructive-foreground"
                : "text-warning"
            }`}
          >
            {varianceCents > 0 ? "+" : ""}
            {formatLKR(varianceCents)}
          </p>
        </div>
      </div>

      {needsReason && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-caption text-text-tertiary">
              Variance reason
            </label>
            <select
              value={reason}
              onChange={(e) =>
                setReason(e.target.value as PosVarianceReasonCode | "")
              }
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-base focus:border-primary focus:outline-none"
            >
              <option value="">— pick a reason —</option>
              {VARIANCE_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-caption text-text-tertiary">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-base focus:border-primary focus:outline-none"
              placeholder="What happened? (optional)"
            />
          </div>
          <div>
            <label className="text-caption text-text-tertiary">
              Supervisor sign-off (optional)
            </label>
            <input
              value={supervisor}
              onChange={(e) => setSupervisor(e.target.value)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-base focus:border-primary focus:outline-none"
              placeholder="Supervisor name"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-small text-destructive-foreground">{error}</p>
      )}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="btn-primary"
        >
          {submitting ? "Closing…" : "Close shift and post variance"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/app/pos/shifts/${shiftId}`)}
          className="btn-link"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
