"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Save, ShieldCheck, Upload, XCircle } from "lucide-react";
import {
  api,
  ApiError,
  type StockCountDetail,
  type StockCountLineRow,
  type StockCountReasonCode,
  type StockCountStatus,
} from "@/lib/api";
import { formatDate, formatLKR } from "@/lib/format";

const STATUS_CLASS: Record<StockCountStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary border-border",
  review: "bg-amber-50 text-amber-800 border-amber-200",
  pending_approval: "bg-amber-50 text-amber-900 border-amber-300",
  posted: "bg-mint-surface/60 text-mint-dark border-mint/40",
  cancelled: "bg-danger-bg/60 text-danger border-danger/40",
};

const STATUS_LABEL: Record<StockCountStatus, string> = {
  draft: "Draft",
  review: "Review",
  pending_approval: "Pending approval",
  posted: "Posted",
  cancelled: "Cancelled",
};

const REASON_LABEL: Record<StockCountReasonCode, string> = {
  damage: "Damage",
  theft: "Theft",
  expiry: "Expiry",
  shrinkage: "Shrinkage",
  miscount: "Miscount",
  sample: "Sample / giveaway",
  system_error: "System error",
  other: "Other",
};

function bpsToPercent(bps: number | null): string {
  if (bps === null) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}

