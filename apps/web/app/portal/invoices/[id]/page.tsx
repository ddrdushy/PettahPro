import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import type { PortalInvoiceDetail } from "@/lib/api";

export const metadata: Metadata = { title: "Invoice" };

function formatCurrency(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

async function fetchInvoice(id: string): Promise<PortalInvoiceDetail | null> {
  const cookieHeader = cookies().toString();
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/portal/invoices/${id}`,
    { headers: { cookie: cookieHeader }, cache: "no-store" },
  );
  if (res.status === 401) redirect("/portal/login");
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as PortalInvoiceDetail;
}

export default async function PortalInvoicePage({ params }: { params: { id: string } }) {
  const data = await fetchInvoice(params.id);
  if (!data) notFound();

  const { invoice, lines, customer } = data;

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/portal/invoices" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to invoices
        </Link>
      </div>

      <header className="flex flex-col gap-4 border-b-hairline border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="eyebrow">Invoice</span>
          <h1 className="mt-3 text-h1 text-charcoal">
            {invoice.invoiceNumber ?? invoice.id.slice(0, 8)}
          </h1>
          <p className="mt-2 text-body text-text-secondary">
            Issued {formatDate(invoice.issueDate)} · Due {formatDate(invoice.dueDate)}
          </p>
        </div>
        <a
          href={`/portal/invoices/${invoice.id}/pdf`}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <Download className="h-4 w-4" aria-hidden /> Download PDF
        </a>
      </header>

      {customer && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-6 text-small">
          <p className="font-medium text-charcoal">{customer.legalName ?? customer.name}</p>
          {customer.addressLine1 && <p className="text-text-secondary">{customer.addressLine1}</p>}
          {customer.addressLine2 && <p className="text-text-secondary">{customer.addressLine2}</p>}
          {customer.city && (
            <p className="text-text-secondary">{customer.city}</p>
          )}
          {customer.vatNo && (
            <p className="mt-2 text-text-tertiary">VAT {customer.vatNo}</p>
          )}
        </section>
      )}

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="px-6 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Unit price</th>
              <th className="px-4 py-3 text-right">Tax</th>
              <th className="px-6 py-3 text-right">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-6 py-3 text-charcoal">{l.description}</td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                  {Number(l.quantity).toLocaleString("en-LK")}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                  {formatCurrency(l.unitPriceCents, invoice.currency)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                  {formatCurrency(l.taxCents, invoice.currency)}
                </td>
                <td className="px-6 py-3 text-right tabular-nums text-charcoal">
                  {formatCurrency(l.lineTotalCents, invoice.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-hairline border-border bg-surface-recessed/50 text-small">
            <tr>
              <td colSpan={4} className="px-6 py-2 text-right text-text-secondary">Subtotal</td>
              <td className="px-6 py-2 text-right tabular-nums text-charcoal">
                {formatCurrency(invoice.subtotalCents, invoice.currency)}
              </td>
            </tr>
            {invoice.discountCents > 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-2 text-right text-text-secondary">Discount</td>
                <td className="px-6 py-2 text-right tabular-nums text-charcoal">
                  −{formatCurrency(invoice.discountCents, invoice.currency)}
                </td>
              </tr>
            )}
            <tr>
              <td colSpan={4} className="px-6 py-2 text-right text-text-secondary">Tax</td>
              <td className="px-6 py-2 text-right tabular-nums text-charcoal">
                {formatCurrency(invoice.taxCents, invoice.currency)}
              </td>
            </tr>
            <tr className="border-t-hairline border-border">
              <td colSpan={4} className="px-6 py-3 text-right font-medium text-charcoal">Total</td>
              <td className="px-6 py-3 text-right font-medium tabular-nums text-charcoal">
                {formatCurrency(invoice.totalCents, invoice.currency)}
              </td>
            </tr>
            <tr>
              <td colSpan={4} className="px-6 py-2 text-right text-text-secondary">Paid</td>
              <td className="px-6 py-2 text-right tabular-nums text-charcoal">
                {formatCurrency(invoice.amountPaidCents, invoice.currency)}
              </td>
            </tr>
            <tr>
              <td colSpan={4} className="px-6 py-2 text-right font-medium text-charcoal">Balance due</td>
              <td className="px-6 py-2 text-right font-medium tabular-nums text-charcoal">
                {formatCurrency(invoice.balanceDueCents, invoice.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      {(invoice.notes || invoice.terms) && (
        <section className="mt-6 grid gap-6 md:grid-cols-2">
          {invoice.notes && (
            <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
              <h2 className="text-small font-medium text-charcoal">Notes</h2>
              <p className="mt-2 whitespace-pre-line text-small text-text-secondary">{invoice.notes}</p>
            </div>
          )}
          {invoice.terms && (
            <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
              <h2 className="text-small font-medium text-charcoal">Terms</h2>
              <p className="mt-2 whitespace-pre-line text-small text-text-secondary">{invoice.terms}</p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
