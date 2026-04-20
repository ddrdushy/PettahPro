import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import type { Account, InvoiceDetail, InvoiceLine, Customer } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { formatLKR, formatDate } from "@/lib/format";
import { PostInvoiceButton } from "./post-button";
import { RecordPaymentButton } from "./record-payment-button";

export const metadata: Metadata = { title: "Invoice" };

async function fetchInvoice(id: string) {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  const [invRes, coaRes] = await Promise.all([
    fetch(`${base}/invoices/${id}`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/coa`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
  ]);
  if (invRes.status === 404) return null;
  if (!invRes.ok) return null;
  const data = (await invRes.json()) as {
    invoice: InvoiceDetail;
    lines: InvoiceLine[];
    customer: Customer | null;
  };
  const coa = coaRes.ok ? ((await coaRes.json()) as { accounts: Account[] }).accounts : [];
  const bankAccounts = coa.filter(
    (a) => a.accountType === "asset" && (a.accountSubtype === "bank" || a.accountSubtype === "cash"),
  );
  return { ...data, bankAccounts };
}

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchInvoice(params.id);
  if (!data) notFound();
  const { invoice, lines, customer, bankAccounts } = data;

  const isPayable =
    (invoice.status === "posted" || invoice.status === "partially_paid") &&
    invoice.balanceDueCents > 0;

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/invoices" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to invoices
        </Link>
      </div>

      <PageHeader
        eyebrow={invoice.status === "draft" ? "Draft" : invoice.invoiceNumber ?? "Invoice"}
        title={
          invoice.invoiceNumber
            ? `Invoice ${invoice.invoiceNumber}`
            : "Draft invoice"
        }
        description={customer ? `For ${customer.name}` : undefined}
        action={
          <div className="flex items-center gap-3">
            <StatusBadge status={invoice.status} />
            <a
              href={`/app/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="btn-secondary"
            >
              <Download className="h-4 w-4" aria-hidden />
              PDF
            </a>
            {invoice.status === "draft" && <PostInvoiceButton id={invoice.id} />}
            {isPayable && customer && (
              <RecordPaymentButton
                invoiceId={invoice.id}
                customerId={customer.id}
                customerName={customer.name}
                invoiceNumber={invoice.invoiceNumber ?? invoice.id.slice(0, 8)}
                balanceDueCents={invoice.balanceDueCents}
                bankAccounts={bankAccounts}
              />
            )}
          </div>
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Meta label="Issue date" value={formatDate(invoice.issueDate)} />
              <Meta label="Due date" value={formatDate(invoice.dueDate)} />
              <Meta label="Currency" value={invoice.currency} />
              {invoice.reference && <Meta label="Reference" value={invoice.reference} />}
              {invoice.poNumber && <Meta label="Customer PO" value={invoice.poNumber} />}
              {invoice.postedAt && (
                <Meta label="Posted" value={formatDate(invoice.postedAt)} />
              )}
            </dl>
          </section>

          <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <div className="overflow-x-auto">
              <table className="w-full text-small">
                <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="w-10 px-4 py-3 text-center">#</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="w-24 px-4 py-3 text-right">Qty</th>
                    <th className="w-32 px-4 py-3 text-right">Unit</th>
                    <th className="w-28 px-4 py-3 text-right">Tax</th>
                    <th className="w-32 px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y-hairline divide-border">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-3 text-center text-caption text-text-tertiary">{l.lineNo}</td>
                      <td className="px-4 py-3">
                        <p className="text-charcoal">{l.description}</p>
                        {l.discountCents > 0 && (
                          <p className="text-caption text-text-tertiary">
                            Discount {(l.discountPctBps / 100).toFixed(2)}% · {formatLKR(l.discountCents)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{Number(l.quantity).toLocaleString("en-LK")}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatLKR(l.unitPriceCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {l.taxCents > 0 ? (
                          <>
                            <p>{formatLKR(l.taxCents)}</p>
                            <p className="text-caption text-text-tertiary">{(l.taxRateBps / 100).toFixed(2)}%</p>
                          </>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                        {formatLKR(l.lineTotalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {invoice.notes && (
            <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Notes</p>
              <p className="mt-2 whitespace-pre-wrap text-body text-charcoal">{invoice.notes}</p>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          {customer && (
            <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Bill to</p>
              <p className="mt-2 font-medium text-charcoal">{customer.name}</p>
              {customer.email && <p className="text-small text-text-secondary">{customer.email}</p>}
              {customer.phone && <p className="text-small text-text-secondary">{customer.phone}</p>}
              {customer.city && <p className="text-small text-text-secondary">{customer.city}</p>}
              {customer.vatNo && (
                <p className="mt-2 text-caption text-text-tertiary">VAT: {customer.vatNo}</p>
              )}
            </section>
          )}

          <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Totals</p>
            <dl className="mt-4 space-y-2 text-small">
              <Row label="Subtotal" value={invoice.subtotalCents} />
              {invoice.discountCents > 0 && <Row label="Discount" value={-invoice.discountCents} />}
              <Row label="Tax" value={invoice.taxCents} />
              <div className="border-t-hairline border-border pt-2">
                <Row label="Total" value={invoice.totalCents} emphasize />
              </div>
              <Row label="Paid" value={invoice.amountPaidCents} muted />
              <Row label="Balance due" value={invoice.balanceDueCents} emphasize />
            </dl>
          </section>

          {invoice.journalEntryId && (
            <section className="rounded-card border-hairline border-mint bg-mint-surface/40 p-5">
              <p className="text-caption uppercase tracking-wide text-mint-dark">Ledger</p>
              <p className="mt-1 text-small text-charcoal">
                Posted to the general ledger. Journal entry is immutable.
              </p>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className="mt-1 text-small text-charcoal">{value}</dd>
    </div>
  );
}

function Row({
  label,
  value,
  emphasize,
  muted,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt
        className={
          emphasize
            ? "font-medium text-charcoal"
            : muted
              ? "text-text-tertiary"
              : "text-text-secondary"
        }
      >
        {label}
      </dt>
      <dd
        className={`tabular-nums ${
          emphasize ? "text-h3 text-charcoal" : muted ? "text-text-tertiary" : "text-charcoal"
        }`}
      >
        {formatLKR(value)}
      </dd>
    </div>
  );
}
