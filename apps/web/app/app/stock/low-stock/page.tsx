import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangle, Check } from "lucide-react";
import type { LowStockItem } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Low stock" };

async function fetchLowStock(): Promise<{ items: LowStockItem[]; count: number } | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/stock/low-stock`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as { items: LowStockItem[]; count: number };
}

function formatQty(n: number) {
  return n.toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export default async function LowStockPage() {
  const data = await fetchLowStock();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Stock"
        title="Low stock"
        description="Tracked items whose on-hand balance has fallen to or below their reorder point. Set reorder points on each item to have them show up here (and to get a notification the moment they cross the threshold)."
      />

      {!data || data.count === 0 ? (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <Check className="mx-auto h-6 w-6 text-mint-dark" aria-hidden />
          <p className="mt-3 text-body text-text-secondary">Everything is above its reorder point.</p>
          <p className="mt-1 text-caption text-text-tertiary">
            Nothing needs your attention right now.
          </p>
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <div className="flex items-center gap-2 border-b-hairline border-border bg-amber-50 px-5 py-3 text-small text-amber-900">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <span>{data.count} {data.count === 1 ? "item needs" : "items need"} reordering.</span>
          </div>
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Item</th>
                <th className="w-32 px-4 py-3 text-right">On hand</th>
                <th className="w-32 px-4 py-3 text-right">Reorder at</th>
                <th className="w-32 px-4 py-3 text-right">Short by</th>
                <th className="w-44 px-4 py-3 text-left">Last movement</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {data.items.map((it) => (
                <tr key={it.itemId}>
                  <td className="px-4 py-3">
                    <Link href={`/app/items/${it.itemId}`} className="font-medium text-charcoal underline-offset-4 hover:underline">
                      {it.name}
                    </Link>
                    {it.sku && (
                      <p className="text-caption text-text-tertiary">{it.sku}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                    {formatQty(it.onHand)} {it.unit}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {formatQty(it.reorderPoint)} {it.unit}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-danger">
                    {it.shortBy > 0 ? `${formatQty(it.shortBy)} ${it.unit}` : "At threshold"}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {it.lastMovementAt ? formatDate(it.lastMovementAt.slice(0, 10)) : (
                      <span className="text-text-tertiary">No movement yet</span>
                    )}
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
