"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Download, Loader2, Send, Trash2, X } from "lucide-react";
import {
  api,
  ApiError,
  type ProformaInvoiceDetail,
  type ProformaInvoiceLine,
  type ProformaInvoiceStatus,
  type Customer,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const statusStyles: Record<ProformaInvoiceStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  sent: "bg-mint-surface text-mint-dark",
  converted: "bg-charcoal text-offwhite",
  cancelled: "bg-danger-bg/60 text-danger",
};

const statusLabels: Record<ProformaInvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  converted: "Converted",
  cancelled: "Cancelled",
};

type ActionKind = "send" | "cancel" | "convert" | "delete" | null;

export function ProformaDetailClient({
  proformaInvoice,
  lines,
  customer,
}: {
  proformaInvoice: ProformaInvoiceDetail;
  lines: ProformaInvoiceLine[];
  customer: Customer | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<ActionKind>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: Exclude<ActionKind, null>) {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "send") {
        await api.sendProformaInvoice(proformaInvoice.id);
      } else if (kind === "cancel") {
        const reason = window.prompt("Reason (optional):") ?? undefined;
        await api.cancelProformaInvoice(proformaInvoice.id, reason || undefined);
      } else if (kind === "convert") {
        if (!confirm("Create a draft invoice from this proforma?")) {
          setBusy(null);
          return;
        }
        const res = await api.convertProformaInvoice(proformaInvoice.id);
        router.push(`/app/invoices/${res.invoiceId}`);
        return;
      } else if (kind === "delete") {
        if (!confirm("Delete this draft proforma? This can't be undone.")) {
          setBusy(null);
          return;
        }
        await api.deleteProformaInvoice(proformaInvoice.id);
        router.push("/app/proforma-invoices");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const canSend = proformaInvoice.status === "draft";
  const canCancel =
    proformaInvoice.status !== "converted" && proformaInvoice.status !== "cancelled";
  const canConvert =
    proformaInvoice.status !== "converted" && proformaInvoice.status !== "cancelled";
  const canDelete = proformaInvoice.status === "draft";

  const today = new Date().toISOString().slice(0, 10);
  const expiredButOpen =
    proformaInvoice.validUntil < today &&
    (proformaInvoice.status === "sent" || proformaInvoice.status === "draft");

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/proforma-invoices" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to proformas
        </Link>
      </div>

      <PageHeader
        eyebrow="Sell · Proforma invoice"
        title={
          proformaInvoice.proformaNumber ??
          (proformaInvoice.status === "draft" ? "Draft proforma" : "Proforma")
        }
        description={
          customer
            ? `${customer.name}${customer.vatNo ? ` · VAT ${customer.vatNo}` : ""} · Issued ${formatDate(proformaInvoice.issueDate)} · Valid until ${formatDate(proformaInvoice.validUntil)}`
            : `Issued ${formatDate(proformaInvoice.issueDate)} · Valid until ${formatDate(proformaInvoice.validUntil)}`
        }
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[proformaInvoice.status]}`}
            >
              {statusLabels[proformaInvoice.status]}
            </span>
            {expiredButOpen && (
              <span className="rounded-full bg-warning-bg px-2.5 py-0.5 text-caption font-medium text-warning-accent">
                Past due
              </span>
            )}
            <a
              href={`/app/proforma-invoices/${proformaInvoice.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="btn-secondary inline-flex items-center gap-2"
            >
              <Download className="h-4 w-4" aria-hidden />
              PDF
            </a>
            {canSend && (
              <button
                type="button"
                onClick={() => run("send")}
                disabled={busy !== null}
                className="btn-secondary"
              >
                {busy === "send" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-4 w-4" aria-hidden />
                )}
                Send
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
            {canDelete && (
              <button
                type="button"
                onClick={() => run("delete")}
                disabled={busy !== null}
                className="btn-secondary"
              >
                {busy === "delete" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden />
                )}
                Delete
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
                Convert to invoice
              </button>
            )}
          </div>
        }
      />

      {proformaInvoice.convertedInvoiceId && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small">
          <span className="text-text-secondary">Converted to invoice </span>
          <Link
            href={`/app/invoices/${proformaInvoice.convertedInvoiceId}`}
            className="btn-link text-small"
          >
            View invoice →
          </Link>
          {proformaInvoice.convertedAt && (
            <span className="ml-2 text-caption text-text-tertiary">
              on {formatDate(proformaInvoice.convertedAt.slice(0, 10))}
            </span>
          )}
        </div>
      )}

      {proformaInvoice.status === "cancelled" && proformaInvoice.cancelledReason && (
        <div className="mt-6 rounded-card border-hairline border-danger/40 bg-danger-bg/40 px-5 py-3 text-small text-text-primary">
          <span className="text-text-secondary">Cancellation reason: </span>
          {proformaInvoice.cancelledReason}
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
                <td className="px-4 py-3 text-center tabular-nums text-text-tertiary">
                  {l.lineNo}
                </td>
                <td className="px-4 py-3 text-charcoal">{l.description}</td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                  {Number(l.quantity)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatLKR(l.unitPriceCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatLKR(l.lineSubtotalCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {l.discountCents > 0 ? (
                    formatLKR(l.discountCents)
                  ) : (
                    <span className="text-text-tertiary">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {l.taxCents > 0 ? (
                    formatLKR(l.taxCents)
                  ) : (
                    <span className="text-text-tertiary">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                  {formatLKR(l.lineTotalCents)}
                </td>
              </tr>
            ))}
            <tr className="bg-surface-recessed/50">
              <td className="px-4 py-2" />
              <td className="px-4 py-2 text-caption text-text-secondary" colSpan={3}>
                Subtotal
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                {formatLKR(proformaInvoice.subtotalCents)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                {proformaInvoice.discountCents > 0
                  ? formatLKR(proformaInvoice.discountCents)
                  : "—"}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                {proformaInvoice.taxCents > 0 ? formatLKR(proformaInvoice.taxCents) : "—"}
              </td>
              <td className="px-4 py-2" />
            </tr>
            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-charcoal" colSpan={6}>
                Proforma total
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(proformaInvoice.totalCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {proformaInvoice.terms && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Terms</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">
            {proformaInvoice.terms}
          </p>
        </section>
      )}

      {proformaInvoice.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">
            Internal notes
          </p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">
            {proformaInvoice.notes}
          </p>
        </section>
      )}
    </main>
  );
}
