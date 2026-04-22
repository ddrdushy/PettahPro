"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Send, XCircle, Trash2 } from "lucide-react";
import { api, ApiError, type FxRevaluation, type FxRevaluationLine } from "@/lib/api";

function formatLkr(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${(abs / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_BADGE: Record<FxRevaluation["status"], string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  posted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  voided: "bg-gray-50 text-text-tertiary border-border",
};

export function FxRevaluationDetailClient({
  revaluation,
  lines,
}: {
  revaluation: FxRevaluation;
  lines: FxRevaluationLine[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"post" | "void" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const post = async () => {
    setBusy("post");
    setError(null);
    try {
      await api.postFxRevaluation(revaluation.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post.");
    } finally {
      setBusy(null);
    }
  };

  const voidRun = async () => {
    const reason = window.prompt("Reason for voiding this run? (optional)") ?? "";
    setBusy("void");
    setError(null);
    try {
      await api.voidFxRevaluation(revaluation.id, {
        reason: reason.trim() || undefined,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't void.");
    } finally {
      setBusy(null);
    }
  };

  const del = async () => {
    if (!window.confirm("Delete this draft? It hasn't touched the ledger yet.")) return;
    setBusy("delete");
    setError(null);
    try {
      await api.deleteFxRevaluation(revaluation.id);
      router.push("/app/accounting/fx-revaluation");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete.");
      setBusy(null);
    }
  };

  const arDelta = revaluation.arGainCents - revaluation.arLossCents;
  const apDelta = revaluation.apGainCents - revaluation.apLossCents;
  const summaryEntries = Object.entries(revaluation.currencySummary);

  return (
    <section className="mt-6 space-y-6">
      <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-caption font-medium uppercase tracking-wide ${STATUS_BADGE[revaluation.status]}`}
              >
                {revaluation.status}
              </span>
              <span className="text-caption text-text-tertiary">
                Created {new Date(revaluation.createdAt).toLocaleString()}
              </span>
              {revaluation.postedAt ? (
                <span className="text-caption text-text-tertiary">
                  · posted {new Date(revaluation.postedAt).toLocaleString()}
                </span>
              ) : null}
              {revaluation.voidedAt ? (
                <span className="text-caption text-text-tertiary">
                  · voided {new Date(revaluation.voidedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
            {revaluation.notes ? (
              <p className="mt-2 text-caption text-text-secondary">{revaluation.notes}</p>
            ) : null}
            {revaluation.voidReason ? (
              <p className="mt-2 text-caption text-text-secondary">
                <span className="text-text-tertiary">Void reason: </span>
                {revaluation.voidReason}
              </p>
            ) : null}
            {revaluation.journalEntryId ? (
              <p className="mt-2 text-caption">
                <Link
                  href={`/app/journals/${revaluation.journalEntryId}`}
                  className="btn-link"
                >
                  View posted journal entry →
                </Link>
              </p>
            ) : null}
            {revaluation.voidJournalEntryId ? (
              <p className="mt-1 text-caption">
                <Link
                  href={`/app/journals/${revaluation.voidJournalEntryId}`}
                  className="btn-link"
                >
                  View reversing journal entry →
                </Link>
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {revaluation.status === "draft" ? (
              <>
                <button
                  type="button"
                  onClick={post}
                  disabled={busy !== null || lines.length === 0}
                  className="btn-primary disabled:opacity-50"
                >
                  {busy === "post" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden />
                  )}
                  Post to ledger
                </button>
                <button
                  type="button"
                  onClick={del}
                  disabled={busy !== null}
                  className="btn-secondary disabled:opacity-50"
                >
                  {busy === "delete" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden />
                  )}
                  Delete draft
                </button>
              </>
            ) : revaluation.status === "posted" ? (
              <button
                type="button"
                onClick={voidRun}
                disabled={busy !== null}
                className="btn-secondary disabled:opacity-50"
              >
                {busy === "void" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <XCircle className="h-4 w-4" aria-hidden />
                )}
                Void
              </button>
            ) : null}
          </div>
        </div>
        {error ? <p className="mt-4 text-caption text-red-600">{error}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
          <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
            AR (receivables)
          </h3>
          <div className="mt-3 grid gap-2 text-small">
            <div className="flex justify-between">
              <span className="text-text-secondary">Gain</span>
              <span className="tabular-nums text-emerald-700">
                {formatLkr(revaluation.arGainCents)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Loss</span>
              <span className="tabular-nums text-red-600">
                {formatLkr(revaluation.arLossCents)}
              </span>
            </div>
            <div className="flex justify-between border-t-hairline border-border pt-2 font-medium">
              <span className="text-charcoal">Net delta</span>
              <span className={`tabular-nums ${arDelta >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                {formatLkr(arDelta)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
          <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
            AP (payables)
          </h3>
          <div className="mt-3 grid gap-2 text-small">
            <div className="flex justify-between">
              <span className="text-text-secondary">Gain</span>
              <span className="tabular-nums text-emerald-700">
                {formatLkr(revaluation.apGainCents)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Loss</span>
              <span className="tabular-nums text-red-600">
                {formatLkr(revaluation.apLossCents)}
              </span>
            </div>
            <div className="flex justify-between border-t-hairline border-border pt-2 font-medium">
              <span className="text-charcoal">Net delta</span>
              <span className={`tabular-nums ${apDelta >= 0 ? "text-red-600" : "text-emerald-700"}`}>
                {formatLkr(apDelta)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {summaryEntries.length > 0 ? (
        <div className="rounded-card border-hairline border-border bg-surface-elevated">
          <div className="border-b-hairline border-border px-6 py-4">
            <h2 className="text-body font-medium text-charcoal">By currency</h2>
            <p className="mt-1 text-caption text-text-secondary">
              Open foreign balances at issue-rate LKR vs. closing rate at as-of date.
            </p>
          </div>
          <table className="w-full text-small">
            <thead>
              <tr className="border-b-hairline border-border text-caption text-text-tertiary">
                <th className="px-6 py-3 text-left font-medium">Currency</th>
                <th className="px-6 py-3 text-right font-medium">Open (foreign)</th>
                <th className="px-6 py-3 text-right font-medium">On ledger (LKR)</th>
                <th className="px-6 py-3 text-right font-medium">As-of rate</th>
                <th className="px-6 py-3 text-right font-medium">Delta (LKR)</th>
              </tr>
            </thead>
            <tbody>
              {summaryEntries.map(([ccy, s]) => (
                <tr key={ccy} className="border-b-hairline border-border last:border-b-0">
                  <td className="px-6 py-3 font-medium text-charcoal">{ccy}</td>
                  <td className="px-6 py-3 text-right text-charcoal tabular-nums">
                    {(s.openForeign / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-3 text-right text-charcoal tabular-nums">
                    {formatLkr(s.openLkr)}
                  </td>
                  <td className="px-6 py-3 text-right text-charcoal tabular-nums">
                    {s.asOfRate.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                  </td>
                  <td
                    className={`px-6 py-3 text-right tabular-nums ${s.deltaLkr >= 0 ? "text-emerald-700" : "text-red-600"}`}
                  >
                    {formatLkr(s.deltaLkr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="rounded-card border-hairline border-border bg-surface-elevated">
        <div className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
          <h2 className="text-body font-medium text-charcoal">Per-document audit</h2>
          <span className="text-caption text-text-tertiary">
            {lines.length} line{lines.length === 1 ? "" : "s"}
          </span>
        </div>
        {lines.length === 0 ? (
          <p className="px-6 py-8 text-body text-text-secondary">
            No open foreign-currency documents as of {revaluation.asOfDate}. Nothing to post.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-small">
              <thead>
                <tr className="border-b-hairline border-border text-caption text-text-tertiary">
                  <th className="px-6 py-3 text-left font-medium">Doc</th>
                  <th className="px-6 py-3 text-left font-medium">Ccy</th>
                  <th className="px-6 py-3 text-right font-medium">Outstanding</th>
                  <th className="px-6 py-3 text-right font-medium">Issue rate</th>
                  <th className="px-6 py-3 text-right font-medium">As-of rate</th>
                  <th className="px-6 py-3 text-right font-medium">On ledger</th>
                  <th className="px-6 py-3 text-right font-medium">At as-of</th>
                  <th className="px-6 py-3 text-right font-medium">Cumulative Δ</th>
                  <th className="px-6 py-3 text-right font-medium">Previous Δ</th>
                  <th className="px-6 py-3 text-right font-medium">Incremental Δ</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b-hairline border-border last:border-b-0">
                    <td className="px-6 py-3">
                      <Link
                        href={
                          l.sourceType === "invoice"
                            ? `/app/invoices/${l.sourceId}`
                            : `/app/bills/${l.sourceId}`
                        }
                        className="font-medium text-charcoal hover:underline"
                      >
                        {l.docNumber ?? (l.sourceType === "invoice" ? "Invoice" : "Bill")}
                      </Link>
                      <span className="ml-2 text-caption text-text-tertiary uppercase">
                        {l.direction}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-text-secondary">{l.currency}</td>
                    <td className="px-6 py-3 text-right text-charcoal tabular-nums">
                      {(l.foreignOutstandingCents / 100).toLocaleString("en", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-6 py-3 text-right text-text-secondary tabular-nums">
                      {Number(l.issueFxRate).toLocaleString("en", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })}
                    </td>
                    <td className="px-6 py-3 text-right text-text-secondary tabular-nums">
                      {Number(l.asOfRate).toLocaleString("en", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })}
                    </td>
                    <td className="px-6 py-3 text-right text-charcoal tabular-nums">
                      {formatLkr(l.lkrOnLedgerCents)}
                    </td>
                    <td className="px-6 py-3 text-right text-charcoal tabular-nums">
                      {formatLkr(l.lkrAtAsOfCents)}
                    </td>
                    <td
                      className={`px-6 py-3 text-right tabular-nums ${
                        l.cumulativeDeltaCents >= 0 ? "text-emerald-700" : "text-red-600"
                      }`}
                    >
                      {formatLkr(l.cumulativeDeltaCents)}
                    </td>
                    <td className="px-6 py-3 text-right text-text-tertiary tabular-nums">
                      {formatLkr(l.previousCumulativeDeltaCents)}
                    </td>
                    <td
                      className={`px-6 py-3 text-right font-medium tabular-nums ${
                        l.incrementalDeltaCents >= 0 ? "text-emerald-700" : "text-red-600"
                      }`}
                    >
                      {formatLkr(l.incrementalDeltaCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
