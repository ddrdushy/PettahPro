import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { PackageCheck, Plus } from "lucide-react";
import type { GrnListRow, GrnStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Goods received" };

const statusStyles: Record<GrnStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  received: "bg-mint text-mint-dark",
  cancelled: "bg-danger-bg/60 text-danger",
};

const statusLabels: Record<GrnStatus, string> = {
  draft: "Draft",
  received: "Received",
  cancelled: "Cancelled",
};

async function fetchGrns(): Promise<GrnListRow[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/grns`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { grns: GrnListRow[] };
  return data.grns;
}

export default async function GrnsPage() {
  const rows = await fetchGrns();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Buy"
        title="Goods received notes"
        description="Record what physically arrived from suppliers — flag short shipments, damage, or quality issues before paying."
        action={
          <Link href="/app/grns/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New GRN
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <PackageCheck className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No GRNs yet.</p>
          <p className="mt-1 text-small text-text-secondary">Capture goods on arrival — catch discrepancies before the bill comes in.</p>
          <Link href="/app/grns/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New GRN
          </Link>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Received</th>
                <th className="w-36 px-4 py-3 text-left">Number</th>
                <th className="px-4 py-3 text-left">Supplier</th>
                <th className="w-36 px-4 py-3 text-left">Supplier DN</th>
                <th className="w-28 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {rows.map((g) => (
                <tr key={g.id} className="transition-colors hover:bg-surface-recessed/40">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(g.receiptDate)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/app/grns/${g.id}`} className="tabular-nums text-charcoal underline-offset-4 hover:underline">
                      {g.grnNumber ?? <span className="italic text-text-tertiary">Draft</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-charcoal">{g.supplierName}</td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {g.supplierDeliveryNote ?? <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[g.status]}`}>
                      {statusLabels[g.status]}
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
