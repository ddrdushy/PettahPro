"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Loader2, Lock, Unlock } from "lucide-react";
import { api, ApiError, type CustomerCredit } from "@/lib/api";
import { formatLKR, formatDate } from "@/lib/format";

export function CreditPanel({
  customerId,
  credit,
}: {
  customerId: string;
  credit: CustomerCredit;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holdDialog, setHoldDialog] = useState(false);
  const [reason, setReason] = useState("");

  async function placeHold() {
    setError(null);
    if (!reason.trim()) return setError("Reason required.");
    setBusy(true);
    try {
      await api.holdCustomer(customerId, reason.trim());
      setHoldDialog(false);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't place hold.");
    } finally {
      setBusy(false);
    }
  }

  async function clearHold() {
    setError(null);
    setBusy(true);
    try {
      await api.unholdCustomer(customerId);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't clear hold.");
    } finally {
      setBusy(false);
    }
  }

  const utilColor =
    credit.utilizationPct == null
      ? "bg-surface-recessed"
      : credit.utilizationPct >= 100
        ? "bg-danger"
        : credit.utilizationPct >= 80
          ? "bg-amber-500"
          : "bg-mint";

  return (
    <section className="rounded-card border-hairline border-border bg-surface-elevated p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-body font-medium text-charcoal">Credit</h2>
        {credit.creditHold ? (
          <span className="inline-flex items-center gap-1 rounded-full border-hairline border-danger/40 bg-danger-bg/60 px-2 py-0.5 text-caption font-medium text-danger">
            <Lock className="h-3 w-3" aria-hidden />
            On hold
          </span>
        ) : credit.bounceCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border-hairline border-amber-200 bg-amber-50 px-2 py-0.5 text-caption font-medium text-amber-800">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {credit.bounceCount} {credit.bounceCount === 1 ? "bounce" : "bounces"}
          </span>
        ) : null}
      </div>

      {credit.creditHold && credit.creditHoldReason && (
        <p className="mt-2 text-caption italic text-text-tertiary">&quot;{credit.creditHoldReason}&quot;</p>
      )}
      {credit.creditHold && credit.creditHoldAt && (
        <p className="mt-1 text-caption text-text-tertiary">Since {formatDate(credit.creditHoldAt.slice(0, 10))}</p>
      )}

      <dl className="mt-4 space-y-3 text-small">
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Open AR</dt>
          <dd className="tabular-nums text-charcoal">{formatLKR(credit.openArCents)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Credit limit</dt>
          <dd className="tabular-nums text-charcoal">
            {credit.creditLimitCents > 0 ? formatLKR(credit.creditLimitCents) : "Not set"}
          </dd>
        </div>
        {credit.creditLimitCents > 0 && (
          <>
            <div className="flex items-center justify-between">
              <dt className="text-text-secondary">Available</dt>
              <dd className="tabular-nums text-charcoal">{formatLKR(credit.availableCents ?? 0)}</dd>
            </div>
            <div>
              <div className="flex items-center justify-between text-caption text-text-tertiary">
                <span>Utilisation</span>
                <span className="tabular-nums">{credit.utilizationPct ?? 0}%</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-recessed">
                <div
                  className={`h-full ${utilColor}`}
                  style={{ width: `${Math.min(100, credit.utilizationPct ?? 0)}%` }}
                />
              </div>
            </div>
          </>
        )}
      </dl>

      {error && (
        <p className="mt-3 text-caption text-danger">{error}</p>
      )}

      <div className="mt-4 flex items-center gap-2">
        {credit.creditHold ? (
          <button
            type="button"
            onClick={clearHold}
            disabled={busy}
            className="btn-secondary inline-flex items-center gap-1 text-caption disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlock className="h-3 w-3" />}
            Clear hold
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setHoldDialog(true)}
            className="btn-ghost inline-flex items-center gap-1 text-caption"
          >
            <Lock className="h-3 w-3" />
            Place on hold
          </button>
        )}
      </div>

      {holdDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4">
          <div className="w-full max-w-md rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-lg">
            <h3 className="text-body font-medium text-charcoal">Place on credit hold</h3>
            <p className="mt-1 text-caption text-text-secondary">
              Blocks invoice posting for this customer until you clear the hold. Auto-flags (like &quot;2+ bounced cheques&quot;) use this same mechanism.
            </p>
            <label className="mt-4 block text-caption uppercase tracking-wide text-text-tertiary">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Pending receivables review; refuses to pay overdue"
              className="input mt-1.5 w-full"
            />
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => { setHoldDialog(false); setReason(""); }} disabled={busy} className="btn-ghost text-small">Cancel</button>
              <button
                type="button"
                onClick={placeHold}
                disabled={busy || !reason.trim()}
                className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Place on hold
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
