import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, Plus, AlertTriangle } from "lucide-react";
import type { StockTransferListRow, StockTransferStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Stock transfers" };

async function fetchTransfers(): Promise<StockTransferListRow[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/stock-transfers`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  return ((await res.json()) as { transfers: StockTransferListRow[] }).transfers;
}

const STATUS_CLASS: Record<StockTransferStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary border-border",
  dispatched: "bg-amber-50 text-amber-800 border-amber-200",
  received: "bg-mint-surface/60 text-mint-dark border-mint/40",
  cancelled: "bg-danger-bg/60 text-danger border-danger/40",
};

const STATUS_LABEL: Record<StockTransferStatus, string> = {
  draft: "Draft",
  dispatched: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

export default async function StockTransfersPage() {
  const transfers = await fetchTransfers();

  return (
    <main className="container-p py-10">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          eyebrow="Stock"
          title="Stock transfers"
          description="Move stock between warehouses in two steps — dispatch reduces the source warehouse, receive adds to the destination. In-transit quantities are visible on each transfer until receive closes the loop."
        />
        <Link href="/app/stock/transfers/new" className="btn-primary inline-flex items-center gap-2 text-small">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New transfer
        </Link>
      </div>

      {transfers.length === 0 ? (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">No stock transfers yet.</p>
          <p className="mt-1 text-caption text-text-tertiary">
            Useful when you have more than one warehouse or branch stockroom.
          </p>
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Number</th>
                <th className="px-4 py-3 text-left">From → To</th>
                <th className="w-28 px-4 py-3 text-left">Requested</th>
                <th className="w-28 px-4 py-3 text-left">Dispatched</th>
                <th className="w-28 px-4 py-3 text-left">Received</th>
                <th className="w-20 px-4 py-3 text-right">Lines</th>
                <th className="w-28 px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3">
                    <Link href={`/app/stock/transfers/${t.id}`} className="text-charcoal underline-offset-4 hover:underline">
                      {t.transferNumber ?? "Draft"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    <span className="font-mono text-caption">{t.sourceCode}</span>
                    <span className="mx-1 text-text-tertiary">→</span>
                    <span className="font-mono text-caption">{t.destCode}</span>
                    <p className="mt-0.5 text-caption text-text-tertiary">
                      {t.sourceName} → {t.destName}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(t.requestedDate)}</td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {t.dispatchedAt ? formatDate(t.dispatchedAt.slice(0, 10)) : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {t.receivedAt ? formatDate(t.receivedAt.slice(0, 10)) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{t.lineCount}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full border-hairline px-2 py-0.5 text-caption font-medium ${STATUS_CLASS[t.status]}`}>
                      {STATUS_LABEL[t.status]}
                      {t.hasDiscrepancy && <AlertTriangle className="h-3 w-3" aria-hidden />}
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
