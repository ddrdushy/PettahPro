import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Mail, MapPin, Phone, Plus, Building2, Scale } from "lucide-react";
import type { SupplierDetail } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { PartyKpiStrip, AgingBars } from "@/components/app/party-kpis";
import { formatLKR, formatDate, initials } from "@/lib/format";

export const metadata: Metadata = { title: "Supplier" };

const methodLabel: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  slips: "SLIPS",
  other: "Other",
};

async function fetchSupplier(id: string): Promise<SupplierDetail | null> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/suppliers/${id}`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as SupplierDetail;
}

export default async function SupplierDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchSupplier(params.id);
  if (!data) notFound();
  const { supplier, kpis, aging, bills, payments } = data;
  const agingTotal = aging.reduce((s, b) => s + b.balanceCents, 0);

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/suppliers" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to suppliers
        </Link>
      </div>

      <PageHeader
        eyebrow="Supplier"
        title={supplier.name}
        description={supplier.legalName && supplier.legalName !== supplier.name ? `Legal: ${supplier.legalName}` : undefined}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={`/app/suppliers/${supplier.id}/statement`} className="btn-secondary">
              <FileText className="h-4 w-4" aria-hidden />
              Statement
            </Link>
            <Link href={`/app/suppliers/${supplier.id}/reconcile`} className="btn-secondary">
              <Scale className="h-4 w-4" aria-hidden />
              Reconcile
            </Link>
            <Link href="/app/bills/new" className="btn-primary">
              <Plus className="h-4 w-4" aria-hidden />
              New bill
            </Link>
          </div>
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <PartyKpiStrip kpis={kpis} side="payable" />

          <AgingBars aging={aging} totalCents={agingTotal} />

          <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <header className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
              <div>
                <h2 className="text-h3 text-charcoal">Bills</h2>
                <p className="text-caption text-text-tertiary">{bills.length} total (latest 50)</p>
              </div>
              <Link href="/app/bills" className="btn-link text-small">
                View all
              </Link>
            </header>
            {bills.length === 0 ? (
              <div className="px-6 py-10 text-center text-small text-text-secondary">
                No bills from this supplier yet.
              </div>
            ) : (
              <table className="w-full text-small">
                <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="px-4 py-3 text-left">Bill</th>
                    <th className="px-4 py-3 text-left">Bill date</th>
                    <th className="px-4 py-3 text-left">Due</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y-hairline divide-border">
                  {bills.map((b) => (
                    <tr key={b.id} className="hover:bg-surface-recessed/40">
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/bills/${b.id}`}
                          className="font-medium text-charcoal hover:underline"
                        >
                          {b.internalReference ?? <span className="italic text-text-tertiary">Draft</span>}
                        </Link>
                        {b.supplierBillNumber && (
                          <p className="text-caption text-text-tertiary">Ref: {b.supplierBillNumber}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(b.billDate)}</td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(b.dueDate)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                        {formatLKR(b.totalCents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {b.balanceDueCents > 0 ? (
                          <span className="font-medium text-charcoal">{formatLKR(b.balanceDueCents)}</span>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={b.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <header className="border-b-hairline border-border px-6 py-4">
              <h2 className="text-h3 text-charcoal">Payments sent</h2>
              <p className="text-caption text-text-tertiary">{payments.length} total (latest 50)</p>
            </header>
            {payments.length === 0 ? (
              <div className="px-6 py-10 text-center text-small text-text-secondary">
                No payments sent yet.
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
                        {p.chequeNumber
                          ? `Cheque ${p.chequeNumber}`
                          : p.reference ?? <span className="text-text-tertiary">—</span>}
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
                {initials(supplier.name)}
              </div>
              <div>
                <p className="text-h3 text-charcoal">{supplier.name}</p>
                {supplier.code && (
                  <p className="text-caption text-text-tertiary">{supplier.code}</p>
                )}
              </div>
            </div>
            <dl className="mt-5 space-y-3 text-small">
              {supplier.email && <Row icon={<Mail className="h-3.5 w-3.5" />} value={supplier.email} />}
              {supplier.phone && <Row icon={<Phone className="h-3.5 w-3.5" />} value={supplier.phone} />}
              {supplier.city && <Row icon={<MapPin className="h-3.5 w-3.5" />} value={supplier.city} />}
            </dl>

            {(supplier.bankName || supplier.bankAccountNo) && (
              <div className="mt-5 border-t-hairline border-border pt-4">
                <div className="flex items-center gap-2 text-caption uppercase tracking-wide text-text-tertiary">
                  <Building2 className="h-3 w-3" aria-hidden /> Banking
                </div>
                <p className="mt-2 text-small text-charcoal">{supplier.bankName ?? "—"}</p>
                {supplier.bankAccountNo && (
                  <p className="text-caption text-text-tertiary">{supplier.bankAccountNo}</p>
                )}
                {supplier.bankBranch && (
                  <p className="text-caption text-text-tertiary">{supplier.bankBranch}</p>
                )}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-4 border-t-hairline border-border pt-4">
              <Meta label="Terms" value={supplier.paymentTermsDays === 0 ? "Immediate" : `Net ${supplier.paymentTermsDays}`} />
              {supplier.tin && <Meta label="TIN" value={supplier.tin} />}
              {supplier.vatNo && <Meta label="VAT" value={supplier.vatNo} />}
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
