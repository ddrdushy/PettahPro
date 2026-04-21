"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check, Loader2, Lock, RefreshCw, Undo2 } from "lucide-react";
import {
  api,
  ApiError,
  type Account,
  type BankImportDetail,
  type BankLineMatchStatus,
  type BankStatementLineRow,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const matchStyles: Record<BankLineMatchStatus, string> = {
  unmatched: "bg-surface-recessed text-text-secondary",
  matched: "bg-mint text-mint-dark",
  ignored: "bg-surface-recessed text-text-tertiary",
  multiple_candidates: "bg-warning-bg text-warning",
};

const matchLabels: Record<BankLineMatchStatus, string> = {
  unmatched: "Unmatched",
  matched: "Matched",
  ignored: "Ignored",
  multiple_candidates: "Multiple",
};

export function BankImportDetailClient({
  import: imp,
  bank,
  lines: initialLines,
}: {
  import: BankImportDetail;
  bank: Account | null;
  lines: BankStatementLineRow[];
}) {
  const router = useRouter();
  const [lines, setLines] = useState(initialLines);
  const [busy, setBusy] = useState<"match" | "reconcile" | string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAutoMatch() {
    setError(null);
    setBusy("match");
    try {
      const res = await api.autoMatchBankImport(imp.id);
      setFlash(
        `Auto-matched ${res.autoMatched}. ${res.multipleCandidates > 0 ? `${res.multipleCandidates} need review. ` : ""}${res.matchedLines}/${res.totalLines} total matched.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Auto-match failed.");
    } finally {
      setBusy(null);
    }
  }

  async function unmatch(line: BankStatementLineRow) {
    setError(null);
    setBusy(line.id);
    try {
      await api.unmatchBankLine(line.id);
      setLines((prev) =>
        prev.map((l) =>
          l.id === line.id
            ? { ...l, matchStatus: "unmatched", matchedRefType: null, matchedRefId: null, matchNotes: null, matchedAt: null }
            : l,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't unmatch.");
    } finally {
      setBusy(null);
    }
  }

  async function reconcile() {
    if (!confirm("Lock this reconciliation? You won't be able to change matches after this.")) return;
    setError(null);
    setBusy("reconcile");
    try {
      await api.reconcileBankImport(imp.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reconcile.");
    } finally {
      setBusy(null);
    }
  }

  const matched = lines.filter((l) => l.matchStatus === "matched").length;
  const unmatched = lines.filter((l) => l.matchStatus === "unmatched").length;
  const multiple = lines.filter((l) => l.matchStatus === "multiple_candidates").length;

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/bank-reconciliation" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to reconciliations
        </Link>
      </div>

      <PageHeader
        eyebrow="Accounting · Bank reconciliation"
        title={bank ? `${bank.code} · ${bank.name}` : "Bank statement"}
        description={`${formatDate(imp.statementFromDate)} — ${formatDate(imp.statementToDate)} · ${imp.totalLines} lines · imported ${formatDate(imp.createdAt.slice(0, 10))}`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${
                imp.status === "reconciled" ? "bg-mint text-mint-dark" : "bg-warning-bg text-warning"
              }`}
            >
              {imp.status === "reconciled" ? "Reconciled" : "Pending"}
            </span>
            {imp.status === "pending" && (
              <>
                <button type="button" onClick={runAutoMatch} disabled={busy !== null} className="btn-secondary">
                  {busy === "match" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                  Auto-match
                </button>
                <button type="button" onClick={reconcile} disabled={busy !== null} className="btn-primary">
                  {busy === "reconcile" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
                  Reconcile
                </button>
              </>
            )}
          </div>
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Total lines" value={String(imp.totalLines)} />
        <Stat label="Matched" value={`${matched}`} tone="good" />
        <Stat label="Multiple candidates" value={`${multiple}`} tone={multiple > 0 ? "warn" : "neutral"} />
        <Stat label="Unmatched" value={`${unmatched}`} tone={unmatched > 0 ? "warn" : "neutral"} />
      </section>

      {flash && (
        <div className="mt-4 rounded-card border-hairline border-mint/40 bg-mint-surface/50 px-5 py-3 text-small text-charcoal">
          {flash}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-card border-hairline border-danger/40 bg-danger-bg/40 px-5 py-3 text-small text-danger">
          {error}
        </div>
      )}

      {imp.notes && (
        <div className="mt-4 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small text-text-secondary">
          {imp.notes}
        </div>
      )}

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-12 px-4 py-3 text-center">#</th>
              <th className="w-28 px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="w-28 px-4 py-3 text-left">Reference</th>
              <th className="w-32 px-4 py-3 text-right">Amount</th>
              <th className="w-32 px-4 py-3 text-center">Match</th>
              <th className="w-24 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l) => (
              <tr key={l.id} className={l.matchStatus === "matched" ? "bg-mint-surface/20" : ""}>
                <td className="px-4 py-3 text-center tabular-nums text-text-tertiary">{l.lineNo}</td>
                <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(l.transactionDate)}</td>
                <td className="px-4 py-3">
                  <p className="text-charcoal">{l.description}</p>
                  {l.matchNotes && <p className="text-caption text-text-tertiary">{l.matchNotes}</p>}
                </td>
                <td className="px-4 py-3 tabular-nums text-text-secondary">
                  {l.reference ?? <span className="text-text-tertiary">—</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <span className={l.amountCents >= 0 ? "text-charcoal" : "text-danger"}>
                    {formatLKR(l.amountCents)}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${matchStyles[l.matchStatus]}`}>
                    {l.matchStatus === "matched" ? (
                      <>
                        <Check className="mr-1 inline h-3 w-3" aria-hidden /> Matched
                      </>
                    ) : (
                      matchLabels[l.matchStatus]
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {l.matchStatus === "matched" && imp.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => unmatch(l)}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 text-caption text-text-secondary transition hover:text-charcoal disabled:opacity-50"
                    >
                      {busy === l.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Undo2 className="h-3 w-3" aria-hidden />}
                      Unmatch
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "warn" | "neutral" }) {
  const toneClass =
    tone === "good"
      ? "border-mint/40 bg-mint-surface/40"
      : tone === "warn"
        ? "border-warning-accent/40 bg-warning-bg/40"
        : "border-border bg-surface-elevated";
  return (
    <div className={`rounded-card border-hairline p-5 ${toneClass}`}>
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-2 text-h3 text-charcoal">{value}</p>
    </div>
  );
}
