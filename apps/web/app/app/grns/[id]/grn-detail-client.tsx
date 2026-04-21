"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import {
  api,
  ApiError,
  type GrnDetail,
  type GrnLine,
  type GrnStatus,
  type Supplier,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

const statusStyles: Record<GrnStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  received: "bg-mint text-mint-dark",
  cancelled: "bg-danger-bg/60 text-danger",
};

const statusLabels: Record<GrnStatus, string> = {
  draft: "Draft",
  received: "Received",
  cancelled: "Cancelled",
};

type ActionKind = "receive" | "cancel" | null;

export function GrnDetailClient({
  grn,
  lines,
  supplier,
}: {
  grn: GrnDetail;
  lines: GrnLine[];
  supplier: Supplier | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<ActionKind>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: Exclude<ActionKind, null>) {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "receive") await api.receiveGrn(grn.id);
      else if (kind === "cancel") {
        const reason = window.prompt("Reason for cancelling (optional):") ?? undefined;
        await api.cancelGrn(grn.id, reason || undefined);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const canReceive = grn.status === "draft";
  const canCancel = grn.status !== "cancelled";

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/grns" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to GRNs
        </Link>
      </div>

      <PageHeader
        eyebrow="Buy · GRN"
        title={grn.grnNumber ?? (grn.status === "draft" ? "Draft GRN" : "Goods received note")}
        description={
          supplier
            ? `${supplier.name} · Received ${formatDate(grn.receiptDate)}${grn.supplierDeliveryNote ? ` · Supplier DN ${grn.supplierDeliveryNote}` : ""}`
            : `Received ${formatDate(grn.receiptDate)}`
        }
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[grn.status]}`}>
              {statusLabels[grn.status]}
            </span>
            {canReceive && (
              <button type="button" onClick={() => run("receive")} disabled={busy !== null} className="btn-primary">
                {busy === "receive" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                Mark received
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

      {(grn.purchaseOrderId || grn.billId) && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small">
          {grn.purchaseOrderId && (
            <>
              <span className="text-text-secondary">Related PO: </span>
              <Link href={`/app/purchase-orders/${grn.purchaseOrderId}`} className="btn-link text-small">View →</Link>
            </>
          )}
          {grn.billId && (
            <>
              {grn.purchaseOrderId && <span className="mx-2 text-text-tertiary">·</span>}
              <span className="text-text-secondary">Related bill: </span>
              <Link href={`/app/bills/${grn.billId}`} className="btn-link text-small">View →</Link>
            </>
          )}
        </div>
      )}

      {grn.conditionNotes && (
        <section className="mt-6 rounded-card border-hairline border-warning-accent/40 bg-warning-bg/40 p-5">
          <p className="text-caption uppercase tracking-wide text-warning">Condition notes</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{grn.conditionNotes}</p>
        </section>
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
              <th className="w-28 px-4 py-3 text-right">Ordered</th>
              <th className="w-28 px-4 py-3 text-right">Received</th>
              <th className="px-4 py-3 text-left">Line notes</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 text-center tabular-nums text-text-tertiary">{l.lineNo}</td>
                <td className="px-4 py-3 text-charcoal">{l.description}</td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                  {l.quantityOrdered ? Number(l.quantityOrdered) : <span className="text-text-tertiary">—</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{Number(l.quantityReceived)}</td>
                <td className="px-4 py-3 text-text-secondary">
                  {l.lineNotes ?? <span className="text-text-tertiary">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {grn.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{grn.notes}</p>
        </section>
      )}

      {grn.status === "cancelled" && grn.cancelledReason && (
        <div className="mt-6 rounded-card border-hairline border-danger/40 bg-danger-bg/40 px-5 py-3 text-small">
          <span className="text-text-secondary">Cancelled: </span>{grn.cancelledReason}
        </div>
      )}
    </main>
  );
}
