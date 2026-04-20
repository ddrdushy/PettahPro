"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Banknote, Loader2 } from "lucide-react";
import { Drawer } from "@/components/app/drawer";
import { Field } from "@/components/auth/field";
import { api, ApiError, type Account } from "@/lib/api";
import { formatLKR } from "@/lib/format";

type Method = "bank_transfer" | "slips" | "cash" | "cheque" | "other";

const METHOD_OPTIONS: { value: Method; label: string; hint?: string }[] = [
  { value: "slips", label: "SLIPS", hint: "Bulk bank disbursement — one file, many staff" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

export function PayRunButton({
  runId,
  runNumber,
  netPayCents,
  bankAccounts,
}: {
  runId: string;
  runNumber: string;
  netPayCents: number;
  bankAccounts: Account[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("slips");

  const defaultBank =
    bankAccounts.find((a) => a.accountSubtype === "bank") ?? bankAccounts[0];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      await api.payPayrollRun(runId, {
        bankAccountId: String(f.get("bankAccountId") ?? ""),
        paymentDate: String(f.get("paymentDate") ?? "") || undefined,
        method,
        reference: String(f.get("reference") ?? "").trim() || undefined,
        memo: String(f.get("memo") ?? "").trim() || undefined,
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
        <Banknote className="h-4 w-4" aria-hidden />
        Pay staff
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={`Disburse payroll · ${runNumber}`}
        description={`Records the disbursement that clears Salaries payable. Total net pay to staff: ${formatLKR(netPayCents)}.`}
      >
        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <section className="space-y-3">
            <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
              Method
            </h3>
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
            {method === "slips" && (
              <p className="text-caption text-text-tertiary">
                SLIPS bulk export file generation lands in a later commit; for now record the bulk transfer here.
              </p>
            )}
          </section>

          <section className="space-y-4">
            <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
              Details
            </h3>
            <Field
              label="Payment date"
              name="paymentDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />

            <div>
              <label htmlFor="bankAccountId" className="block text-small font-medium text-charcoal">
                {method === "cash" ? "Cash account" : "Paid from"}
              </label>
              <select
                id="bankAccountId"
                name="bankAccountId"
                required
                defaultValue={defaultBank?.id ?? ""}
                className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
              >
                {bankAccounts.length === 0 && <option value="">No bank or cash account</option>}
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label="Reference"
              name="reference"
              placeholder={method === "slips" ? "SLIPS batch ID" : "Bank ref or note"}
            />

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
            Posting creates: <span className="tabular-nums font-medium">DR 2230 Salaries payable · CR {defaultBank?.code ?? "Bank"}</span>
            <br />
            Statutory payables (EPF, ETF, PAYE) are remitted separately.
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
