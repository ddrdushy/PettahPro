"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { api, ApiError, type Account, type WhtSummary } from "@/lib/api";
import { formatLKR, formatDate } from "@/lib/format";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function WhtClient({
  initialSummary,
  bankAccounts,
}: {
  initialSummary: WhtSummary;
  bankAccounts: Account[];
}) {
  const router = useRouter();
  const [summary, setSummary] = useState<WhtSummary>(initialSummary);
  const [remitOpen, setRemitOpen] = useState(false);

  async function refresh() {
    const data = await api.whtSummary();
    setSummary(data);
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Outstanding balance"
          value={formatLKR(summary.balanceCents)}
          sub="Owed to IRD"
          tone={summary.balanceCents > 0 ? "amber" : "mint"}
        />
        <SummaryCard
          label="This month withheld"
          value={formatLKR(summary.perMonth[0]?.withheldCents ?? 0)}
          sub={summary.perMonth[0] ? `${MONTHS[summary.perMonth[0].month - 1]} ${summary.perMonth[0].year}` : "—"}
          tone="neutral"
        />
        <SummaryCard
          label="Suppliers with WHT"
          value={summary.suppliers.length.toString()}
          sub="Lifetime-to-date"
          tone="neutral"
        />
      </section>

      <div className="flex items-center justify-between gap-3">
        <p className="text-small text-text-secondary">
          Remit by the 15th of the following month. IRD accepts via ACES (eServices) portal — once filed, record the remittance here to clear the balance from your books.
        </p>
        <button
          type="button"
          onClick={() => setRemitOpen(true)}
          disabled={summary.balanceCents <= 0}
          className="btn-primary inline-flex shrink-0 items-center gap-2 text-small disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          Record remittance
        </button>
      </div>

      <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <header className="border-b-hairline border-border px-5 py-3">
          <h2 className="text-body font-medium text-charcoal">By month</h2>
        </header>
        {summary.perMonth.length === 0 ? (
          <div className="p-10 text-center text-body text-text-secondary">
            No withholding activity yet. WHT gets collected when you apply it on a supplier payment.
          </div>
        ) : (
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Month</th>
                <th className="w-36 px-4 py-3 text-right">Withheld</th>
                <th className="w-36 px-4 py-3 text-right">Remitted</th>
                <th className="w-36 px-4 py-3 text-right">Net balance</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {summary.perMonth.map((m) => (
                <tr key={`${m.year}-${m.month}`}>
                  <td className="px-4 py-3 text-charcoal">{MONTHS[m.month - 1]} {m.year}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {formatLKR(m.withheldCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {m.remittedCents > 0 ? formatLKR(m.remittedCents) : "—"}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${m.netBalanceCents > 0 ? "font-medium text-amber-800" : "text-text-tertiary"}`}>
                    {formatLKR(m.netBalanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <header className="border-b-hairline border-border px-5 py-3">
          <h2 className="text-body font-medium text-charcoal">By supplier (lifetime)</h2>
        </header>
        {summary.suppliers.length === 0 ? (
          <div className="p-10 text-center text-body text-text-secondary">No supplier withholdings recorded.</div>
        ) : (
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Supplier</th>
                <th className="w-24 px-4 py-3 text-right">Payments</th>
                <th className="w-36 px-4 py-3 text-right">Total withheld</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {summary.suppliers.map((s) => (
                <tr key={s.supplierId}>
                  <td className="px-4 py-3">
                    <Link href={`/app/suppliers/${s.supplierId}`} className="text-charcoal underline-offset-4 hover:underline">
                      {s.supplierName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{s.paymentCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                    {formatLKR(s.withheldCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {summary.remittances.length > 0 && (
        <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <header className="border-b-hairline border-border px-5 py-3">
            <h2 className="text-body font-medium text-charcoal">Remittance history</h2>
          </header>
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-32 px-4 py-3 text-left">Date</th>
                <th className="w-32 px-4 py-3 text-left">Entry #</th>
                <th className="px-4 py-3 text-left">Memo</th>
                <th className="w-32 px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {summary.remittances.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(r.entryDate)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/app/journals/${r.id}`} className="text-charcoal underline-offset-4 hover:underline">
                      {r.entryNumber ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{r.memo ?? ""}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                    {formatLKR(r.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {remitOpen && (
        <RemitDialog
          outstanding={summary.balanceCents}
          bankAccounts={bankAccounts}
          onCancel={() => setRemitOpen(false)}
          onDone={async () => {
            setRemitOpen(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "mint" | "amber" | "neutral";
}) {
  const toneClass =
    tone === "mint" ? "text-mint-dark" : tone === "amber" ? "text-amber-800" : "text-charcoal";
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className={`mt-2 text-h3 font-medium tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-caption text-text-tertiary">{sub}</p>
    </div>
  );
}

function RemitDialog({
  outstanding,
  bankAccounts,
  onCancel,
  onDone,
}: {
  outstanding: number;
  bankAccounts: Account[];
  onCancel: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState((outstanding / 100).toFixed(2));
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(Number(amount) * 100);
    if (!bankAccountId) return setError("Pick a bank account.");
    if (!Number.isFinite(cents) || cents <= 0) return setError("Enter a valid amount.");
    setBusy(true);
    try {
      await api.remitWht({
        bankAccountId,
        amountCents: cents,
        paymentDate,
        reference: reference.trim() || undefined,
        memo: memo.trim() || undefined,
      });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record remittance.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-lg">
        <h2 className="text-body font-medium text-charcoal">Record WHT remittance</h2>
        <p className="mt-1 text-caption text-text-secondary">
          Posts DR WHT Payable, CR Bank. Run this after lodging the return and transferring the money to IRD.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="bank" className="block text-caption uppercase tracking-wide text-text-tertiary">Bank account</label>
            <select id="bank" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className="input mt-1.5 w-full">
              <option value="">Select…</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="amount" className="block text-caption uppercase tracking-wide text-text-tertiary">Amount (LKR)</label>
            <input id="amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input mt-1.5 w-full" />
          </div>
          <div>
            <label htmlFor="paymentDate" className="block text-caption uppercase tracking-wide text-text-tertiary">Payment date</label>
            <input id="paymentDate" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="input mt-1.5 w-full" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="reference" className="block text-caption uppercase tracking-wide text-text-tertiary">Reference (optional)</label>
            <input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="IRD receipt / ACES confirmation #" className="input mt-1.5 w-full" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="memo" className="block text-caption uppercase tracking-wide text-text-tertiary">Memo (optional)</label>
            <textarea id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="e.g. WHT for May 2026" className="input mt-1.5 w-full" />
          </div>
        </div>

        {error && <p className="mt-3 text-caption text-danger">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost text-small">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Record remittance
          </button>
        </div>
      </form>
    </div>
  );
}
