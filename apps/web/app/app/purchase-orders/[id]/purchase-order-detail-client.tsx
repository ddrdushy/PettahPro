"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, Loader2, Send, X } from "lucide-react";
import {
  api,
  ApiError,
  type PurchaseOrderDetail,
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
  type Supplier,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const statusStyles: Record<PurchaseOrderStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  sent: "bg-mint-surface text-mint-dark",
  acknowledged: "bg-mint text-mint-dark",
  cancelled: "bg-danger-bg/60 text-danger",
  converted: "bg-charcoal text-offwhite",
};

const statusLabels: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  acknowledged: "Acknowledged",
  cancelled: "Cancelled",
  converted: "Converted",
};

type ActionKind = "send" | "acknowledge" | "cancel" | "convert" | null;

export function PurchaseOrderDetailClient({
  purchaseOrder,
  lines,
  supplier,
}: {
  purchaseOrder: PurchaseOrderDetail;
  lines: PurchaseOrderLine[];
  supplier: Supplier | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<ActionKind>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: Exclude<ActionKind, null>) {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "send") await api.sendPurchaseOrder(purchaseOrder.id);
      else if (kind === "acknowledge") {
        const ref = window.prompt("Supplier's acknowledgement reference (optional):") ?? undefined;
        await api.acknowledgePurchaseOrder(purchaseOrder.id, ref || undefined);
      } else if (kind === "cancel") {
        const reason = window.prompt("Reason for cancelling (optional):") ?? undefined;
        await api.cancelPurchaseOrder(purchaseOrder.id, reason || undefined);
      } else if (kind === "convert") {
        if (!confirm("Create a draft bill from this purchase order?")) {
          setBusy(null);
          return;
        }
        const res = await api.convertPurchaseOrder(purchaseOrder.id);
        router.push(`/app/bills/${res.billId}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const canSend = purchaseOrder.status === "draft";
  const canAck = purchaseOrder.status === "sent" || purchaseOrder.status === "draft";
  const canCancel = purchaseOrder.status !== "converted" && purchaseOrder.status !== "cancelled";
  const canConvert = purchaseOrder.status !== "converted" && purchaseOrder.status !== "cancelled";

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/purchase-orders" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to purchase orders
        </Link>
      </div>

      <PageHeader
        eyebrow="Buy · Purchase order"
        title={purchaseOrder.poNumber ?? (purchaseOrder.status === "draft" ? "Draft PO" : "Purchase order")}
        description={
          supplier
            ? `${supplier.name}${supplier.vatNo ? ` · VAT ${supplier.vatNo}` : ""} · Ordered ${formatDate(purchaseOrder.orderDate)}${purchaseOrder.expectedDeliveryDate ? ` · Expected ${formatDate(purchaseOrder.expectedDeliveryDate)}` : ""}`
            : `Ordered ${formatDate(purchaseOrder.orderDate)}`
        }
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[purchaseOrder.status]}`}>
              {statusLabels[purchaseOrder.status]}
            </span>
            <a
              href={`/app/purchase-orders/${purchaseOrder.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="btn-secondary inline-flex items-center gap-2"
            >
              <Download className="h-4 w-4" aria-hidden />
              PDF
            </a>
            {canSend && (
              <button type="button" onClick={() => run("send")} disabled={busy !== null} className="btn-secondary">
                {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                Send
              </button>
            )}
            {canAck && (
              <button type="button" onClick={() => run("acknowledge")} disabled={busy !== null} className="btn-secondary">
                {busy === "acknowledge" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                Acknowledge
              </button>
            )}
            {canCancel && (
              <button type="button" onClick={() => run("cancel")} disabled={busy !== null} className="btn-secondary">
                {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                Cancel
              </button>
            )}
            {canConvert && (
              <button type="button" onClick={() => run("convert")} disabled={busy !== null} className="btn-primary">
                {busy === "convert" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                Convert to bill
              </button>
            )}
          </div>
        }
      />

      {purchaseOrder.convertedBillId && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small">
          <span className="text-text-secondary">Converted to bill </span>
          <Link href={`/app/bills/${purchaseOrder.convertedBillId}`} className="btn-link text-small">
            View bill →
          </Link>
          {purchaseOrder.convertedAt && (
            <span className="ml-2 text-caption text-text-tertiary">on {formatDate(purchaseOrder.convertedAt.slice(0, 10))}</span>
          )}
        </div>
      )}

      {purchaseOrder.supplierReference && (
        <div className="mt-3 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small text-text-secondary">
          Supplier's acknowledgement reference: <span className="tabular-nums text-charcoal">{purchaseOrder.supplierReference}</span>
        </div>
      )}

      {purchaseOrder.status === "cancelled" && purchaseOrder.cancelledReason && (
        <div className="mt-6 rounded-card border-hairline border-danger/40 bg-danger-bg/40 px-5 py-3 text-small text-text-primary">
          <span className="text-text-secondary">Cancelled: </span>{purchaseOrder.cancelledReason}
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
              <th className="w-20 px-4 py-3 text-right">Qty</th>
              <th className="w-28 px-4 py-3 text-right">Unit price</th>
              <th className="w-24 px-4 py-3 text-right">Subtotal</th>
              <th className="w-24 px-4 py-3 text-right">Discount</th>
              <th className="w-24 px-4 py-3 text-right">Tax</th>
              <th className="w-28 px-4 py-3 text-right">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 text-center tabular-nums text-text-tertiary">{l.lineNo}</td>
                <td className="px-4 py-3 text-charcoal">{l.description}</td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{Number(l.quantity)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatLKR(l.unitPriceCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatLKR(l.lineSubtotalCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {l.discountCents > 0 ? formatLKR(l.discountCents) : <span className="text-text-tertiary">—</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {l.taxCents > 0 ? formatLKR(l.taxCents) : <span className="text-text-tertiary">—</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(l.lineTotalCents)}</td>
              </tr>
            ))}
            <tr className="bg-surface-recessed/50">
              <td className="px-4 py-2" />
              <td className="px-4 py-2 text-caption text-text-secondary" colSpan={3}>Subtotal</td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{formatLKR(purchaseOrder.subtotalCents)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{purchaseOrder.discountCents > 0 ? formatLKR(purchaseOrder.discountCents) : "—"}</td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{purchaseOrder.taxCents > 0 ? formatLKR(purchaseOrder.taxCents) : "—"}</td>
              <td className="px-4 py-2" />
            </tr>
            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-charcoal" colSpan={6}>Purchase order total</td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(purchaseOrder.totalCents)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {purchaseOrder.terms && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Terms</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{purchaseOrder.terms}</p>
        </section>
      )}

      {purchaseOrder.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Internal notes</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{purchaseOrder.notes}</p>
        </section>
      )}
    </main>
  );
}
