import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { FileText, Plus } from "lucide-react";
import type { SalesOrderListRow, SalesOrderStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Sales orders" };

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

async function fetchSOs(): Promise<SalesOrderListRow[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/sales-orders`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { salesOrders: SalesOrderListRow[] };
  return data.salesOrders;
}

export default async function SalesOrdersPage() {
  const rows = await fetchSOs();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Sell"
        title="Sales orders"
        description="Confirmed customer commitments. No GL impact until you convert one to an invoice."
        action={
          <Link href="/app/sales-orders/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New sales order
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <FileText className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No sales orders yet.</p>
          <p className="mt-1 text-small text-text-secondary">Record customer commitments before shipping + invoicing.</p>
          <Link href="/app/sales-orders/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New sales order
          </Link>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Ordered</th>
                <th className="w-36 px-4 py-3 text-left">Number</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="w-28 px-4 py-3 text-left">Expected ship</th>
                <th className="w-32 px-4 py-3 text-right">Total</th>
                <th className="w-28 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {rows.map((so) => (
                <tr key={so.id} className="transition-colors hover:bg-surface-recessed/40">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(so.orderDate)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/app/sales-orders/${so.id}`} className="tabular-nums text-charcoal underline-offset-4 hover:underline">
                      {so.soNumber ?? <span className="italic text-text-tertiary">Draft</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-charcoal">{so.customerName}</td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {so.expectedShipDate ? formatDate(so.expectedShipDate) : <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(so.totalCents)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[so.status]}`}>
                      {statusLabels[so.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
