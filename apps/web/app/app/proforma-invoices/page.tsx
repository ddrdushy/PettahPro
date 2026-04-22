import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { FileText, Plus } from "lucide-react";
import type { ProformaInvoiceListRow, ProformaInvoiceStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Proforma invoices" };

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

async function fetchProformas(): Promise<ProformaInvoiceListRow[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/proforma-invoices`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { proformaInvoices: ProformaInvoiceListRow[] };
  return data.proformaInvoices;
}

export default async function ProformaInvoicesPage() {
  const rows = await fetchProformas();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Sell"
        title="Proforma invoices"
        description="Pre-sale, invoice-shaped documents for advance payment, customs clearance, or customer paperwork. No GL impact until you convert one to a real invoice."
        action={
          <Link href="/app/proforma-invoices/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New proforma
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <FileText className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No proformas yet.</p>
          <p className="mt-1 text-small text-text-secondary">
            Use proformas for export customers, advance payment requests, or deals pending a PO.
          </p>
          <Link href="/app/proforma-invoices/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New proforma
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
              {rows.map((p) => {
                const expiredButOpen =
                  p.validUntil < today && (p.status === "sent" || p.status === "draft");
                return (
                  <tr key={p.id} className="transition-colors hover:bg-surface-recessed/40">
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      {formatDate(p.issueDate)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/proforma-invoices/${p.id}`}
                        className="tabular-nums text-charcoal underline-offset-4 hover:underline"
                      >
                        {p.proformaNumber ?? <span className="italic text-text-tertiary">Draft</span>}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-charcoal">{p.customerName}</td>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      {formatDate(p.validUntil)}
                      {expiredButOpen && (
                        <span className="ml-2 text-caption text-warning-accent">past due</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                      {formatLKR(p.totalCents)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[p.status]}`}
                      >
                        {statusLabels[p.status]}
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
