"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, Loader2, X, XCircle, ArrowRight } from "lucide-react";
import { api, ApiError, type ApprovalRequest } from "@/lib/api";
import { formatDate, formatLKR } from "@/lib/format";

type Scope = "mine" | "submitted_by_me" | "all";

// Cross-document approvals queue client — roadmap #43.
//
// Three tabs:
//   - Mine           → steps waiting on me (server returns pending-only).
//   - Submitted by me → my outgoing requests across every status.
//   - All             → tenant-wide, including archived decisions.
//
// Actions (approve / reject / cancel) are wired via api.* helpers.
// After any action we router.refresh() so the server-rendered page
// re-fetches; keeps the data model simple (no optimistic local state).
export function ApprovalsQueueClient({
  mine,
  submitted,
  all,
}: {
  mine: ApprovalRequest[];
  submitted: ApprovalRequest[];
  all: ApprovalRequest[];
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>(
    mine.length > 0 ? "mine" : submitted.length > 0 ? "submitted_by_me" : "all",
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decideDialog, setDecideDialog] = useState<{
    request: ApprovalRequest;
    kind: "reject" | "cancel";
  } | null>(null);

  const rows = scope === "mine" ? mine : scope === "submitted_by_me" ? submitted : all;

  async function approve(request: ApprovalRequest) {
    setError(null);
    setBusyId(request.id);
    try {
      await api.approveApprovalRequest(request.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't approve.");
    } finally {
      setBusyId(null);
    }
  }

  const tabs: Array<{ key: Scope; label: string; count: number }> = useMemo(
    () => [
      { key: "mine", label: "Waiting on me", count: mine.length },
      { key: "submitted_by_me", label: "Submitted by me", count: submitted.length },
      { key: "all", label: "All", count: all.length },
    ],
    [mine.length, submitted.length, all.length],
  );

  return (
    <div className="mt-6 space-y-5">
      <div role="tablist" className="flex gap-1 rounded-card border-hairline border-border bg-surface-elevated p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={scope === t.key}
            onClick={() => setScope(t.key)}
            className={`flex-1 rounded-[var(--radius-card)_-4px] px-3 py-2 text-small transition ${
              scope === t.key
                ? "bg-surface-recessed text-charcoal"
                : "text-text-secondary hover:text-charcoal"
            }`}
          >
            {t.label}
            <span className="ml-1 text-caption text-text-tertiary">({t.count})</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-card border-hairline border-danger/40 bg-danger-bg/60 px-4 py-3 text-small text-danger">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-10 text-center text-caption text-text-tertiary">
          Nothing in this bucket.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              scope={scope}
              busy={busyId === r.id}
              onApprove={() => approve(r)}
              onReject={() => setDecideDialog({ request: r, kind: "reject" })}
              onCancel={() => setDecideDialog({ request: r, kind: "cancel" })}
            />
          ))}
        </div>
      )}

      {decideDialog && (
        <ReasonDialog
          request={decideDialog.request}
          kind={decideDialog.kind}
          onCancel={() => setDecideDialog(null)}
          onDone={() => {
            setDecideDialog(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function RequestCard({
  request,
  scope,
  busy,
  onApprove,
  onReject,
  onCancel,
}: {
  request: ApprovalRequest;
  scope: Scope;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const isPending = request.status === "pending";
  const docRoute = deepLinkFor(request);
  const docLabel = prettyDocType(request.documentType);

  return (
    <article className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="text-small font-medium text-charcoal">
            {docLabel}
            {request.amountCents != null && (
              <span className="ml-2 text-caption text-text-tertiary tabular-nums">
                {formatLKR(request.amountCents)}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-caption text-text-tertiary">
            Submitted {formatDate(request.createdAt.slice(0, 10))} · Step {Math.min(request.currentStepIdx + 1, request.stepsTotal)} of {request.stepsTotal}
            {request.decidedAt && (
              <> · Decided {formatDate(request.decidedAt.slice(0, 10))}</>
            )}
          </p>
          {request.decisionReason && (
            <p className="mt-1 max-w-prose text-caption italic text-text-secondary">
              &ldquo;{request.decisionReason}&rdquo;
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={request.status} />
          {docRoute && (
            <Link href={docRoute} className="btn-link inline-flex items-center gap-1 text-caption">
              View document <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
          {isPending && scope === "mine" && (
            <>
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
                Approve
              </button>
            </>
          )}
          {isPending && scope === "submitted_by_me" && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="btn-ghost inline-flex items-center gap-1 text-small disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden />
              Withdraw
            </button>
          )}
        </div>
      </header>
    </article>
  );
}

function StatusBadge({ status }: { status: ApprovalRequest["status"] }) {
  const cls: Record<ApprovalRequest["status"], string> = {
    pending: "bg-amber-surface/60 text-amber-dark",
    approved: "bg-mint-surface/60 text-mint-dark",
    rejected: "bg-danger-bg/60 text-danger",
    cancelled: "bg-surface-recessed text-text-tertiary",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-caption ${cls[status]}`}>
      {status[0]!.toUpperCase() + status.slice(1)}
    </span>
  );
}

function ReasonDialog({
  request,
  kind,
  onCancel,
  onDone,
}: {
  request: ApprovalRequest;
  kind: "reject" | "cancel";
  onCancel: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isReject = kind === "reject";

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (isReject) await api.rejectApprovalRequest(request.id, reason.trim() || undefined);
      else await api.cancelApprovalRequest(request.id, reason.trim() || undefined);
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save decision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4">
      <div className="w-full max-w-md rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-lg">
        <h3 className="text-body font-medium text-charcoal">
          {isReject ? "Reject request" : "Withdraw submission"}
        </h3>
        <p className="mt-1 text-caption text-text-secondary">
          {prettyDocType(request.documentType)}
          {request.amountCents != null && <> · {formatLKR(request.amountCents)}</>}
        </p>
        <label className="mt-4 block text-caption uppercase tracking-wide text-text-tertiary">
          Reason {isReject ? "" : "(optional)"}
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder={
            isReject
              ? "e.g. Missing supporting doc; wrong GL"
              : "e.g. Submitted in error; re-drafting"
          }
          className="input mt-1.5 w-full"
        />
        {error && <p className="mt-2 text-caption text-danger">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost text-small">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || (isReject && !reason.trim())}
            className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isReject ? "Reject" : "Withdraw"}
          </button>
        </div>
      </div>
    </div>
  );
}

function prettyDocType(kind: string): string {
  const map: Record<string, string> = {
    journal_entry: "Journal entry",
    expense_claim: "Expense claim",
    bill: "Supplier bill",
    purchase_order: "Purchase order",
    payroll_run: "Payroll run",
    bonus_run: "Bonus run",
    final_settlement: "Final settlement",
    invoice: "Invoice",
  };
  return map[kind] ?? kind.replace(/_/g, " ");
}

// Deep-link the "view document" affordance to the domain route. Wired
// document types get a route; others return null and the UI hides the
// link until their PRs land.
function deepLinkFor(request: ApprovalRequest): string | null {
  if (request.documentType === "journal_entry") {
    // The underlying row is a journal_entry_drafts id, not a posted
    // entry. The JE approvals page already has a per-draft view.
    return `/app/journals/approvals`;
  }
  if (request.documentType === "expense_claim") {
    // documentId is the expense_claims.id — drop straight onto the
    // per-claim detail page.
    return `/app/expense-claims/${request.documentId}`;
  }
  if (request.documentType === "bill") {
    // roadmap #43b — documentId is the bills.id. The detail page shows
    // lines/charges and a post button, which is what an approver or
    // submitter needs when revisiting from the queue.
    return `/app/bills/${request.documentId}`;
  }
  if (request.documentType === "purchase_order") {
    // roadmap #43c — documentId is the purchase_orders.id. The detail
    // page shows lines + the "Awaiting approval" banner and is where
    // the approver / submitter revisits from the queue.
    return `/app/purchase-orders/${request.documentId}`;
  }
  if (request.documentType === "payroll_run") {
    // roadmap #43d — documentId is payroll_runs.id. Detail page carries
    // the per-employee breakdown + post/pay affordances that the
    // approver needs context on.
    return `/app/payroll/${request.documentId}`;
  }
  if (request.documentType === "bonus_run") {
    // roadmap #43d — documentId is bonus_runs.id.
    return `/app/bonus-runs/${request.documentId}`;
  }
  if (request.documentType === "final_settlement") {
    // roadmap #43e — documentId is final_settlements.id. Detail page
    // shows the settlement worksheet + the "Awaiting approval" banner
    // so an approver can see the full exit calc before signing off.
    return `/app/final-settlements/${request.documentId}`;
  }
  return null;
}
