"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { ExpiringBatchRow } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

function daysUntil(iso: string): number {
  const target = new Date(iso + "T00:00:00Z").getTime();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86_400_000);
}

function formatQty(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export function ExpiringBatchesClient({
  days,
  cutoff,
  batches,
  windows,
}: {
  days: number;
  cutoff: string;
  batches: ExpiringBatchRow[];
  windows: number[];
}) {
  const sorted = useMemo(
    () =>
      [...batches].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)),
    [batches],
  );

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Reports"
        title="Expiring batches"
        description={`Batches with remaining stock expiring on or before ${formatDate(cutoff)}. Sorted by soonest-to-expire.`}
      />

      <nav className="mt-6 flex flex-wrap gap-1 border-b-hairline border-border">
        {windows.map((w) => {
          const isActive = w === days;
          return (
            <Link
              key={w}
              href={`/app/reports/expiring-batches?days=${w}`}
              className={`border-b-2 px-3 py-2 text-small ${
                isActive
                  ? "border-charcoal text-charcoal"
                  : "border-transparent text-text-secondary hover:text-charcoal"
              }`}
            >
              Next {w} days
            </Link>
          );
        })}
      </nav>

      {sorted.length === 0 ? (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">
            No batches expire in the next {days} days.
          </p>
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Item</th>
                <th className="px-4 py-3 text-left">Batch #</th>
                <th className="w-32 px-4 py-3 text-left">Expires</th>
                <th className="w-24 px-4 py-3 text-right">In</th>
                <th className="w-32 px-4 py-3 text-right">Remaining qty</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {sorted.map((b) => {
                const d = daysUntil(b.expiryDate);
                const isExpired = d < 0;
                const isUrgent = d >= 0 && d <= 7;
                return (
                  <tr key={b.batchId}>
                    <td className="px-4 py-2">
                      <Link
                        href={`/app/items/${b.itemId}`}
                        className="text-charcoal underline-offset-4 hover:underline"
                      >
                        {b.itemName}
                      </Link>
                      {b.itemSku && (
                        <span className="ml-2 text-caption text-text-tertiary">
                          {b.itemSku}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-caption text-charcoal">
                      <Link
                        href={`/app/items/batches/${b.batchId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {b.batchNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {formatDate(b.expiryDate)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {isExpired ? (
                        <span className="inline-flex items-center gap-1 text-danger">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                          {Math.abs(d)}d ago
                        </span>
                      ) : (
                        <span className={isUrgent ? "text-amber-700" : "text-text-secondary"}>
                          {d}d
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-charcoal">
                      {formatQty(b.remainingQty)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