export function StockCountClient({ count }: { count: StockCountDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local state for counted_qty while in draft — keyed by line id.
  const [countedDraft, setCountedDraft] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const l of count.lines) {
      out[l.id] = l.countedQty === null ? "" : String(l.countedQty);
    }
    return out;
  });

  // Local state for reason codes + notes while in review (or re-opened).
  const [reasonDraft, setReasonDraft] = useState<
    Record<string, { reasonCode: StockCountReasonCode | ""; notes: string }>
  >(() => {
    const out: Record<string, { reasonCode: StockCountReasonCode | ""; notes: string }> = {};
    for (const l of count.lines) {
      out[l.id] = {
        reasonCode: (l.reasonCode ?? "") as StockCountReasonCode | "",
        notes: l.notes ?? "",
      };
    }
    return out;
  });

  const isDraft = count.status === "draft";
  const isReview = count.status === "review";
  const isPending = count.status === "pending_approval";
  const isPosted = count.status === "posted";
  const isCancelled = count.status === "cancelled";
  const readOnly = isPosted || isCancelled;

  // Blind count: while in draft we hide the snapshot qty + cost from counters.
  const showSnapshot = !isDraft || !count.blindCount;

  const variantLines = useMemo(() => {
    return count.lines.filter((l) => l.varianceQty !== null && Number(l.varianceQty) !== 0);
  }, [count.lines]);

  const completedCount = count.lines.filter((l) => l.countedQty !== null).length;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  async function saveCountedQty() {
    setError(null);
    const patch: Array<{ lineId: string; countedQty: number }> = [];
    for (const l of count.lines) {
      const raw = countedDraft[l.id];
      if (raw === undefined || raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setError(`Line ${l.lineNo} (${l.itemSku}) has an invalid quantity.`);
        return;
      }
      // Only PATCH changed lines.
      if (l.countedQty === null || Number(l.countedQty) !== n) {
        patch.push({ lineId: l.id, countedQty: n });
      }
    }
    if (patch.length === 0) {
      router.refresh();
      return;
    }
    setBusy(true);
    try {
      await api.updateStockCountLines(count.id, { lines: patch });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function moveToReview() {
    setError(null);
    // Require all lines counted before moving on.
    const uncounted = count.lines.filter((l) => {
      const raw = countedDraft[l.id];
      return raw === undefined || raw === "";
    });
    if (uncounted.length > 0) {
      setError(`Fill in counted qty for every line before review (${uncounted.length} remaining).`);
      return;
    }
    setBusy(true);
    try {
      // Save any outstanding draft changes first.
      const patch: Array<{ lineId: string; countedQty: number }> = [];
      for (const l of count.lines) {
        const raw = countedDraft[l.id] ?? "";
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          setError(`Line ${l.lineNo} (${l.itemSku}) has an invalid quantity.`);
          setBusy(false);
          return;
        }
        if (l.countedQty === null || Number(l.countedQty) !== n) {
          patch.push({ lineId: l.id, countedQty: n });
        }
      }
      if (patch.length > 0) {
        await api.updateStockCountLines(count.id, { lines: patch });
      }
      await api.reviewStockCount(count.id, {});
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "MISSING_REASON") {
        // Shouldn't happen on first review (reasons can be blank then), but
        // guard anyway.
        setError("Some lines need a reason code.");
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't move to review.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveReasons() {
    setError(null);

    // Build the reasons payload for every variance ≠ 0 line.
    const reasons: Array<{
      lineId: string;
      reasonCode: StockCountReasonCode;
      notes?: string;
    }> = [];
    for (const l of variantLines) {
      const draft = reasonDraft[l.id];
      if (!draft || !draft.reasonCode) {
        setError(`Pick a reason for line ${l.lineNo} (${l.itemSku}).`);
        return;
      }
      reasons.push({
        lineId: l.id,
        reasonCode: draft.reasonCode,
        notes: draft.notes.trim() || undefined,
      });
    }

    setBusy(true);
    try {
      const res = await api.reviewStockCount(count.id, { reasons });
      router.refresh();
      if (res.requiresApproval) {
        setError(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the review.");
    } finally {
      setBusy(false);
    }
  }

  async function doApprove() {
    setError(null);
    setBusy(true);
    try {
      await api.approveStockCount(count.id);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "SOD_VIOLATION") {
        setError("Approver must be different from the person who created the count.");
      } else {
        setError(err instanceof ApiError ? err.message : "Approval failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function doPost() {
    setError(null);
    if (!confirm("Post this count? This books a journal entry and writes stock ledger adjustments — it can't be undone.")) {
      return;
    }
    setBusy(true);
    try {
      await api.postStockCount(count.id);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "NEGATIVE_STOCK") {
        setError("Posting would drive one or more items to a negative on-hand. Re-count or cancel.");
      } else if (err instanceof ApiError && err.code === "GL_NOT_CONFIGURED") {
        setError("Chart of accounts is missing Inventory / Stock gain / Stock loss.");
      } else {
        setError(err instanceof ApiError ? err.message : "Posting failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function doCancel() {
    setError(null);
    const reason = prompt("Reason for cancelling? (optional)") ?? undefined;
    if (reason === null) return;
    setBusy(true);
    try {
      await api.cancelStockCount(count.id, reason?.trim() || undefined);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cancel failed.");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* Summary strip */}
      <section className="mt-4 grid gap-3 sm:grid-cols-4">
        <SummaryCell
          label="Status"
          value={
            <span
              className={`inline-flex items-center gap-1 rounded-full border-hairline px-2 py-0.5 text-caption font-medium ${STATUS_CLASS[count.status]}`}
            >
              {STATUS_LABEL[count.status]}
            </span>
          }
        />
        <SummaryCell label="Count date" value={formatDate(count.countDate)} />
        <SummaryCell
          label="Progress"
          value={`${completedCount} / ${count.lines.length} lines`}
        />
        <SummaryCell
          label={isDraft ? "Threshold" : "Max variance"}
          value={
            isDraft
              ? `${(count.varianceThresholdBps / 100).toFixed(2)}%`
              : bpsToPercent(count.maxVarianceBps)
          }
        />
      </section>

      {/* Net variance banner for review+ */}
      {!isDraft && count.totalVarianceValueCents !== null && (
        <div className="mt-3 rounded-card border-hairline border-border bg-surface-elevated px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Net variance value</p>
              <p className="mt-0.5 text-body font-medium tabular-nums">
                {formatLKR(count.totalVarianceValueCents)}
                <span className="ml-2 text-caption text-text-tertiary">
                  ({count.totalVarianceValueCents >= 0 ? "net gain" : "net loss"})
                </span>
              </p>
            </div>
            {count.requiresApproval && !isPosted && !isCancelled && (
              <span className="inline-flex items-center gap-1 text-caption text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                Over threshold — approval required
              </span>
            )}
          </div>
        </div>
      )}

      {count.notes && (
        <p className="mt-3 text-caption text-text-tertiary">Note: {count.notes}</p>
      )}

      {/* Cancelled banner */}
      {isCancelled && (
        <div className="mt-3 rounded-card border-hairline border-danger/40 bg-danger-bg/60 px-4 py-3 text-small text-danger">
          Cancelled{count.cancelledReason ? `: ${count.cancelledReason}` : "."}
        </div>
      )}

      {/* Posted banner */}
      {isPosted && count.countNumber && (
        <div className="mt-3 rounded-card border-hairline border-mint/40 bg-mint-surface/60 px-4 py-3 text-small text-mint-dark">
          Posted as {count.countNumber} on {count.postedAt ? formatDate(count.postedAt.slice(0, 10)) : "—"}.
        </div>
      )}

      {/* Lines table */}
      <section className="mt-5 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <header className="flex items-center justify-between border-b-hairline border-border px-5 py-3">
          <h2 className="text-body font-medium text-charcoal">Lines</h2>
          <span className="text-caption text-text-tertiary">
            {isDraft && count.blindCount
              ? "Blind count — enter what's on the shelf. System quantities are hidden until review."
              : "Variance = counted − system. Non-zero variance lines need a reason code at review."}
          </span>
        </header>
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-12 px-4 py-2 text-right">#</th>
              <th className="px-4 py-2 text-left">Item</th>
              {showSnapshot && (
                <>
                  <th className="w-28 px-4 py-2 text-right">System qty</th>
                  <th className="w-28 px-4 py-2 text-right">Avg cost</th>
                </>
              )}
              <th className="w-28 px-4 py-2 text-right">Counted</th>
              {!isDraft && <th className="w-28 px-4 py-2 text-right">Variance</th>}
              {!isDraft && <th className="w-32 px-4 py-2 text-right">Value</th>}
              {!isDraft && <th className="w-44 px-4 py-2 text-left">Reason</th>}
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {count.lines.map((l) => (
              <LineRow
                key={l.id}
                line={l}
                isDraft={isDraft}
                isReview={isReview}
                isPending={isPending}
                showSnapshot={showSnapshot}
                readOnly={readOnly}
                countedDraft={countedDraft[l.id] ?? ""}
                setCountedDraft={(v) =>
                  setCountedDraft((prev) => ({ ...prev, [l.id]: v }))
                }
                reasonDraft={reasonDraft[l.id] ?? { reasonCode: "", notes: "" }}
                setReasonDraft={(v) =>
                  setReasonDraft((prev) => ({ ...prev, [l.id]: v }))
                }
              />
            ))}
          </tbody>
        </table>
      </section>

      {error && <p className="mt-3 text-caption text-danger">{error}</p>}

      {/* Action bar */}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {isDraft && (
          <>
            <button
              type="button"
              onClick={saveCountedQty}
              disabled={busy}
              className="btn-ghost inline-flex items-center gap-2 text-small disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save progress
            </button>
            <button
              type="button"
              onClick={doCancel}
              disabled={busy}
              className="btn-ghost inline-flex items-center gap-2 text-small text-danger disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              Cancel count
            </button>
            <button
              type="button"
              onClick={moveToReview}
              disabled={busy}
              className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Move to review
            </button>
          </>
        )}

        {(isReview || isPending) && (
          <>
            <button
              type="button"
              onClick={doCancel}
              disabled={busy}
              className="btn-ghost inline-flex items-center gap-2 text-small text-danger disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              Cancel count
            </button>
            {variantLines.length > 0 && (
              <button
                type="button"
                onClick={saveReasons}
                disabled={busy}
                className="btn-ghost inline-flex items-center gap-2 text-small disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save reasons
              </button>
            )}
            {isPending && (
              <button
                type="button"
                onClick={doApprove}
                disabled={busy}
                className="btn-ghost inline-flex items-center gap-2 text-small disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Approve
              </button>
            )}
            {isReview && (
              <button
                type="button"
                onClick={doPost}
                disabled={busy}
                className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Post count
              </button>
            )}
          </>
        )}

        {isPosted && (
          <span className="inline-flex items-center gap-1 text-caption text-mint-dark">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Immutable audit record.
          </span>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated px-4 py-3">
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <div className="mt-0.5 text-small text-charcoal">{value}</div>
    </div>
  );
}

function LineRow({
  line,
  isDraft,
  isReview,
  isPending,
  showSnapshot,
  readOnly,
  countedDraft,
  setCountedDraft,
  reasonDraft,
  setReasonDraft,
}: {
  line: StockCountLineRow;
  isDraft: boolean;
  isReview: boolean;
  isPending: boolean;
  showSnapshot: boolean;
  readOnly: boolean;
  countedDraft: string;
  setCountedDraft: (v: string) => void;
  reasonDraft: { reasonCode: StockCountReasonCode | ""; notes: string };
  setReasonDraft: (v: { reasonCode: StockCountReasonCode | ""; notes: string }) => void;
}) {
  const variance = line.varianceQty === null ? null : Number(line.varianceQty);
  const varianceCents = line.varianceValueCents;
  const reasonEditable = (isReview || isPending) && !readOnly && variance !== null && variance !== 0;

  return (
    <tr>
      <td className="px-4 py-2 text-right tabular-nums text-text-tertiary">{line.lineNo}</td>
      <td className="px-4 py-2">
        <div className="text-small text-charcoal">{line.itemName}</div>
        <div className="text-caption text-text-tertiary">
          {line.itemSku}
          {line.itemUom ? ` · ${line.itemUom}` : ""}
        </div>
      </td>
      {showSnapshot && (
        <>
          <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
            {line.systemQty.toFixed(4)}
          </td>
          <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
            {formatLKR(line.systemAvgCostCents)}
          </td>
        </>
      )}
      <td className="px-4 py-2">
        {isDraft && !readOnly ? (
          <input
            type="number"
            step="0.01"
            min={0}
            value={countedDraft}
            onChange={(e) => setCountedDraft(e.target.value)}
            placeholder="—"
            className="input w-full text-right tabular-nums"
          />
        ) : (
          <span className="block text-right tabular-nums text-text-secondary">
            {line.countedQty === null ? "—" : Number(line.countedQty).toFixed(4)}
          </span>
        )}
      </td>
      {!isDraft && (
        <td className="px-4 py-2 text-right tabular-nums">
          {variance === null ? (
            <span className="text-text-tertiary">—</span>
          ) : variance === 0 ? (
            <span className="text-text-tertiary">0</span>
          ) : (
            <span className={variance > 0 ? "text-mint-dark" : "text-danger"}>
              {variance > 0 ? "+" : ""}
              {variance.toFixed(4)}
            </span>
          )}
        </td>
      )}
      {!isDraft && (
        <td className="px-4 py-2 text-right tabular-nums">
          {varianceCents === null || varianceCents === 0 ? (
            <span className="text-text-tertiary">—</span>
          ) : (
            <span className={varianceCents > 0 ? "text-mint-dark" : "text-danger"}>
              {formatLKR(varianceCents)}
            </span>
          )}
        </td>
      )}
      {!isDraft && (
        <td className="px-4 py-2">
          {variance !== null && variance !== 0 ? (
            reasonEditable ? (
              <div className="space-y-1">
                <select
                  value={reasonDraft.reasonCode}
                  onChange={(e) =>
                    setReasonDraft({
                      ...reasonDraft,
                      reasonCode: e.target.value as StockCountReasonCode | "",
                    })
                  }
                  className="input w-full"
                >
                  <option value="">Select…</option>
                  {(Object.keys(REASON_LABEL) as StockCountReasonCode[]).map((r) => (
                    <option key={r} value={r}>
                      {REASON_LABEL[r]}
                    </option>
                  ))}
                </select>
                <input
                  value={reasonDraft.notes}
                  onChange={(e) =>
                    setReasonDraft({ ...reasonDraft, notes: e.target.value })
                  }
                  placeholder="(optional note)"
                  className="input w-full text-caption"
                />
              </div>
            ) : (
              <div>
                <div className="text-small">
                  {line.reasonCode ? REASON_LABEL[line.reasonCode] : (
                    <span className="text-danger">Reason needed</span>
                  )}
                </div>
                {line.notes && <div className="text-caption text-text-tertiary">{line.notes}</div>}
              </div>
            )
          ) : (
            <span className="text-text-tertiary">—</span>
          )}
        </td>
      )}
    </tr>
  );
}
