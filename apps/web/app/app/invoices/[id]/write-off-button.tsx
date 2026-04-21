"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileX, Loader2, RotateCcw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatLKR } from "@/lib/format";

// Age threshold for the "12 months" VAT bad-debt relief prompt. Not a
// hard gate — we let the user claim relief at any age, we just preselect
// the checkbox when the invoice has aged past this threshold.
const VAT_RELIEF_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function WriteOffButton(props: {
  invoiceId: string;
  invoiceNumber: string;
  issueDate: string;
  balanceDueCents: number;
  taxCents: number;
  totalCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [claimVatRelief, setClaimVatRelief] = useState(() => {
    const age = Date.now() - new Date(props.issueDate).getTime();
    return age >= VAT_RELIEF_AGE_MS && props.taxCents > 0;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview the proration: VAT portion of the balance being written off.
  const vatPreview =
    claimVatRelief && props.taxCents > 0 && props.totalCents > 0
      ? Math.min(props.taxCents, Math.round((props.taxCents * props.balanceDueCents) / props.totalCents))
      : 0;
  const principalPreview = props.balanceDueCents - vatPreview;

  async function submit() {
    setError(null);
    if (!reason.trim()) return setError("Reason is required.");
    setBusy(true);
    try {
      await api.writeOffInvoice(props.invoiceId, { reason: reason.trim(), claimVatRelief });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't write off invoice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary inline-flex items-center gap-2"
      >
        <FileX className="h-4 w-4" aria-hidden />
        Write off
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4">
          <div className="w-full max-w-lg rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-lg">
            <h2 className="text-body font-medium text-charcoal">Write off invoice {props.invoiceNumber}</h2>
            <p className="mt-1 text-caption text-text-secondary">
              Posts <span className="tabular-nums">DR Bad debt expense · CR Accounts receivable</span> for the {formatLKR(props.balanceDueCents)} balance. Invoice status goes to "Written off". If the customer pays later, you can reverse this from the invoice page.
            </p>

            <label className="mt-4 block text-caption uppercase tracking-wide text-text-tertiary">Reason (audit trail)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Customer ceased operations; 12+ months overdue after multiple demands"
              className="input mt-1.5 w-full"
            />

            {props.taxCents > 0 && (
              <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-md border-hairline border-border bg-surface-recessed/40 p-3">
                <input
                  type="checkbox"
                  checked={claimVatRelief}
                  onChange={(e) => setClaimVatRelief(e.target.checked)}
                  className="mt-0.5"
                />
                <div className="text-small text-charcoal">
                  <p className="font-medium">Claim VAT bad-debt relief</p>
                  <p className="mt-0.5 text-caption text-text-secondary">
                    SL VAT Act §26 lets you reclaim VAT on invoices uncollected for 12+ months. We'll post an extra leg <span className="tabular-nums">DR VAT payable · CR AR</span> for the VAT portion of the balance.
                  </p>
                </div>
              </label>
            )}

            {(props.balanceDueCents > 0) && (
              <dl className="mt-4 space-y-1 rounded-md bg-surface-recessed/60 p-3 text-small">
                <Row label="Bad debt expense" value={formatLKR(principalPreview)} />
                {claimVatRelief && vatPreview > 0 && (
                  <Row label="VAT relief reclaimed" value={formatLKR(vatPreview)} sub />
                )}
                <div className="my-1 h-px bg-border" />
                <Row label="AR cleared" value={formatLKR(props.balanceDueCents)} emphasis />
              </dl>
            )}

            {error && <p className="mt-3 text-caption text-danger">{error}</p>}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn-ghost text-small">Cancel</button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || !reason.trim()}
                className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Post write-off
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ReverseWriteOffButton({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!confirm(`Reverse write-off on invoice ${invoiceNumber}? This restores the AR balance and reopens the invoice.`)) return;
    setError(null);
    setBusy(true);
    try {
      await api.reverseWriteOff(invoiceId);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reverse.");
      alert(err instanceof ApiError ? err.message : "Couldn't reverse.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
      title={error ?? undefined}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
      Reverse write-off
    </button>
  );
}

function Row({ label, value, emphasis, sub }: { label: string; value: string; emphasis?: boolean; sub?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={`${sub ? "text-caption text-text-tertiary" : "text-text-secondary"}`}>{label}</dt>
      <dd className={`tabular-nums ${emphasis ? "font-medium text-charcoal" : sub ? "text-text-tertiary" : "text-charcoal"}`}>
        {value}
      </dd>
    </div>
  );
}
