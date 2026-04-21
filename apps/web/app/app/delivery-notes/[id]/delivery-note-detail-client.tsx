"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import {
  api,
  ApiError,
  type DeliveryNoteDetail,
  type DeliveryNoteLine,
  type DeliveryNoteStatus,
  type Customer,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

const statusStyles: Record<DeliveryNoteStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  delivered: "bg-mint text-mint-dark",
  cancelled: "bg-danger-bg/60 text-danger",
};

const statusLabels: Record<DeliveryNoteStatus, string> = {
  draft: "Draft",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

type ActionKind = "deliver" | "cancel" | null;

export function DeliveryNoteDetailClient({
  deliveryNote,
  lines,
  customer,
}: {
  deliveryNote: DeliveryNoteDetail;
  lines: DeliveryNoteLine[];
  customer: Customer | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<ActionKind>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: Exclude<ActionKind, null>) {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "deliver") {
        const name = window.prompt("Who signed for it? (optional)") ?? undefined;
        await api.deliverDeliveryNote(deliveryNote.id, name || undefined);
      } else if (kind === "cancel") {
        const reason = window.prompt("Reason for cancelling (optional):") ?? undefined;
        await api.cancelDeliveryNote(deliveryNote.id, reason || undefined);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const canDeliver = deliveryNote.status === "draft";
  const canCancel = deliveryNote.status !== "cancelled";

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/delivery-notes" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to delivery notes
        </Link>
      </div>

      <PageHeader
        eyebrow="Sell · Delivery note"
        title={deliveryNote.dnNumber ?? (deliveryNote.status === "draft" ? "Draft DN" : "Delivery note")}
        description={
          customer
            ? `${customer.name} · Delivery ${formatDate(deliveryNote.deliveryDate)}${deliveryNote.carrier ? ` · via ${deliveryNote.carrier}` : ""}`
            : `Delivery ${formatDate(deliveryNote.deliveryDate)}`
        }
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[deliveryNote.status]}`}>
              {statusLabels[deliveryNote.status]}
            </span>
            {canDeliver && (
              <button type="button" onClick={() => run("deliver")} disabled={busy !== null} className="btn-primary">
                {busy === "deliver" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                Mark delivered
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

      {(deliveryNote.invoiceId || deliveryNote.salesOrderId) && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small">
          {deliveryNote.invoiceId && (
            <>
              <span className="text-text-secondary">Related invoice: </span>
              <Link href={`/app/invoices/${deliveryNote.invoiceId}`} className="btn-link text-small">View →</Link>
            </>
          )}
          {deliveryNote.salesOrderId && (
            <>
              {deliveryNote.invoiceId && <span className="mx-2 text-text-tertiary">·</span>}
              <span className="text-text-secondary">Related sales order: </span>
              <Link href={`/app/sales-orders/${deliveryNote.salesOrderId}`} className="btn-link text-small">View →</Link>
            </>
          )}
        </div>
      )}

      {(deliveryNote.shippingAddressLine1 || deliveryNote.shippingCity || deliveryNote.trackingNumber) && (
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          {(deliveryNote.shippingAddressLine1 || deliveryNote.shippingCity) && (
            <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Shipping address</p>
              <div className="mt-2 text-small text-text-primary">
                {deliveryNote.shippingAddressLine1 && <p>{deliveryNote.shippingAddressLine1}</p>}
                {deliveryNote.shippingAddressLine2 && <p>{deliveryNote.shippingAddressLine2}</p>}
                {(deliveryNote.shippingCity || deliveryNote.shippingPostalCode) && (
                  <p>{deliveryNote.shippingCity}{deliveryNote.shippingPostalCode ? ` ${deliveryNote.shippingPostalCode}` : ""}</p>
                )}
              </div>
            </div>
          )}
          {(deliveryNote.carrier || deliveryNote.trackingNumber) && (
            <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Carrier</p>
              <div className="mt-2 text-small text-text-primary">
                {deliveryNote.carrier && <p>{deliveryNote.carrier}</p>}
                {deliveryNote.trackingNumber && <p className="tabular-nums text-text-secondary">Tracking {deliveryNote.trackingNumber}</p>}
              </div>
            </div>
          )}
        </section>
      )}

      {deliveryNote.receivedByName && (
        <div className="mt-3 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small text-text-secondary">
          Received by: <span className="text-charcoal">{deliveryNote.receivedByName}</span>
          {deliveryNote.deliveredAt && <span className="ml-2 text-caption text-text-tertiary">on {formatDate(deliveryNote.deliveredAt.slice(0, 10))}</span>}
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
              <th className="w-32 px-4 py-3 text-right">Quantity</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 text-center tabular-nums text-text-tertiary">{l.lineNo}</td>
                <td className="px-4 py-3 text-charcoal">{l.description}</td>
                <td className="px-4 py-3 text-right tabular-nums">{Number(l.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {deliveryNote.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{deliveryNote.notes}</p>
        </section>
      )}

      {deliveryNote.status === "cancelled" && deliveryNote.cancelledReason && (
        <div className="mt-6 rounded-card border-hairline border-danger/40 bg-danger-bg/40 px-5 py-3 text-small">
          <span className="text-text-secondary">Cancelled: </span>{deliveryNote.cancelledReason}
        </div>
      )}
    </main>
  );
}
