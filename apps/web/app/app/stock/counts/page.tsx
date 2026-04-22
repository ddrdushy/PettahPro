import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Plus, AlertTriangle } from "lucide-react";
import type { StockCountListRow, StockCountStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate, formatLKR } from "@/lib/format";

export const metadata: Metadata = { title: "Stock counts" };

async function fetchCounts(): Promise<StockCountListRow[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/stock-counts`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  return ((await res.json()) as { counts: StockCountListRow[] }).counts;
}

const STATUS_CLASS: Record<StockCountStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary border-border",
  review: "bg-amber-50 text-amber-800 border-amber-200",
  pending_approval: "bg-amber-50 text-amber-900 border-amber-300",
  posted: "bg-mint-surface/60 text-mint-dark border-mint/40",
  cancelled: "bg-danger-bg/60 text-danger border-danger/40",
};

const STATUS_LABEL: Record<StockCountStatus, string> = {
  draft: "Draft",
  review: "Review",
  pending_approval: "Pending approval",
  posted: "Posted",
  cancelled: "Cancelled",
};

function bpsToPercent(bps: number | null): string {
  if (bps === null) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}

export default async function StockCountsPage() {
  const counts = await fetchCounts();

  return (
    <main className="container-p py-10">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          eyebrow="Stock"
          title="Stock counts"
          description="Physical counts reconcile the books to reality. Pick a warehouse, count each item blind, review variances, then post — the system books a single adjustment journal and writes per-item ledger rows."
        />
        <Link href="/app/stock/counts/new" className="btn-primary inline-flex items-center gap-2 text-small">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New count
        </Link>
      </div>

      {counts.length === 0 ? (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">No stock counts yet.</p>
          <p className="mt-1 text-caption text-text-tertiary">
            Run one monthly (or whenever the books feel out of step with the shelf).
          </p>
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Number</th>
                <th className="px-4 py-3 text-left">Warehouse</th>
                <th className="w-28 px-4 py-3 text-left">Count date</th>
                <th className="w-28 px-4 py-3 text-right">Progress</th>
                <th className="w-24 px-4 py-3 text-right">Max variance</th>
                <th className="w-32 px-4 py-3 text-right">Net variance</th>
                <th className="w-36 px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {counts.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <Link href={`/app/stock/counts/${c.id}`} className="text-charcoal underline-offset-4 hover:underline">
                      {c.countNumber ?? "Draft"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    <span className="font-mono text-caption">{c.warehouseCode}</span>
                    <p className="mt-0.5 text-caption text-text-tertiary">{c.warehouseName}</p>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(c.countDate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {c.countedCount} / {c.lineCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {bpsToPercent(c.maxVarianceBps)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {c.totalVarianceValueCents === null
                      ? "—"
                      : formatLKR(c.totalVarianceValueCents)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full border-hairline px-2 py-0.5 text-caption font-medium ${STATUS_CLASS[c.status]}`}>
                      {STATUS_LABEL[c.status]}
                      {c.requiresApproval && c.status === "pending_approval" && (
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                      )}
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
