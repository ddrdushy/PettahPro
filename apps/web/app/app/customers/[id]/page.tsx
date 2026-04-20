import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, MapPin, Phone, Plus } from "lucide-react";
import type { CustomerDetail } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { PartyKpiStrip, AgingBars } from "@/components/app/party-kpis";
import { formatLKR, formatDate, initials } from "@/lib/format";

export const metadata: Metadata = { title: "Customer" };

const methodLabel: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  lankaqr: "LankaQR",
  payhere: "PayHere",
  frimi: "FriMi",
  genie: "Genie",
  ipay: "iPay",
  other: "Other",
};

async function fetchCustomer(id: string): Promise<CustomerDetail | null> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/customers/${id}`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as CustomerDetail;
}

export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchCustomer(params.id);
  if (!data) notFound();
  const { customer, kpis, aging, invoices, payments } = data;
  const agingTotal = aging.reduce((s, b) => s + b.balanceCents, 0);

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/customers" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to customers
        </Link>
      </div>

      <PageHeader
        eyebrow="Customer"
        title={customer.name}
        description={customer.legalName && customer.legalName !== customer.name ? `Legal: ${customer.legalName}` : undefined}
        action={
          <Link href="/app/invoices/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New invoice
          </Link>
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <PartyKpiStrip kpis={kpis} side="receivable" />

          <AgingBars aging={aging} totalCents={agingTotal} />

          <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <header className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
              <div>
                <h2 className="text-h3 text-charcoal">Invoices</h2>
                <p className="text-caption text-text-tertiary">{invoices.length} total (latest 50)</p>
              </div>
              <Link href="/app/invoices" className="btn-link text-small">
                View all
              </Link>
            </header>
            {invoices.length === 0 ? (
              <div className="px-6 py-10 text-center text-small text-text-secondary">
                No invoices for this customer yet.
              </div>
            ) : (
              <table className="w-full text-small">
                <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="px-4 py-3 text-left">Invoice</th>
                    <th className="px-4 py-3 text-left">Issued</th>
                    <th className="px-4 py-3 text-left">Due</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y-hairline divide-border">
                  {invoices.map((i) => (
                    <tr key={i.id} className="hover:bg-surface-recessed/40">
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/invoices/${i.id}`}
                          className="font-medium text-charcoal hover:underline"
                        >
                          {i.invoiceNumber ?? <span className="italic text-text-tertiary">Draft</span>}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(i.issueDate)}</td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(i.dueDate)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                        {formatLKR(i.totalCents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {i.balanceDueCents > 0 ? (
                          <span className="font-medium text-charcoal">{formatLKR(i.balanceDueCents)}</span>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={i.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <header className="border-b-hairline border-border px-6 py-4">
              <h2 className="text-h3 text-charcoal">Payments received</h2>
              <p className="text-caption text-text-tertiary">{payments.length} total (latest 50)</p>
            </header>
            {payments.length === 0 ? (
              <div className="px-6 py-10 text-center text-small text-text-secondary">
                No payments received yet.
              </div>
            ) : (
              <table className="w-full text-small">
                <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="px-4 py-3 text-left">Payment</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Method</th>
                    <th className="px-4 py-3 text-left">Reference</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y-hairline divide-border">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-medium text-charcoal">{p.paymentNumber ?? "—"}</td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(p.paymentDate)}</td>
                      <td className="px-4 py-3 text-text-secondary">
                        {methodLabel[p.method] ?? p.method}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {p.reference ?? <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                        {formatLKR(p.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-card border-hairline border-border bg-surface-elevated p-5">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 flex-none place-items-center rounded-full bg-mint-surface text-body font-medium text-mint-dark">
                {initials(customer.name)}
              </div>
              <div>
                <p className="text-h3 text-charcoal">{customer.name}</p>
                {customer.code && (
                  <p className="text-caption text-text-tertiary">{customer.code}</p>
                )}
              </div>
            </div>
            <dl className="mt-5 space-y-3 text-small">
              {customer.email && (
                <Row icon={<Mail className="h-3.5 w-3.5" />} value={customer.email} />
              )}
              {customer.phone && (
                <Row icon={<Phone className="h-3.5 w-3.5" />} value={customer.phone} />
              )}
              {customer.city && (
                <Row icon={<MapPin className="h-3.5 w-3.5" />} value={customer.city} />
              )}
            </dl>
            <div className="mt-5 grid grid-cols-2 gap-4 border-t-hairline border-border pt-4">
              <Meta label="Terms" value={customer.paymentTermsDays === 0 ? "Immediate" : `Net ${customer.paymentTermsDays}`} />
              <Meta
                label="Credit limit"
                value={customer.creditLimitCents > 0 ? formatLKR(customer.creditLimitCents) : "—"}
              />
              {customer.tin && <Meta label="TIN" value={customer.tin} />}
              {customer.vatNo && <Meta label="VAT" value={customer.vatNo} />}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Row({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-2 text-text-secondary">
      <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-surface-recessed text-text-tertiary">
        {icon}
      </span>
      {value}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-0.5 text-small text-charcoal">{value}</p>
    </div>
  );
}
