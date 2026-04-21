"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Send, X } from "lucide-react";
import {
  api,
  ApiError,
  type QuotationDetail,
  type QuotationLine,
  type QuotationStatus,
  type Customer,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const statusStyles: Record<QuotationStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  sent: "bg-mint-surface text-mint-dark",
  accepted: "bg-mint text-mint-dark",
  rejected: "bg-danger-bg/60 text-danger",
  expired: "bg-warning-bg text-warning",
  converted: "bg-charcoal text-offwhite",
};

const statusLabels: Record<QuotationStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  converted: "Converted",
};

type ActionKind = "send" | "accept" | "reject" | "convert" | null;

export function QuotationDetailClient({
  quotation,
  lines,
  customer,
}: {
  quotation: QuotationDetail;
  lines: QuotationLine[];
  customer: Customer | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<ActionKind>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: Exclude<ActionKind, null>) {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "send") await api.sendQuotation(quotation.id);
      else if (kind === "accept") await api.acceptQuotation(quotation.id);
      else if (kind === "reject") {
        const reason = window.prompt("Reason (optional):") ?? undefined;
        await api.rejectQuotation(quotation.id, reason || undefined);
      } else if (kind === "convert") {
        if (!confirm("Create a draft invoice from this quotation?")) {
          setBusy(null);
          return;
        }
        const res = await api.convertQuotation(quotation.id);
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

  const canSend = quotation.status === "draft";
  const canAccept = quotation.status === "sent" || quotation.status === "draft";
  const canReject =
    quotation.status !== "converted" && quotation.status !== "rejected";
  const canConvert =
    quotation.status !== "converted" && quotation.status !== "rejected";

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/quotations" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to quotations
        </Link>
      </div>

      <PageHeader
        eyebrow="Sell · Quotation"
        title={quotation.quotationNumber ?? (quotation.status === "draft" ? "Draft quotation" : "Quotation")}
        description={
          customer
            ? `${customer.name}${customer.vatNo ? ` · VAT ${customer.vatNo}` : ""} · Issued ${formatDate(quotation.issueDate)} · Valid until ${formatDate(quotation.validUntil)}`
            : `Issued ${formatDate(quotation.issueDate)} · Valid until ${formatDate(quotation.validUntil)}`
        }
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[quotation.status]}`}>
              {statusLabels[quotation.status]}
            </span>
            {canSend && (
              <button type="button" onClick={() => run("send")} disabled={busy !== null} className="btn-secondary">
                {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                Send
              </button>
            )}
            {canAccept && (
              <button type="button" onClick={() => run("accept")} disabled={busy !== null} className="btn-secondary">
                {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                Accept
              </button>
            )}
            {canReject && (
              <button type="button" onClick={() => run("reject")} disabled={busy !== null} className="btn-secondary">
                {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                Reject
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

      {quotation.convertedInvoiceId && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small">
          <span className="text-text-secondary">Converted to invoice </span>
          <Link href={`/app/invoices/${quotation.convertedInvoiceId}`} className="btn-link text-small">
            View invoice →
          </Link>
          {quotation.convertedAt && (
            <span className="ml-2 text-caption text-text-tertiary">on {formatDate(quotation.convertedAt.slice(0, 10))}</span>
          )}
        </div>
      )}

      {quotation.status === "rejected" && quotation.rejectedReason && (
        <div className="mt-6 rounded-card border-hairline border-danger/40 bg-danger-bg/40 px-5 py-3 text-small text-text-primary">
          <span className="text-text-secondary">Rejection reason: </span>
          {quotation.rejectedReason}
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
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{formatLKR(quotation.subtotalCents)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{quotation.discountCents > 0 ? formatLKR(quotation.discountCents) : "—"}</td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{quotation.taxCents > 0 ? formatLKR(quotation.taxCents) : "—"}</td>
              <td className="px-4 py-2" />
            </tr>
            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-charcoal" colSpan={6}>Quotation total</td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(quotation.totalCents)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {quotation.terms && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Terms</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{quotation.terms}</p>
        </section>
      )}

      {quotation.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Internal notes</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{quotation.notes}</p>
        </section>
      )}
    </main>
  );
}
