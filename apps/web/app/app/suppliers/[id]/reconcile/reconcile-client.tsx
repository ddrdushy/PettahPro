"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import {
  api,
  ApiError,
  type SupplierReconcileResult,
  type SupplierReconcileStatus,
  type SupplierReconcileRow,
} from "@/lib/api";
import { formatLKR, formatDate } from "@/lib/format";

// Parse a freeform paste into {reference, amount, date?} rows.
//
// We accept three shapes so the user can paste from most supplier
// statements without heavy cleanup:
//   REF, 12345.00
//   REF, 12345.00, 2026-04-15
//   REF<tab>12345.00<tab>2026-04-15
//
// Amount may contain commas as thousand separators ("12,345.00"). Any
// line that doesn't produce a valid (reference, amount) pair is kept
// aside as a parse warning so the user can see which rows we dropped.
function parsePaste(
  text: string,
): { rows: SupplierReconcileRow[]; badLines: string[] } {
  const rows: SupplierReconcileRow[] = [];
  const badLines: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Split on tab OR comma OR 2+ spaces — tolerant of mixed pastes.
    const parts = line.split(/\t|,|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      badLines.push(line);
      continue;
    }
    const reference = parts[0]!;
    const amountStr = parts[1]!.replace(/,/g, "");
    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || amount < 0) {
      badLines.push(line);
      continue;
    }
    const maybeDate = parts[2];
    const date =
      maybeDate && /^\d{4}-\d{2}-\d{2}$/.test(maybeDate) ? maybeDate : undefined;
    rows.push({ reference, amount, date });
  }
  return { rows, badLines };
}

const STATUS_LABEL: Record<SupplierReconcileStatus, string> = {
  matched: "Matched",
  amount_mismatch: "Amount mismatch",
  only_in_ours: "Only in our ledger",
  only_in_theirs: "Only in their statement",
};

const STATUS_TONE: Record<SupplierReconcileStatus, string> = {
  matched: "bg-mint-surface text-mint-dark",
  amount_mismatch: "bg-amber-100 text-amber-900",
  only_in_ours: "bg-sky-50 text-sky-900",
  only_in_theirs: "bg-rose-50 text-rose-900",
};

export function ReconcileClient({ supplierId }: { supplierId: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SupplierReconcileResult | null>(null);

  const preview = useMemo(() => parsePaste(text), [text]);

  async function run() {
    setError(null);
    if (preview.rows.length === 0) {
      setError("Paste at least one row with a reference and an amount.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.reconcileSupplier(supplierId, preview.rows);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reconciliation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <label className="block text-small font-medium text-charcoal" htmlFor="paste">
          Paste supplier's open items
        </label>
        <p className="mt-1 text-caption text-text-tertiary">
          One per line. Columns: reference, amount, date (optional). Separators:
          comma, tab, or 2+ spaces.
        </p>
        <textarea
          id="paste"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"INV-0012, 45000.00, 2026-04-05\nINV-0017, 12345.50\n..."}
          className="mt-3 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 font-mono text-small text-charcoal"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-caption text-text-tertiary">
            Parsed {preview.rows.length} row{preview.rows.length === 1 ? "" : "s"}
            {preview.badLines.length > 0
              ? ` · ${preview.badLines.length} line${preview.badLines.length === 1 ? "" : "s"} skipped`
              : ""}
            .
          </div>
          <button
            type="button"
            onClick={run}
            disabled={busy || preview.rows.length === 0}
            className="btn-primary disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Reconcile
          </button>
        </div>
        {preview.badLines.length > 0 && (
          <details className="mt-3 rounded-md bg-surface-recessed px-3 py-2 text-caption text-text-secondary">
            <summary className="cursor-pointer">Show skipped lines</summary>
            <ul className="mt-2 list-disc pl-5 font-mono">
              {preview.badLines.slice(0, 20).map((l, i) => (
                <li key={i} className="break-all">{l}</li>
              ))}
              {preview.badLines.length > 20 && <li>…and {preview.badLines.length - 20} more</li>}
            </ul>
          </details>
        )}
        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-caption text-red-700">
            {error}
          </p>
        )}
      </section>

      {result && (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <Card label="Their total" value={formatLKR(result.summary.theirTotalCents)} sub="As per statement" />
            <Card label="Our total" value={formatLKR(result.summary.ourTotalCents)} sub="Open bills" />
            <Card
              label="Difference"
              value={formatLKR(Math.abs(result.summary.diffCents))}
              sub={
                result.summary.diffCents === 0
                  ? "In agreement"
                  : result.summary.diffCents > 0
                    ? "They say we owe more"
                    : "We show more owing"
              }
              emphasis={result.summary.diffCents !== 0}
            />
            <Card
              label="Discrepancies"
              value={String(
                result.summary.amountMismatch +
                  result.summary.onlyInOurs +
                  result.summary.onlyInTheirs,
              )}
              sub={`${result.summary.matched} matched`}
            />
          </section>

          <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <header className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
              <div>
                <h2 className="text-h3 text-charcoal">Line-by-line</h2>
                <p className="text-caption text-text-tertiary">
                  {result.results.length} comparison row{result.results.length === 1 ? "" : "s"}
                </p>
              </div>
            </header>
            <table className="w-full text-small">
              <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="w-40 px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Reference</th>
                  <th className="px-4 py-3 text-left">Their date</th>
                  <th className="px-4 py-3 text-right">Theirs</th>
                  <th className="px-4 py-3 text-right">Ours</th>
                  <th className="px-4 py-3 text-right">Diff</th>
                  <th className="px-4 py-3 text-left">Our bill</th>
                </tr>
              </thead>
              <tbody className="divide-y-hairline divide-border">
                {result.results.map((r, i) => (
                  <tr key={`${r.status}-${r.reference}-${i}`}>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-caption font-medium ${STATUS_TONE[r.status]}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-charcoal">{r.reference}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {r.theirDate ? formatDate(r.theirDate) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.theirAmountCents === null
                        ? <span className="text-text-tertiary">—</span>
                        : formatLKR(r.theirAmountCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.ourBalanceCents === null
                        ? <span className="text-text-tertiary">—</span>
                        : formatLKR(r.ourBalanceCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.diffCents === null || r.diffCents === 0
                        ? <span className="text-text-tertiary">—</span>
                        : (
                          <span className={r.diffCents > 0 ? "text-amber-900" : "text-rose-900"}>
                            {r.diffCents > 0 ? "+" : ""}{formatLKR(r.diffCents)}
                          </span>
                        )}
                    </td>
                    <td className="px-4 py-3">
                      {r.ourBillId ? (
                        <Link
                          href={`/app/bills/${r.ourBillId}`}
                          className="text-charcoal underline-offset-4 hover:underline"
                        >
                          {r.ourBillNumber ?? r.ourInternalReference ?? "View"}
                        </Link>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {result.results.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-text-tertiary">
                      Nothing to reconcile.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <p className="text-caption text-text-tertiary">
            This is a read-only comparison. To fix a mismatch, post a new bill,
            credit note, or payment from the usual screens — then rerun this
            reconciliation.
          </p>
        </>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border-hairline p-5 ${
        emphasis ? "border-amber-400/40 bg-amber-50/60" : "border-border bg-surface-elevated"
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-2 text-h3 text-charcoal">{value}</p>
      <p className="mt-1 text-caption text-text-secondary">{sub}</p>
    </div>
  );
}
