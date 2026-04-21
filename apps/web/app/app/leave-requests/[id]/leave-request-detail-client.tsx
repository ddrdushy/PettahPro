"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check, Loader2, Send, X } from "lucide-react";
import {
  api,
  ApiError,
  type LeaveRequestDetail,
  type LeaveRequestStatus,
  type LeaveType,
  type Employee,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

const statusStyles: Record<LeaveRequestStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  pending: "bg-warning-bg text-warning",
  approved: "bg-mint text-mint-dark",
  rejected: "bg-danger-bg/60 text-danger",
  cancelled: "bg-surface-recessed text-text-secondary",
};

const statusLabels: Record<LeaveRequestStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

type ActionKind = "submit" | "approve" | "reject" | "cancel" | null;

export function LeaveRequestDetailClient({
  leaveRequest,
  employee,
  leaveType,
}: {
  leaveRequest: LeaveRequestDetail;
  employee: Employee | null;
  leaveType: LeaveType | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<ActionKind>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: Exclude<ActionKind, null>) {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "submit") await api.submitLeaveRequest(leaveRequest.id);
      else if (kind === "approve") await api.approveLeaveRequest(leaveRequest.id);
      else if (kind === "reject") {
        const reason = window.prompt("Reason for rejection (optional):") ?? undefined;
        await api.rejectLeaveRequest(leaveRequest.id, reason || undefined);
      } else if (kind === "cancel") {
        if (!confirm(leaveRequest.status === "approved"
          ? "Cancel this approved leave? The days will be refunded to the employee's balance."
          : "Cancel this leave request?"))
        {
          setBusy(null);
          return;
        }
        await api.cancelLeaveRequest(leaveRequest.id);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const canSubmit = leaveRequest.status === "draft";
  const canApprove = leaveRequest.status === "pending";
  const canReject = leaveRequest.status === "pending" || leaveRequest.status === "draft";
  const canCancel = leaveRequest.status !== "cancelled";

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/leave-requests" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to leave requests
        </Link>
      </div>

      <PageHeader
        eyebrow={`HR · ${leaveType?.code ?? "Leave"}`}
        title={employee?.fullName ?? "Leave request"}
        description={`${formatDate(leaveRequest.fromDate)} — ${formatDate(leaveRequest.toDate)} · ${Number(leaveRequest.daysCount)} day${Number(leaveRequest.daysCount) === 1 ? "" : "s"}${leaveType ? ` · ${leaveType.name}` : ""}`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[leaveRequest.status]}`}>
              {statusLabels[leaveRequest.status]}
            </span>
            {canSubmit && (
              <button type="button" onClick={() => run("submit")} disabled={busy !== null} className="btn-secondary">
                {busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                Submit
              </button>
            )}
            {canApprove && (
              <button type="button" onClick={() => run("approve")} disabled={busy !== null} className="btn-primary">
                {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                Approve
              </button>
            )}
            {canReject && (
              <button type="button" onClick={() => run("reject")} disabled={busy !== null} className="btn-secondary">
                {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                Reject
              </button>
            )}
            {canCancel && (
              <button type="button" onClick={() => run("cancel")} disabled={busy !== null} className="btn-secondary">
                {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                Cancel
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div className="mt-4 rounded-card border-hairline border-danger/40 bg-danger-bg/40 px-5 py-3 text-small text-danger">
          {error}
        </div>
      )}

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="From" value={formatDate(leaveRequest.fromDate)} />
        <Stat label="To" value={formatDate(leaveRequest.toDate)} />
        <Stat label="Days" value={Number(leaveRequest.daysCount).toString()} emphasis />
      </section>

      {leaveType && (
        <div className="mt-4 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small text-text-secondary">
          {leaveType.isPaid ? (
            <>Paid leave — salary is not affected.</>
          ) : (
            <>Unpaid leave — reduces salary proportionally when the payroll run picks it up.</>
          )}
        </div>
      )}

      {leaveRequest.reason && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Reason</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{leaveRequest.reason}</p>
        </section>
      )}

      {leaveRequest.status === "rejected" && leaveRequest.rejectedReason && (
        <div className="mt-6 rounded-card border-hairline border-danger/40 bg-danger-bg/40 px-5 py-3 text-small text-text-primary">
          <span className="text-text-secondary">Rejection reason: </span>
          {leaveRequest.rejectedReason}
        </div>
      )}

      <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
        <p className="text-caption uppercase tracking-wide text-text-tertiary">Timeline</p>
        <dl className="mt-3 grid gap-2 text-small sm:grid-cols-2">
          <TimelineRow label="Created" at={leaveRequest.createdAt} />
          <TimelineRow label="Submitted" at={leaveRequest.submittedAt} />
          <TimelineRow label="Approved" at={leaveRequest.approvedAt} />
          <TimelineRow label="Rejected" at={leaveRequest.rejectedAt} />
          <TimelineRow label="Cancelled" at={leaveRequest.cancelledAt} />
        </dl>
      </section>
    </main>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-card border-hairline p-5 ${emphasis ? "border-charcoal/20 bg-mint-surface/40" : "border-border bg-surface-elevated"}`}>
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-2 text-h3 text-charcoal">{value}</p>
    </div>
  );
}

function TimelineRow({ label, at }: { label: string; at: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 text-caption text-text-tertiary">{label}</dt>
      <dd className="tabular-nums text-text-primary">
        {at ? formatDate(at.slice(0, 10)) : <span className="text-text-tertiary">—</span>}
      </dd>
    </div>
  );
}
