"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, Loader2, Plus, Trash2, Upload, AlertTriangle } from "lucide-react";
import { api, ApiError, type Account, type OpeningBalanceState } from "@/lib/api";
import { formatLKR, formatDate } from "@/lib/format";

interface LineDraft {
  id: string;
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
}

function emptyLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    accountCode: "",
    debit: "",
    credit: "",
    description: "",
  };
}

function toCents(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
}

export function OpeningBalanceClient({
  initialState,
  accounts,
}: {
  initialState: OpeningBalanceState;
  accounts: Account[];
}) {
  const router = useRouter();
  const [asOfDate, setAsOfDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [lines, setLines] = useState<LineDraft[]>(() => [
    emptyLine(), emptyLine(), emptyLine(),
  ]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of lines) {
      dr += toCents(l.debit);
      cr += toCents(l.credit);
    }
    return { dr, cr, variance: dr - cr };
  }, [lines]);

  if (initialState.posted && initialState.entry) {
    return (
      <div className="mt-6 space-y-4">
        <section className="rounded-card border-hairline border-mint/40 bg-mint-surface/40 p-6">
          <div className="flex items-start gap-3">
            <Check className="mt-1 h-5 w-5 shrink-0 text-mint-dark" aria-hidden />
            <div>
              <p className="text-body font-medium text-charcoal">Opening balance is posted.</p>
              <p className="mt-1 text-small text-text-secondary">
                Entry <Link href={`/app/journals/${initialState.entry.id}`} className="text-charcoal underline-offset-4 hover:underline">{initialState.entry.entryNumber ?? initialState.entry.id.slice(0, 8)}</Link> dated {formatDate(initialState.entry.entryDate)} · {initialState.entry.lineCount} lines · total {formatLKR(initialState.entry.totalDrCents)}.
              </p>
              <p className="mt-3 text-caption text-text-tertiary">
                To restate opening balances, void the entry from the journal detail page (will require reopening the period it landed in), then come back here.
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function applyPaste() {
    setError(null);
    const rows = pasteText
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    if (rows.length === 0) return;

    const parsed: LineDraft[] = [];
    for (const row of rows) {
      // Split on tab, comma, or multiple spaces. Expect: code, dr, cr, [description].
      const parts = row.split(/\t|,|\s{2,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      // Skip obvious header row.
      if (/^(code|account|a\/c)/i.test(parts[0]!) && /^(dr|debit)/i.test(parts[1] ?? "")) continue;

      const code = parts[0]!;
      const debit = parts[1] ?? "";
      const credit = parts[2] ?? "";
      const description = parts.slice(3).join(" ");

      parsed.push({
        id: crypto.randomUUID(),
        accountCode: code,
        debit: /^[\d.-]+$/.test(debit) && Number(debit) > 0 ? debit : "",
        credit: /^[\d.-]+$/.test(credit) && Number(credit) > 0 ? credit : "",
        description,
      });
    }

    if (parsed.length === 0) {
      setError("Couldn't parse anything from that paste. Expected: account_code, debit, credit (tab, comma, or 2+ space separated).");
      return;
    }

    setLines(parsed);
    setPasteOpen(false);
    setPasteText("");
  }

  async function submit() {
    setError(null);
    const filled = lines.filter((l) => l.accountCode.trim() && (toCents(l.debit) > 0 || toCents(l.credit) > 0));
    if (filled.length < 2) {
      setError("Need at least two lines with an account code and an amount.");
      return;
    }
    if (totals.dr === 0) {
      setError("Enter some amounts first.");
      return;
    }
    if (totals.variance !== 0) {
      setError(`Debits and credits must match. Off by ${formatLKR(Math.abs(totals.variance))}.`);
      return;
    }

    setBusy(true);
    try {
      await api.postOpeningBalance({
        asOfDate,
        lines: filled.map((l) => ({
          accountCode: l.accountCode.trim(),
          drCents: toCents(l.debit) || undefined,
          crCents: toCents(l.credit) || undefined,
          description: l.description.trim() || undefined,
        })),
      });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "UNKNOWN_ACCOUNTS") {
          setError(err.message);
        } else if (err.code === "ALREADY_POSTED") {
          setError("An opening balance entry already exists. Refresh the page to see it.");
          router.refresh();
        } else {
          setError(err.message);
        }
      } else {
        setError("Couldn't post opening balance. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-card border-hairline border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
          <div className="text-small text-amber-900">
            <p className="font-medium">One-shot posting.</p>
            <p className="mt-1">Only one opening balance entry per tenant. If you spot a mistake after posting, void the journal entry and come back here — which means reopening the period it landed in. Easiest to get this right on the first pass.</p>
          </div>
        </div>
      </section>

      <section className="rounded-card border-hairline border-border bg-surface-elevated p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <label htmlFor="asOfDate" className="block text-caption uppercase tracking-wide text-text-tertiary">
              Cutoff date
            </label>
            <input
              id="asOfDate"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="input mt-1.5 w-44"
            />
            <p className="mt-1 text-caption text-text-tertiary">Usually yesterday — the day before your PettahPro books start.</p>
          </div>
          <button
            type="button"
            onClick={() => setPasteOpen(true)}
            className="btn-secondary inline-flex items-center gap-2 text-small"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Paste CSV
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <header className="flex items-center justify-between gap-3 border-b-hairline border-border px-5 py-3">
          <h2 className="text-body font-medium text-charcoal">Trial balance</h2>
          <button type="button" onClick={addLine} className="btn-ghost inline-flex items-center gap-1 text-caption">
            <Plus className="h-3 w-3" aria-hidden />
            Add row
          </button>
        </header>
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-48 px-4 py-2 text-left">Account</th>
              <th className="px-4 py-2 text-left">Description</th>
              <th className="w-36 px-4 py-2 text-right">Debit</th>
              <th className="w-36 px-4 py-2 text-right">Credit</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l) => {
              const acct = accounts.find((a) => a.code === l.accountCode.trim());
              return (
                <tr key={l.id}>
                  <td className="px-4 py-2">
                    <input
                      list="coa-codes"
                      value={l.accountCode}
                      onChange={(e) => updateLine(l.id, { accountCode: e.target.value })}
                      placeholder="e.g. 1000"
                      className="input w-full"
                    />
                    {acct && (
                      <p className="mt-1 truncate text-caption text-text-tertiary" title={acct.name}>{acct.name}</p>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={l.description}
                      onChange={(e) => updateLine(l.id, { description: e.target.value })}
                      placeholder="(optional)"
                      className="input w-full"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={l.debit}
                      onChange={(e) => updateLine(l.id, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                      placeholder="0.00"
                      className="input w-full text-right"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={l.credit}
                      onChange={(e) => updateLine(l.id, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                      placeholder="0.00"
                      className="input w-full text-right"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button type="button" onClick={() => removeLine(l.id)} className="btn-ghost text-text-tertiary" aria-label="Remove line">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
            <tr className="bg-surface-recessed/60 font-medium">
              <td className="px-4 py-3 text-charcoal">Totals</td>
              <td />
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(totals.dr)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(totals.cr)}</td>
              <td />
            </tr>
            {totals.variance !== 0 && (totals.dr > 0 || totals.cr > 0) && (
              <tr className="bg-danger-bg/30">
                <td className="px-4 py-2 text-caption text-danger">Variance</td>
                <td />
                <td colSpan={2} className="px-4 py-2 text-right tabular-nums text-caption text-danger">
                  {formatLKR(Math.abs(totals.variance))} {totals.variance > 0 ? "extra DR" : "extra CR"}
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <datalist id="coa-codes">
        {accounts.map((a) => (
          <option key={a.id} value={a.code}>{a.name}</option>
        ))}
      </datalist>

      {error && (
        <div role="alert" className="rounded-md border-hairline border-danger/40 bg-danger-bg/60 px-4 py-3 text-small text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || totals.dr === 0 || totals.variance !== 0}
          className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Post opening balance
        </button>
      </div>

      {pasteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4">
          <div className="w-full max-w-2xl rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-lg">
            <h3 className="text-body font-medium text-charcoal">Paste CSV</h3>
            <p className="mt-1 text-caption text-text-secondary">
              One row per account. Columns: <code className="rounded bg-surface-recessed px-1">account_code</code>, <code className="rounded bg-surface-recessed px-1">debit</code>, <code className="rounded bg-surface-recessed px-1">credit</code>, (optional) <code className="rounded bg-surface-recessed px-1">description</code>. Tab, comma, or 2+ spaces as separator.
            </p>
            <pre className="mt-3 rounded-md bg-surface-recessed/60 p-3 font-mono text-caption text-text-secondary">{`1000	1,000,000	0	Cash in hand
1100	500,000	0	AR opening
2000	0	300,000	AP opening
3000	0	1,200,000	Retained earnings`}</pre>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              placeholder="Paste your trial balance here…"
              className="input mt-3 w-full font-mono text-caption"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => { setPasteOpen(false); setPasteText(""); }} className="btn-ghost text-small">Cancel</button>
              <button type="button" onClick={applyPaste} className="btn-primary text-small" disabled={!pasteText.trim()}>Parse</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
