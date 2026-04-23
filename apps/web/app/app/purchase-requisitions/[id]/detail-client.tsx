"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Send,
  X,
} from "lucide-react";
import {
  api,
  ApiError,
  type PurchaseRequisitionDetail,
  type PurchaseRequisitionStatus,
  type PurchaseRequisitionLineStatus,
  type Supplier,
  type Branch,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const statusStyles: Record<PurchaseRequisitionStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  pending_approval: "bg-warning-bg text-warning",
  approved: "bg-mint-surface text-mint-dark",
  rejected: "bg-danger-bg/60 text-danger",
  converted: "bg-charcoal text-offwhite",
  cancelled: "bg-surface-recessed text-text-tertiary",
};

const statusLabels: Record<PurchaseRequisitionStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  converted: "Converted",
  cancelled: "Cancelled",
};

const lineStatusStyles: Record<PurchaseRequisitionLineStatus, string> = {
  pending: "text-text-tertiary",
  approved: "text-mint-dark",
  rejected: "text-danger",
};

const lineStatusLabels: Record<PurchaseRequisitionLineStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

type ActionKind = "submit" | "approve" | "reject" | "cancel" | "convert" | null;

export function PurchaseRequisitionDetailClient({
  detail,
  suppliers,
  branches,
}: {
  detail: PurchaseRequisitionDetail;
  suppliers: Supplier[];
  branches: Branch[];
}) {
  const { purchaseRequisition: pr, lines } = detail;
  const router = useRouter();
  const [busy, setBusy] = useState<ActionKind>(null);
  const [error, setError] = useState<string | null>(null);

  const branch = branches.find((b) => b.id === pr.branchId) ?? null;
  const preferredSupplier =
    suppliers.find((s) => s.id === pr.preferredSupplierId) ?? null;

  async function run(kind: Exclude<ActionKind, null>) {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "submit") {
        await api.submitPurchaseRequisition(pr.id);
      } else if (kind === "approve") {
        // Approve-all path. Line-level rejection happens on the approvals
        // queue screen for policy-routed PRs; the detail page keeps the
        // decision simple for tenants without a policy.
        const res = await api.approvePurchaseRequisition(pr.id);
        if ("parked" in res && res.parked) {
          // Policy routed it instead of approving inline.
        }
      } else if (kind === "reject") {
        const reason = window.prompt("Reason for rejecting (optional):") ?? undefined;
        await api.rejectPurchaseRequisition(pr.id, {
          reason: reason || undefined,
        });
      } else if (kind === "cancel") {
        const reason = window.prompt("Reason for cancelling (optional):") ?? undefined;
        await api.cancelPurchaseRequisition(pr.id, {
          reason: reason || undefined,
        });
      } else if (kind === "convert") {
        if (!confirm("Create a draft purchase order from this requisition?")) {
          setBusy(null);
          return;
        }
        // Default to the preferred supplier if set; API rejects when no
        // supplier is resolvable.
        const body: { supplierId?: string } = {};
        if (pr.preferredSupplierId) body.supplierId = pr.preferredSupplierId;
        else {
          const picked = window.prompt(
            "No preferred supplier on this requisition. Enter the supplier ID to convert to:",
          );
          if (!picked) {
            setBusy(null);
            return;
          }
          body.supplierId = picked.trim();
        }
        const res = await api.convertPurchaseRequisition(pr.id, body);
        router.push(`/app/purchase-orders/${res.purchaseOrderId}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const canSubmit = pr.status === "draft";
  // Approve inline only when the PR is in draft and there's no parked
  // engine request — the approvals queue handles policy-routed ones.
  const canApprove =
    (pr.status === "draft" || pr.status === "pending_approval") &&
    !pr.approvalRequestId;
  const canReject =
    (pr.status === "draft" || pr.status === "pending_approval") &&
    !pr.approvalRequestId;
  const canCancel = pr.status === "draft" || pr.status === "pending_approval";
  const canConvert = pr.status === "approved";

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/purchase-requisitions" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to purchase requisitions
        </Link>
      </div>

      <PageHeader
        eyebrow="Buy · Purchase requisition"
        title={pr.prNumber ?? (pr.status === "draft" ? "Draft requisition" : "Purchase requisition")}
        description={[
          pr.purpose,
          pr.neededByDate ? `Needed by ${formatDate(pr.neededByDate)}` : null,
          branch ? `Branch: ${branch.name}` : null,
          preferredSupplier ? `Preferred supplier: ${preferredSupplier.name}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || `Created ${formatDate(pr.createdAt)}`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[pr.status]}`}
            >
              {statusLabels[pr.status]}
            </span>
            {canSubmit && (
              <button
                type="button"
                onClick={() => run("submit")}
                disabled={busy !== null}
                className="btn-secondary"
              >
                {busy === "submit" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-4 w-4" aria-hidden />
                )}
                Submit for approval
              </button>
            )}
            {canApprove && (
              <button
                type="button"
                onClick={() => run("approve")}
                disabled={busy !== null}
                className="btn-secondary"
              >
                {busy === "approve" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="h-4 w-4" aria-hidden />
                )}
                Approve
              </button>
            )}
            {canReject && (
              <button
                type="button"
                onClick={() => run("reject")}
                disabled={busy !== null}
                className="btn-secondary"
              >
                {busy === "reject" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <X className="h-4 w-4" aria-hidden />
                )}
                Reject
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() => run("cancel")}
                disabled={busy !== null}
                className="btn-secondary"
              >
                {busy === "cancel" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <X className="h-4 w-4" aria-hidden />
                )}
                Cancel
              </button>
            )}
            {canConvert && (
              <button
                type="button"
                onClick={() => run("convert")}
                disabled={busy !== null}
                className="btn-primary"
              >
                {busy === "convert" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <ArrowRight className="h-4 w-4" aria-hidden />
                )}
                Convert to PO
              </button>
            )}
          </div>
        }
      />

      {pr.status === "pending_approval" && pr.approvalRequestId && (
        <section className="mt-6 rounded-card border-hairline border-warning/40 bg-warning-bg p-5">
          <p className="text-caption uppercase tracking-wide text-warning">
            Awaiting approval
          </p>
          <p className="mt-1 text-small text-charcoal">
            A purchase requisition approval policy matched this submission.
            An approver needs to sign off before it can be converted to a PO.
          </p>
          <Link href="/app/approvals" className="btn-link mt-2 inline-flex text-small">
            Open approvals queue →
          </Link>
        </section>
      )}

      {pr.status === "converted" && pr.convertedPoId && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small">
          <span className="text-text-secondary">Converted to purchase order </span>
          <Link
            href={`/app/purchase-orders/${pr.convertedPoId}`}
            className="btn-link text-small"
          >
            View PO →
          </Link>
          {pr.convertedAt && (
            <span className="ml-2 text-caption text-text-tertiary">
              on {formatDate(pr.convertedAt.slice(0, 10))}
            </span>
          )}
        </div>
      )}

      {pr.status === "rejected" && pr.rejectedReason && (
        <div className="mt-6 rounded-card border-hairline border-danger/40 bg-danger-bg/40 px-5 py-3 text-small text-text-primary">
          <span className="text-text-secondary">Rejected: </span>
          {pr.rejectedReason}
        </div>
      )}

      {pr.status === "cancelled" && pr.cancelledReason && (
        <div className="mt-6 rounded-card border-hairline border-surface-recessed bg-surface-recessed/60 px-5 py-3 text-small text-text-primary">
          <span className="text-text-secondary">Cancelled: </span>
          {pr.cancelledReason}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-card border-hairline border-danger/40 bg-danger-bg/40 px-5 py-3 text-small text-danger">
          {error}
        </div>
      )}

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-12 px-4 py-3 text-center">#</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="w-24 px-4 py-3 text-right">Qty</th>
              <th className="w-32 px-4 py-3 text-right">Est. unit price</th>
              <th className="w-32 px-4 py-3 text-right">Est. line total</th>
              <th className="w-28 px-4 py-3 text-center">Line status</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 text-center tabular-nums text-text-tertiary">
                  {l.lineNo}
                </td>
                <td className="px-4 py-3 text-charcoal">
                  {l.description}
                  {l.lineRejectedReason && (
                    <p className="mt-1 text-caption text-danger">
                      Rejected: {l.lineRejectedReason}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                  {Number(l.quantity)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {l.estimatedUnitPriceCents !== null ? (
                    formatLKR(l.estimatedUnitPriceCents)
                  ) : (
                    <span className="text-text-tertiary">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                  {l.estimatedUnitPriceCents !== null ? (
                    formatLKR(l.estimatedLineTotalCents)
                  ) : (
                    <span className="text-text-tertiary">—</span>
                  )}
                </td>
                <td
                  className={`px-4 py-3 text-center text-caption font-medium ${lineStatusStyles[l.lineStatus]}`}
                >
                  {lineStatusLabels[l.lineStatus]}
                </td>
              </tr>
            ))}
            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-charcoal" colSpan={3}>
                Estimated total
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(pr.estimatedTotalCents)}
              </td>
              <td className="px-4 py-3" />
            </tr>
          </tbody>
        </table>
      </section>

      {pr.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">
            Notes
          </p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">
            {pr.notes}
          </p>
        </section>
      )}
    </main>
  );
}
