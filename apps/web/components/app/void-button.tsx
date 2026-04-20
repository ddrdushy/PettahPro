"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Ban, Loader2 } from "lucide-react";
import { Drawer } from "@/components/app/drawer";
import { Field } from "@/components/auth/field";
import { api, ApiError } from "@/lib/api";

/**
 * Shared Void drawer for posted invoices and bills. Renders a red outline
 * button; clicking opens a drawer with a reason textarea and a confirm
 * action. Uses the api client method the caller passes in so the same UI
 * works on both documents.
 */
export function VoidButton({
  kind,
  label,
  onVoid,
  disabled,
  disabledReason,
}: {
  kind: "invoice" | "bill";
  label: string; // e.g. "Invoice INV-2026-0001"
  onVoid: (reason: string) => Promise<{ reversalEntryNumber: string }>;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const reason = String(f.get("reason") ?? "").trim();
    try {
      await onVoid(reason);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't void the ${kind}.`);
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center gap-2 rounded-md border-hairline border-border bg-surface-recessed px-5 py-3 text-body font-medium text-text-tertiary"
        title={disabledReason}
      >
        <Ban className="h-4 w-4" aria-hidden />
        Void
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border-hairline border-danger/40 bg-transparent px-5 py-3 text-body font-medium text-danger transition-colors hover:bg-danger-bg/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2"
      >
        <Ban className="h-4 w-4" aria-hidden />
        Void
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={`Void ${label}`}
        description={`Posts a reversing journal and ${
          kind === "invoice" ? "returns any sold stock to inventory" : "rewinds any received stock"
        }. The original entry stays in the ledger for audit — nothing gets deleted.`}
      >
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <div className="rounded-md bg-warning-bg/60 p-3 text-caption text-warning">
            Voiding is permanent from the ledger's perspective — you can't un-void. Use a reversing entry only for genuine mistakes, not for cancellations that should be a credit note.
          </div>

          <Field
            label="Reason"
            name="reason"
            required
            minLength={3}
            placeholder="e.g. Customer rejected goods · duplicate entry · wrong amount"
          />

          {error && (
            <div
              role="alert"
              className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-link">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-danger px-5 py-3 text-body font-medium text-offwhite transition-colors hover:bg-danger/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Voiding…
                </>
              ) : (
                `Void ${kind}`
              )}
            </button>
          </div>
        </form>
      </Drawer>
    </>
  );
}

export function InvoiceVoidButton({
  invoiceId,
  label,
  disabled,
  disabledReason,
}: {
  invoiceId: string;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <VoidButton
      kind="invoice"
      label={label}
      disabled={disabled}
      disabledReason={disabledReason}
      onVoid={(reason) => api.voidInvoice(invoiceId, reason)}
    />
  );
}

export function BillVoidButton({
  billId,
  label,
  disabled,
  disabledReason,
}: {
  billId: string;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <VoidButton
      kind="bill"
      label={label}
      disabled={disabled}
      disabledReason={disabledReason}
      onVoid={(reason) => api.voidBill(billId, reason)}
    />
  );
}
