"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, AlertTriangle, Loader2 } from "lucide-react";
import { Drawer } from "@/components/app/drawer";
import { Field } from "@/components/auth/field";
import { api, ApiError } from "@/lib/api";
import { formatLKR } from "@/lib/format";

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
