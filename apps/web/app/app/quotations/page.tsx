import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { FileText, Plus } from "lucide-react";
import type { QuotationListRow, QuotationStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Quotations" };

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

async function fetchQuotations(): Promise<QuotationListRow[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/quotations`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { quotations: QuotationListRow[] };
  return data.quotations;
}

export default async function QuotationsPage() {
  const rows = await fetchQuotations();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Sell"
        title="Quotations"
        description="Estimates you've prepared for customers. No GL impact until you convert one to an invoice."
        action={
          <Link href="/app/quotations/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New quotation
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <FileText className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No quotations yet.</p>
          <p className="mt-1 text-small text-text-secondary">Quote first, invoice once they agree.</p>
          <Link href="/app/quotations/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New quotation
          </Link>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Issued</th>
                <th className="w-36 px-4 py-3 text-left">Number</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="w-28 px-4 py-3 text-left">Valid until</th>
                <th className="w-32 px-4 py-3 text-right">Total</th>
                <th className="w-28 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {rows.map((q) => {
                const expiredButOpen = q.validUntil < today && (q.status === "sent" || q.status === "draft");
                return (
                  <tr key={q.id} className="transition-colors hover:bg-surface-recessed/40">
                    <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(q.issueDate)}</td>
                    <td className="px-4 py-3">
                      <Link href={`/app/quotations/${q.id}`} className="tabular-nums text-charcoal underline-offset-4 hover:underline">
                        {q.quotationNumber ?? <span className="italic text-text-tertiary">Draft</span>}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-charcoal">{q.customerName}</td>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      {formatDate(q.validUntil)}
                      {expiredButOpen && (
                        <span className="ml-2 text-caption text-warning-accent">past due</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(q.totalCents)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[q.status]}`}>
                        {statusLabels[q.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
