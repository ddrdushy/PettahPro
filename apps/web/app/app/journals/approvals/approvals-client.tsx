"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { api, ApiError, type JournalEntryDraft } from "@/lib/api";
import { formatDate, formatLKR } from "@/lib/format";

export function ApprovalsClient({
  pending,
  recent,
}: {
  pending: JournalEntryDraft[];
  recent: JournalEntryDraft[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectDialog, setRejectDialog] = useState<JournalEntryDraft | null>(null);

  async function approve(draft: JournalEntryDraft) {
    setError(null);
    setBusyId(draft.id);
    try {
      const res = await api.approveJournalDraft(draft.id);
      alert(`Posted as ${res.entryNumber}.`);
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Couldn't approve.";
      setError(msg);
      alert(msg);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-6 space-y-8">
      {error && (
        <div className="rounded-card border-hairline border-danger/40 bg-danger-bg/60 px-4 py-3 text-small text-danger">
          {error}
        </div>
      )}

      <section>
        <h2 className="text-body font-medium text-charcoal">
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-small text-text-secondary">Nothing pending right now.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {pending.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                busy={busyId === d.id}
                onApprove={() => approve(d)}
                onReject={() => setRejectDialog(d)}
              />
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <h2 className="text-body font-medium text-charcoal">Recent decisions</h2>
          <div className="mt-3 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <table className="w-full text-small">
              <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="w-28 px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Memo</th>
                  <th className="w-32 px-4 py-3 text-right">Total</th>
                  <th className="w-32 px-4 py-3 text-left">Decision</th>
                  <th className="w-32 px-4 py-3 text-left">Posted</th>
                </tr>
              </thead>
              <tbody className="divide-y-hairline divide-border">
                {recent.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(d.entryDate)}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {d.memo ?? "—"}
                      {d.status === "rejected" && d.rejectionReason && (
                        <p className="mt-0.5 text-caption italic text-text-tertiary">
                          Rejected: {d.rejectionReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(d.totalCents)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-caption ${
                          d.status === "approved"
                            ? "bg-mint-surface/60 text-mint-dark"
                            : "bg-danger-bg/60 text-danger"
                        }`}
                      >
                        {d.status === "approved" ? "Approved" : "Rejected"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {d.postedJournalEntryId ? (
                        <Link href={`/app/journals/${d.postedJournalEntryId}`} className="btn-link text-caption">
                          View →
                        </Link>
                      ) : (
                        <span className="text-caption text-text-tertiary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {rejectDialog && (
        <RejectDialog
          draft={rejectDialog}
          onCancel={() => setRejectDialog(null)}
          onDone={() => {
            setRejectDialog(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function DraftCard({
  draft,
  busy,
  onApprove,
  onReject,
}: {
  draft: JournalEntryDraft;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-hairline border-border px-5 py-4">
        <div>
          <p className="text-small font-medium text-charcoal">
            {draft.memo ?? "Manual journal entry"}
          </p>
          <p className="mt-0.5 text-caption text-text-tertiary">
            {formatDate(draft.entryDate)} · total {formatLKR(draft.totalCents)} · submitted {formatDate(draft.createdAt.slice(0, 10))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="btn-secondary inline-flex items-center gap-1 text-small disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="btn-primary inline-flex items-center gap-1 text-small disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve &amp; post
          </button>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="px-4 py-2 text-left">Account</th>
              <th className="px-4 py-2 text-left">Description</th>
              <th className="w-32 px-4 py-2 text-right">Debit</th>
              <th className="w-32 px-4 py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {draft.payload.lines.map((l, i) => (
              <tr key={i}>
                <td className="px-4 py-2 font-mono text-caption text-text-tertiary">
                  {l.accountId.slice(0, 8)}…
                </td>
                <td className="px-4 py-2 text-text-secondary">{l.description ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {l.drCents > 0 ? formatLKR(l.drCents) : "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {l.crCents > 0 ? formatLKR(l.crCents) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function RejectDialog({
  draft,
  onCancel,
  onDone,
}: {
  draft: JournalEntryDraft;
  onCancel: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!reason.trim()) return setError("Reason is required.");
    setBusy(true);
    try {
      await api.rejectJournalDraft(draft.id, reason.trim());
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reject.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4">
      <div className="w-full max-w-md rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-lg">
        <h3 className="text-body font-medium text-charcoal">Reject journal entry</h3>
        <p className="mt-1 text-caption text-text-secondary">
          {draft.memo ?? "Manual journal entry"} · {formatLKR(draft.totalCents)}
        </p>
        <label className="mt-4 block text-caption uppercase tracking-wide text-text-tertiary">Reason</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. Wrong GL accounts; missing supporting doc"
          className="input mt-1.5 w-full"
        />
        {error && <p className="mt-2 text-caption text-danger">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost text-small">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !reason.trim()}
            className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
