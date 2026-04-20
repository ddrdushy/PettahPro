"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Banknote, Loader2, Landmark } from "lucide-react";
import { Drawer } from "@/components/app/drawer";
import { Field } from "@/components/auth/field";
import { api, ApiError, type Account, type StatutoryBalance } from "@/lib/api";
import { formatLKR } from "@/lib/format";

const KIND_LABEL: Record<StatutoryBalance["kind"], string> = {
  epf: "EPF",
  etf: "ETF",
  paye: "PAYE",
};

const KIND_SUBLINE: Record<StatutoryBalance["kind"], string> = {
  epf: "Employees' Provident Fund · paid to Central Bank monthly",
  etf: "Employees' Trust Fund · paid to ETF Board monthly",
  paye: "Pay-As-You-Earn income tax · paid to IRD (form T-10)",
};

export function StatutoryPanel({
  balances,
  bankAccounts,
}: {
  balances: StatutoryBalance[];
  bankAccounts: Account[];
}) {
  const totalOutstanding = balances.reduce((s, b) => s + b.balanceCents, 0);

  if (balances.length === 0) {
    return null;
  }

  return (
    <section className="mb-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
      <header className="flex items-center justify-between gap-4 border-b-hairline border-border px-6 py-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 flex-none place-items-center rounded-md bg-mint-surface text-mint-dark">
            <Landmark className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h2 className="text-h3 text-charcoal">Statutory dues</h2>
            <p className="text-caption text-text-tertiary">
              Outstanding EPF / ETF / PAYE payable to government bodies
            </p>
          </div>
        </div>
        <p className="tabular-nums text-small text-text-secondary">
          Total outstanding <span className="font-medium text-charcoal">{formatLKR(totalOutstanding)}</span>
        </p>
      </header>

      <div className="grid gap-px bg-border sm:grid-cols-3">
        {balances.map((b) => (
          <StatutoryRow key={b.kind} balance={b} bankAccounts={bankAccounts} />
        ))}
      </div>
    </section>
  );
}

function StatutoryRow({
  balance,
  bankAccounts,
}: {
  balance: StatutoryBalance;
  bankAccounts: Account[];
}) {
  const [open, setOpen] = useState(false);
  const paidOff = balance.balanceCents === 0;

  return (
    <div className="flex flex-col justify-between gap-3 bg-surface-elevated p-5">
      <div>
        <div className="flex items-baseline justify-between">
          <p className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
            {KIND_LABEL[balance.kind]}
          </p>
          <p className="text-caption text-text-tertiary">{balance.accountCode}</p>
        </div>
        <p
          className={`tabular-nums mt-2 text-h2 ${
            paidOff ? "text-text-tertiary" : "text-charcoal"
          }`}
        >
          {formatLKR(balance.balanceCents)}
        </p>
        <p className="mt-1 text-caption text-text-secondary">{KIND_SUBLINE[balance.kind]}</p>
      </div>
      <div className="flex items-center justify-end">
        {paidOff ? (
          <span className="text-caption text-mint-dark">Cleared</span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border-hairline border-charcoal bg-transparent px-3 py-1.5 text-small font-medium text-charcoal transition-colors hover:bg-mint-surface"
          >
            <Banknote className="h-3.5 w-3.5" aria-hidden />
            Remit
          </button>
        )}
      </div>

      {!paidOff && (
        <RemitDrawer
          open={open}
          onClose={() => setOpen(false)}
          balance={balance}
          bankAccounts={bankAccounts}
        />
      )}
    </div>
  );
}

function RemitDrawer({
  open,
  onClose,
  balance,
  bankAccounts,
}: {
  open: boolean;
  onClose: () => void;
  balance: StatutoryBalance;
  bankAccounts: Account[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultBank =
    bankAccounts.find((a) => a.accountSubtype === "bank") ?? bankAccounts[0];

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
    if (amountCents > balance.balanceCents) {
      setError(`Can't remit more than the outstanding balance (${formatLKR(balance.balanceCents)}).`);
      setBusy(false);
      return;
    }

    try {
      await api.remitStatutory({
        which: balance.kind,
        bankAccountId: String(f.get("bankAccountId") ?? ""),
        amountCents,
        paymentDate: String(f.get("paymentDate") ?? "") || undefined,
        reference: String(f.get("reference") ?? "").trim() || undefined,
        memo: String(f.get("memo") ?? "").trim() || undefined,
      });
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record the remittance.");
    } finally {
      setBusy(false);
    }
  }

  const kindLabel = KIND_LABEL[balance.kind];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Remit ${kindLabel}`}
      description={`${KIND_SUBLINE[balance.kind]}. Outstanding: ${formatLKR(balance.balanceCents)}.`}
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field
          label="Amount (LKR)"
          name="amount"
          type="number"
          min={0.01}
          step="0.01"
          max={(balance.balanceCents / 100).toFixed(2)}
          defaultValue={(balance.balanceCents / 100).toFixed(2)}
          required
          hint="Defaults to the full outstanding balance; adjust for partial remits"
        />

        <Field
          label="Payment date"
          name="paymentDate"
          type="date"
          defaultValue={new Date().toISOString().slice(0, 10)}
        />

        <div>
          <label htmlFor="bankAccountId" className="block text-small font-medium text-charcoal">
            Paid from
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
          placeholder={
            balance.kind === "epf"
              ? "EPF C-form ref"
              : balance.kind === "etf"
                ? "ETF R-form ref"
                : "IRD T-10 ref"
          }
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

        {error && (
          <div
            role="alert"
            className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
          >
            {error}
          </div>
        )}

        <p className="rounded-md bg-mint-surface/60 p-3 text-caption text-mint-dark">
          Posting creates:{" "}
          <span className="tabular-nums font-medium">
            DR {balance.accountCode} {kindLabel} payable · CR {defaultBank?.code ?? "Bank"}
          </span>
        </p>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-link">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Recording…
              </>
            ) : (
              `Remit ${kindLabel}`
            )}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
