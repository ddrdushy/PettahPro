"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Drawer } from "@/components/app/drawer";
import { Field } from "@/components/auth/field";
import { api, ApiError } from "@/lib/api";
import { formatLKR } from "@/lib/format";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const REASONS: Array<{ value: string; label: string }> = [
  { value: "insufficient_funds", label: "Insufficient funds" },
  { value: "account_closed", label: "Account closed" },
  { value: "stopped_payment", label: "Stopped payment" },
  { value: "signature_mismatch", label: "Signature mismatch" },
  { value: "post_dated", label: "Post-dated" },
  { value: "stale", label: "Stale" },
  { value: "refer_to_drawer", label: "Refer to drawer" },
  { value: "other", label: "Other" },
];

export function ChequeActions({
  id,
  direction,
  chequeNumber,
  amountCents,
}: {
  id: string;
  direction: "received" | "issued";
  chequeNumber: string;
  amountCents: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "clear" | "bounce">(null);
  const [bounceOpen, setBounceOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState("insufficient_funds");

  async function handleClear() {
    if (!confirm(`Mark cheque ${chequeNumber} as cleared? This posts a reclassification journal.`)) return;
    setBusy("clear");
    setError(null);
    try {
      await api.clearCheque(id);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't clear the cheque.");
    } finally {
      setBusy(null);
    }
  }

  async function handleBounce(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("bounce");
    setError(null);
    const f = new FormData(e.currentTarget);
    const chargesLKR = Number(f.get("bankCharges") ?? 0);
    try {
      await api.bounceCheque(id, {
        reasonCode,
        reasonDetails: String(f.get("details") ?? "").trim() || undefined,
        bankChargesCents: Number.isFinite(chargesLKR) ? Math.round(chargesLKR * 100) : 0,
      });
      setBounceOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record the bounce.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClear}
        disabled={busy !== null}
        className="btn-primary"
      >
        {busy === "clear" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Clearing…
          </>
        ) : (
          <>
            <Check className="h-4 w-4" aria-hidden /> Mark cleared
          </>
        )}
      </button>

      <button
        type="button"
        onClick={() => setBounceOpen(true)}
        disabled={busy !== null}
        className="inline-flex items-center gap-2 rounded-md border-hairline border-danger/40 bg-transparent px-5 py-3 text-body font-medium text-danger transition-colors hover:bg-danger-bg/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2"
      >
        <AlertTriangle className="h-4 w-4" aria-hidden />
        Bounce
      </button>

      {error && (
        <span className="text-small text-danger" role="alert">
          {error}
        </span>
      )}

      <Drawer
        open={bounceOpen}
        onClose={() => setBounceOpen(false)}
        title={`Record bounce · ${chequeNumber}`}
        description={`Reverses the ${formatLKR(amountCents)} posting and reopens the allocated ${direction === "received" ? "invoice" : "bill"}. Bank charges (if any) post separately.`}
      >
        <form onSubmit={handleBounce} className="space-y-6" noValidate>
          <section className="space-y-4">
            <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
              Reason
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReasonCode(r.value)}
                  className={`rounded-md border-hairline px-3 py-2 text-small transition ${
                    reasonCode === r.value
                      ? "border-charcoal bg-charcoal text-offwhite"
                      : "border-border bg-surface-elevated text-text-secondary hover:border-charcoal hover:text-charcoal"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </section>

          <Field
            label="Details"
            name="details"
            placeholder="e.g. Notice stamp reads 'refer to drawer'"
          />

          <Field
            label="Bank charges (LKR)"
            name="bankCharges"
            type="number"
            min={0}
            step="0.01"
            defaultValue={0}
            hint="What the bank deducted from your account for the bounce"
          />

          {error && (
            <div
              role="alert"
              className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
            >
              {error}
            </div>
          )}

          <p className="rounded-md bg-warning-bg/60 p-3 text-caption text-warning">
            Posting creates: reversal + bank charges journal. The linked {direction === "received" ? "invoice" : "bill"} reopens with the original balance.
          </p>

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setBounceOpen(false)} className="btn-link">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy === "bounce"}
              className="inline-flex items-center gap-2 rounded-md bg-danger px-5 py-3 text-body font-medium text-offwhite transition-colors hover:bg-danger/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2"
            >
              {busy === "bounce" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Recording…
                </>
              ) : (
                "Record bounce"
              )}
            </button>
          </div>
        </form>
      </Drawer>
    </>
  );
}

/**
 * Shown only for issued-direction stale cheques. Lets AP cut a fresh cheque
 * to the same supplier for the same amount without touching the original JE —
 * the old row flips to status='replaced' with replaced_by_cheque_id pointing
 * at the new one, preserving the audit chain.
 */
export function ChequeReissueAction({
  id,
  chequeNumber,
  amountCents,
}: {
  id: string;
  chequeNumber: string;
  amountCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newChequeNumber, setNewChequeNumber] = useState("");
  const [newChequeDate, setNewChequeDate] = useState(todayISO());
  const [memo, setMemo] = useState("");

  async function handleReissue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!newChequeNumber.trim()) {
      setError("Enter the new cheque number.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newChequeDate)) {
      setError("Enter a valid date.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.reissueCheque(id, {
        newChequeNumber: newChequeNumber.trim(),
        newChequeDate,
        memo: memo.trim() || undefined,
      });
      setOpen(false);
      router.push(`/app/cheques/${res.newChequeId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reissue the cheque.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        Reissue cheque
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={`Reissue cheque ${chequeNumber}`}
        description={`Creates a new cheque for ${formatLKR(amountCents)} to the same supplier. The original flips to 'Replaced' and links to the new one. No journal entries are posted — your AP balance already reflects the obligation.`}
      >
        <form onSubmit={handleReissue} className="space-y-6" noValidate>
          <Field
            label="New cheque number"
            name="newChequeNumber"
            value={newChequeNumber}
            onChange={(e) => setNewChequeNumber(e.currentTarget.value)}
            placeholder="e.g. 004512"
            required
          />

          <Field
            label="New cheque date"
            name="newChequeDate"
            type="date"
            value={newChequeDate}
            onChange={(e) => setNewChequeDate(e.currentTarget.value)}
            hint="Cheque becomes stale 6 months after this date."
            required
          />

          <Field
            label="Memo (optional)"
            name="memo"
            value={memo}
            onChange={(e) => setMemo(e.currentTarget.value)}
            placeholder={`Reissue of stale cheque ${chequeNumber}`}
          />

          {error && (
            <div
              role="alert"
              className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="btn-link">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reissuing…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" aria-hidden /> Reissue
                </>
              )}
            </button>
          </div>
        </form>
      </Drawer>
    </>
  );
}
