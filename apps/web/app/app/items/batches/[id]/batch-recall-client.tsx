"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { BatchRecallAllocation, ItemBatch } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate, formatLKR } from "@/lib/format";

function formatQty(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

const DOC_HREF: Record<string, (id: string) => string> = {
  invoice: (id) => `/app/invoices/${id}`,
  bill: (id) => `/app/bills/${id}`,
  credit_note: (id) => `/app/credit-notes/${id}`,
  debit_note: (id) => `/app/debit-notes/${id}`,
};

const DOC_LABEL: Record<string, string> = {
  invoice: "Invoice",
  bill: "Bill",
  credit_note: "Credit note",
  debit_note: "Debit note",
};

export function BatchRecallClient({
  batch,
  allocations,
}: {
  batch: ItemBatch;
  allocations: BatchRecallAllocation[];
}) {
  const sorted = [...allocations].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  );
  const originalN = Number(batch.originalQty);
  const remainingN = Number(batch.remainingQty);
  const consumedN = originalN - remainingN;

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href={`/app/items/${batch.itemId}`} className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to item
        </Link>
      </div>

      <PageHeader
        eyebrow="Batch recall"
        title={`Batch ${batch.batchNumber}`}
        description="Every outbound allocation traced back to this lot. Follow the links to see which customer received which units."
      />

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Received" value={formatDate(batch.receivedAt)} />
        <Stat label="Expiry" value={batch.expiryDate ? formatDate(batch.expiryDate) : "—"} />
        <Stat label="Original qty" value={formatQty(batch.originalQty)} />
        <Stat label="Remaining qty" value={formatQty(batch.remainingQty)} />
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Consumed" value={formatQty(String(consumedN))} />
        <Stat label="Unit cost" value={formatLKR(batch.unitCostCents)} />
        <Stat label="Mfg date" value={batch.mfgDate ? formatDate(batch.mfgDate) : "—"} />
        <Stat label="Allocations" value={allocations.length.toString()} />
      </section>

      {batch.notes && (
        <p className="mt-4 rounded-md border-hairline border-border bg-surface-elevated px-4 py-3 text-small text-text-secondary">
          {batch.notes}
        </p>
      )}

      <h2 className="mt-8 text-h3 text-charcoal">Outbound allocations</h2>

      {sorted.length === 0 ? (
        <div className="mt-3 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">
            Nothing has been drawn from this batch yet.
          </p>
        </div>
      ) : (
        <section className="mt-3 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-40 px-4 py-3 text-left">When</th>
                <th className="px-4 py-3 text-left">Document</th>
                <th className="w-32 px-4 py-3 text-right">Qty</th>
                <th className="w-32 px-4 py-3 text-right">Unit cost</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {sorted.map((a) => {
                const label = a.sourceDocumentType
                  ? DOC_LABEL[a.sourceDocumentType] ?? a.sourceDocumentType
                  : "—";
                const href =
                  a.sourceDocumentType && a.sourceDocumentId
                    ? DOC_HREF[a.sourceDocumentType]?.(a.sourceDocumentId)
                    : undefined;
                return (
                  <tr key={a.ledgerId}>
                    <td className="px-4 py-2 tabular-nums text-text-secondary">
                      {formatDate(a.occurredAt)}
                    </td>
                    <td className="px-4 py-2 text-charcoal">
                      {href ? (
                        <Link href={href} className="underline-offset-4 hover:underline">
                          {label}
                        </Link>
                      ) : (
                        <span className="text-text-secondary">{label}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatQty(a.allocationQty)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatLKR(a.allocationUnitCostCents)}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border-hairline border-border bg-surface-elevated p-3">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="mt-1 text-body font-medium text-charcoal">{value}</p>
    </div>
  );
}
