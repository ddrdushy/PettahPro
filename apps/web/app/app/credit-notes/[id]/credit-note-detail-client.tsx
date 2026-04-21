"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import {
  api,
  ApiError,
  type CreditNoteDetail,
  type CreditNoteLine,
  type CreditNoteLinkedInvoice,
  type CreditNoteReason,
  type CreditNoteStatus,
  type Customer,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const reasonLabels: Record<CreditNoteReason, string> = {
  return: "Return",
  price_adjustment: "Price adjustment",
  discount: "Discount",
  goodwill: "Goodwill",
  write_off: "Write-off",
  other: "Other",
};

const statusStyles: Record<CreditNoteStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  posted: "bg-mint-surface text-mint-dark",
  void: "bg-danger-bg/60 text-danger",
};

const statusLabels: Record<CreditNoteStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  void: "Void",
};

export function CreditNoteDetailClient({
  creditNote,
  lines,
  customer,
  invoice,
}: {
  creditNote: CreditNoteDetail;
  lines: CreditNoteLine[];
  customer: Customer | null;
  invoice: CreditNoteLinkedInvoice | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    setError(null);
    setBusy(true);
    try {
      await api.postCreditNote(creditNote.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const unapplied = creditNote.totalCents - creditNote.appliedCents;

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/credit-notes" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to credit notes
        </Link>
      </div>

      <PageHeader
        eyebrow="Sell · Credit note"
        title={
          creditNote.creditNoteNumber ??
          (creditNote.status === "draft" ? "Draft credit note" : "Credit note")
        }
        description={
          customer
            ? `${customer.name}${customer.vatNo ? ` · VAT ${customer.vatNo}` : ""} · ${formatDate(creditNote.issueDate)} · ${reasonLabels[creditNote.reason]}`
            : formatDate(creditNote.issueDate)
        }
        action={
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[creditNote.status]}`}>
              {statusLabels[creditNote.status]}
            </span>
            {creditNote.status === "draft" && (
              <button
                type="button"
                onClick={post}
                disabled={busy}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                Post credit note
              </button>
            )}
          </div>
        }
      />

      {invoice && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small">
          <span className="text-text-secondary">Against invoice </span>
          <Link href={`/app/invoices/${invoice.id}`} className="tabular-nums text-charcoal underline-offset-4 hover:underline">
            {invoice.invoiceNumber ?? invoice.id.slice(0, 8)}
          </Link>
          <span className="text-text-secondary">
            {" "}· total {formatLKR(invoice.totalCents)} · open balance {formatLKR(invoice.balanceDueCents)}
          </span>
        </div>
      )}

      {creditNote.status === "posted" && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <StatCard label="Credit issued" value={formatLKR(creditNote.totalCents)} />
          <StatCard
            label="Applied to invoice"
            value={formatLKR(creditNote.appliedCents)}
            sub={invoice ? `On ${invoice.invoiceNumber ?? "the linked invoice"}` : "Standalone"}
          />
          <StatCard
            label={unapplied > 0 ? "Standing credit remaining" : "Fully applied"}
            value={formatLKR(unapplied)}
            emphasis={unapplied > 0}
          />
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
              <td className="px-4 py-2 text-caption text-text-secondary" colSpan={3}>
                Subtotal
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                {formatLKR(creditNote.subtotalCents)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                {creditNote.discountCents > 0 ? formatLKR(creditNote.discountCents) : "—"}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                {creditNote.taxCents > 0 ? formatLKR(creditNote.taxCents) : "—"}
              </td>
              <td className="px-4 py-2" />
            </tr>
            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-charcoal" colSpan={6}>
                Credit note total
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(creditNote.totalCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {creditNote.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{creditNote.notes}</p>
        </section>
      )}

      {creditNote.status === "posted" && creditNote.journalEntryId && (
        <div className="mt-6 text-small">
          <Link
            href={`/app/journals/${creditNote.journalEntryId}`}
            className="btn-link"
          >
            View GL posting →
          </Link>
        </div>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border-hairline p-5 ${
        emphasis ? "border-charcoal/20 bg-mint-surface/40" : "border-border bg-surface-elevated"
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-2 text-h3 text-charcoal">{value}</p>
      {sub && <p className="mt-1 text-caption text-text-secondary">{sub}</p>}
    </div>
  );
}
