"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import { api, ApiError, type Account } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

const SAMPLE_CSV = `Date,Description,Debit,Credit,Reference
2026-04-01,Opening balance,,100000.00,
2026-04-03,NEFT from ABC Ltd,,59000.00,INV-2026-0001
2026-04-05,Cheque 012345 deposited,,50000.00,012345
2026-04-07,Electricity bill,15000.00,,
2026-04-10,Salary disbursement,500000.00,,PAYROLL-APR
`;

function firstOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function NewBankImportClient({ bankAccounts }: { bankAccounts: Account[] }) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [fromDate, setFromDate] = useState(firstOfMonthISO());
  const [toDate, setToDate] = useState(todayISO());
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [notes, setNotes] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toCents(s: string): number | undefined {
    if (!s.trim()) return undefined;
    const v = Number(s);
    return Number.isFinite(v) ? Math.round(v * 100) : undefined;
  }

  async function submit() {
    setError(null);
    if (!bankAccountId) {
      setError("Pick a bank account.");
      return;
    }
    if (!csv.trim()) {
      setError("Paste the statement CSV.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createBankImport({
        bankAccountId,
        statementFromDate: fromDate,
        statementToDate: toDate,
        openingBalanceCents: toCents(opening),
        closingBalanceCents: toCents(closing),
        notes: notes.trim() || undefined,
        csv,
      });
      // Immediately run auto-match so the detail page opens useful.
      try {
        await api.autoMatchBankImport(res.import.id);
      } catch {
        // Not fatal — user can retry from the detail page.
      }
      router.push(`/app/bank-reconciliation/${res.import.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't import. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/bank-reconciliation" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to reconciliations
        </Link>
      </div>

      <PageHeader
        eyebrow="Accounting"
        title="Import bank statement"
        description="Paste the CSV from your bank portal. We'll parse standard headers (Date, Description, Debit/Credit or Amount, Reference) and auto-match unique candidates against your posted payments."
      />

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Bank account</label>
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className="input mt-1.5">
            <option value="">Pick an account…</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Notes (optional)</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. April — BOC 1234" className="input mt-1.5" />
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Period from</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Period to</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Opening balance (LKR) — optional</label>
          <input type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} className="input mt-1.5 text-right tabular-nums" />
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Closing balance (LKR) — optional</label>
          <input type="number" step="0.01" value={closing} onChange={(e) => setClosing(e.target.value)} className="input mt-1.5 text-right tabular-nums" />
        </div>
      </section>

      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Statement CSV</label>
          <button
            type="button"
            onClick={() => setCsv(SAMPLE_CSV)}
            className="text-caption text-text-tertiary transition hover:text-charcoal"
          >
            Paste sample
          </button>
        </div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={14}
          placeholder={"Date,Description,Debit,Credit,Reference\n2026-04-01,Opening balance,,100000.00,\n…"}
          className="input mt-1.5 w-full font-mono text-caption"
        />
        <p className="mt-1 text-caption text-text-tertiary">
          Headers are case-insensitive. Accepted: date column, description column, and either a signed <em>Amount</em> column
          or separate <em>Debit</em> / <em>Credit</em> columns. Dates: YYYY-MM-DD, DD/MM/YYYY, or DD-MM-YYYY.
        </p>
      </section>

      <section className="mt-6 flex items-center justify-between gap-4">
        <p className="text-small text-text-secondary">
          After import, we'll auto-match rows with a unique candidate (amount + date ± 3 days against posted payments).
        </p>
        <div className="flex items-center gap-3">
          {error && <span className="text-small text-danger">{error}</span>}
          <button type="button" onClick={submit} disabled={busy} className="btn-primary disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
            Import + auto-match
          </button>
        </div>
      </section>
    </main>
  );
}
