"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2, Wallet } from "lucide-react";
import { Drawer } from "@/components/app/drawer";
import { Field } from "@/components/auth/field";
import { api, ApiError, type Account, type PaymentMethod } from "@/lib/api";
import { formatLKR } from "@/lib/format";

const METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "lankaqr", label: "LankaQR" },
  { value: "card", label: "Card" },
  { value: "payhere", label: "PayHere" },
  { value: "frimi", label: "FriMi" },
  { value: "genie", label: "Genie" },
  { value: "ipay", label: "iPay" },
  { value: "other", label: "Other" },
];

export function RecordPaymentButton(props: {
  invoiceId: string;
  customerId: string;
  customerName: string;
  invoiceNumber: string;
  balanceDueCents: number;
  bankAccounts: Account[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");

  const defaultBank = props.bankAccounts.find((a) => a.accountSubtype === "bank") ?? props.bankAccounts[0];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const amountLKR = Number(f.get("amount") ?? 0);
    const amountCents = Math.round(amountLKR * 100);

    if (amountCents <= 0) {
      setError("Enter an amount greater than zero.");
      setBusy(false);
      return;
    }
    if (amountCents > props.balanceDueCents) {
      setError(`Amount can't exceed the balance due (${formatLKR(props.balanceDueCents)}).`);
      setBusy(false);
      return;
    }

    try {
      await api.createPayment({
        customerId: props.customerId,
        method,
        bankAccountId: String(f.get("bankAccountId") ?? ""),
        amountCents,
        paymentDate: String(f.get("paymentDate") ?? "") || undefined,
        reference: String(f.get("reference") ?? "").trim() || undefined,
        chequeDate: method === "cheque" ? String(f.get("chequeDate") ?? "") || undefined : undefined,
        memo: String(f.get("memo") ?? "").trim() || undefined,
        allocations: [{ invoiceId: props.invoiceId, allocatedCents: amountCents }],
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record the payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-primary">
        <Wallet className="h-4 w-4" aria-hidden />
        Record payment
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={`Record payment · ${props.invoiceNumber}`}
        description={`Allocated to this invoice for ${props.customerName}. Balance due ${formatLKR(props.balanceDueCents)}.`}
      >
        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <section className="space-y-4">
            <SectionTitle>Method</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {METHOD_OPTIONS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`rounded-md border-hairline py-2 text-small transition ${
                    method === m.value
                      ? "border-charcoal bg-charcoal text-offwhite"
                      : "border-border bg-surface-elevated text-text-secondary hover:border-charcoal hover:text-charcoal"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle>Details</SectionTitle>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Amount (LKR)"
                name="amount"
                type="number"
                min={0.01}
                step="0.01"
                max={(props.balanceDueCents / 100).toFixed(2)}
                defaultValue={(props.balanceDueCents / 100).toFixed(2)}
                required
              />
              <Field
                label="Payment date"
                name="paymentDate"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>

            <div>
              <label htmlFor="bankAccountId" className="block text-small font-medium text-charcoal">
                {method === "cash" ? "Cash account" : "Received to"}
              </label>
              <select
                id="bankAccountId"
                name="bankAccountId"
                defaultValue={defaultBank?.id ?? ""}
                required
                className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
              >
                {props.bankAccounts.length === 0 && <option value="">No bank or cash account</option>}
                {props.bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label="Reference"
              name="reference"
              placeholder={method === "cheque" ? "Cheque number" : method === "bank_transfer" ? "Bank reference" : "Optional"}
            />

            {method === "cheque" && (
              <Field
                label="Cheque date"
                name="chequeDate"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            )}

            <div>
              <label htmlFor="memo" className="block text-small font-medium text-charcoal">
                Memo
              </label>
              <textarea
                id="memo"
                name="memo"
                rows={2}
                placeholder="Internal note"
                className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
              />
            </div>
          </section>

          {error && (
            <div
              role="alert"
              className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
            >
              {error}
            </div>
          )}

          <p className="rounded-md bg-mint-surface/60 p-3 text-caption text-mint-dark">
            Posting creates: <span className="tabular-nums font-medium">DR {defaultBank?.code ?? "Bank"} · CR 1100 Accounts receivable</span>
          </p>

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="btn-link">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Recording…
                </>
              ) : (
                "Record and post"
              )}
            </button>
          </div>
        </form>
      </Drawer>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
      {children}
    </h3>
  );
}
