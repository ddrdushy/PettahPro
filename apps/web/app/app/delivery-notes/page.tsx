import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Plus, Truck } from "lucide-react";
import type { DeliveryNoteListRow, DeliveryNoteStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Delivery notes" };

const statusStyles: Record<DeliveryNoteStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  delivered: "bg-mint text-mint-dark",
  cancelled: "bg-danger-bg/60 text-danger",
};

const statusLabels: Record<DeliveryNoteStatus, string> = {
  draft: "Draft",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

async function fetchDNs(): Promise<DeliveryNoteListRow[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/delivery-notes`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { deliveryNotes: DeliveryNoteListRow[] };
  return data.deliveryNotes;
}

export default async function DeliveryNotesPage() {
  const rows = await fetchDNs();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Sell"
        title="Delivery notes"
        description="Proof of shipment to customers. Useful for handover, partial deliveries, and third-party carriers."
        action={
          <Link href="/app/delivery-notes/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New delivery note
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <Truck className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No delivery notes yet.</p>
          <p className="mt-1 text-small text-text-secondary">Record every physical handover to customers for a clean audit trail.</p>
          <Link href="/app/delivery-notes/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New delivery note
          </Link>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Delivery date</th>
                <th className="w-36 px-4 py-3 text-left">Number</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Carrier / tracking</th>
                <th className="w-28 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {rows.map((dn) => (
                <tr key={dn.id} className="transition-colors hover:bg-surface-recessed/40">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(dn.deliveryDate)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/app/delivery-notes/${dn.id}`} className="tabular-nums text-charcoal underline-offset-4 hover:underline">
                      {dn.dnNumber ?? <span className="italic text-text-tertiary">Draft</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-charcoal">{dn.customerName}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {dn.carrier ? (
                      <>
                        {dn.carrier}
                        {dn.trackingNumber && <span className="ml-1 tabular-nums text-caption text-text-tertiary">· {dn.trackingNumber}</span>}
                      </>
                    ) : (
                      <span className="text-text-tertiary">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[dn.status]}`}>
                      {statusLabels[dn.status]}
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
