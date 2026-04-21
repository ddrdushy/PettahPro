"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, X } from "lucide-react";
import {
  api,
  ApiError,
  type SalesOrderDetail,
  type SalesOrderLine,
  type SalesOrderStatus,
  type Customer,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const statusStyles: Record<SalesOrderStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  confirmed: "bg-mint text-mint-dark",
  cancelled: "bg-danger-bg/60 text-danger",
  converted: "bg-charcoal text-offwhite",
};

const statusLabels: Record<SalesOrderStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  converted: "Converted",
};

type ActionKind = "confirm" | "cancel" | "convert" | null;

export function SalesOrderDetailClient({
  salesOrder,
  lines,
  customer,
}: {
  salesOrder: SalesOrderDetail;
  lines: SalesOrderLine[];
  customer: Customer | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<ActionKind>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: Exclude<ActionKind, null>) {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "confirm") await api.confirmSalesOrder(salesOrder.id);
      else if (kind === "cancel") {
        const reason = window.prompt("Reason for cancelling (optional):") ?? undefined;
        await api.cancelSalesOrder(salesOrder.id, reason || undefined);
      } else if (kind === "convert") {
        if (!confirm("Create a draft invoice from this sales order?")) {
          setBusy(null);
          return;
        }
        const res = await api.convertSalesOrder(salesOrder.id);
        router.push(`/app/invoices/${res.invoiceId}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const canConfirm = salesOrder.status === "draft";
  const canCancel = salesOrder.status !== "converted" && salesOrder.status !== "cancelled";
  const canConvert = salesOrder.status !== "converted" && salesOrder.status !== "cancelled";

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/sales-orders" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to sales orders
        </Link>
      </div>

      <PageHeader
        eyebrow="Sell · Sales order"
        title={salesOrder.soNumber ?? (salesOrder.status === "draft" ? "Draft SO" : "Sales order")}
        description={
          customer
            ? `${customer.name}${customer.vatNo ? ` · VAT ${customer.vatNo}` : ""} · Ordered ${formatDate(salesOrder.orderDate)}${salesOrder.expectedShipDate ? ` · Expected ship ${formatDate(salesOrder.expectedShipDate)}` : ""}`
            : `Ordered ${formatDate(salesOrder.orderDate)}`
        }
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[salesOrder.status]}`}>
              {statusLabels[salesOrder.status]}
            </span>
            {canConfirm && (
              <button type="button" onClick={() => run("confirm")} disabled={busy !== null} className="btn-secondary">
                {busy === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                Confirm
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
                Convert to invoice
              </button>
            )}
          </div>
        }
      />

      {salesOrder.convertedInvoiceId && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small">
          <span className="text-text-secondary">Converted to invoice </span>
          <Link href={`/app/invoices/${salesOrder.convertedInvoiceId}`} className="btn-link text-small">
            View invoice →
          </Link>
          {salesOrder.convertedAt && (
            <span className="ml-2 text-caption text-text-tertiary">on {formatDate(salesOrder.convertedAt.slice(0, 10))}</span>
          )}
        </div>
      )}

      {salesOrder.customerPoNumber && (
        <div className="mt-3 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small text-text-secondary">
          Customer's PO: <span className="tabular-nums text-charcoal">{salesOrder.customerPoNumber}</span>
        </div>
      )}

      {salesOrder.status === "cancelled" && salesOrder.cancelledReason && (
        <div className="mt-6 rounded-card border-hairline border-danger/40 bg-danger-bg/40 px-5 py-3 text-small text-text-primary">
          <span className="text-text-secondary">Cancelled: </span>{salesOrder.cancelledReason}
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
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{formatLKR(salesOrder.subtotalCents)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{salesOrder.discountCents > 0 ? formatLKR(salesOrder.discountCents) : "—"}</td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{salesOrder.taxCents > 0 ? formatLKR(salesOrder.taxCents) : "—"}</td>
              <td className="px-4 py-2" />
            </tr>
            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-charcoal" colSpan={6}>Sales order total</td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(salesOrder.totalCents)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {salesOrder.terms && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Terms</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{salesOrder.terms}</p>
        </section>
      )}

      {salesOrder.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Internal notes</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{salesOrder.notes}</p>
        </section>
      )}
    </main>
  );
}
