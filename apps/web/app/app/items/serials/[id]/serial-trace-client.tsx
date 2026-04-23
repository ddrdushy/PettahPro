"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ItemSerial } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate, formatLKR } from "@/lib/format";

const STATUS_LABEL: Record<ItemSerial["status"], string> = {
  in_stock: "In stock",
  sold: "Sold",
  returned: "Returned",
  scrapped: "Scrapped",
};

const STATUS_CLASS: Record<ItemSerial["status"], string> = {
  in_stock: "bg-mint-surface/60 text-mint-dark border-mint/40",
  sold: "bg-surface-recessed text-text-secondary border-border",
  returned: "bg-amber-50 text-amber-800 border-amber-200",
  scrapped: "bg-danger-bg/60 text-danger border-danger/40",
};

const DOC_HREF: Record<string, (id: string) => string> = {
  invoice: (id) => `/app/invoices/${id}`,
  bill: (id) => `/app/bills/${id}`,
};

const DOC_LABEL: Record<string, string> = {
  invoice: "Invoice",
  bill: "Bill",
};

export function SerialTraceClient({
  serial,
  item,
  batch,
}: {
  serial: ItemSerial;
  item: { id: string; name: string; sku: string | null } | null;
  batch: { id: string; batchNumber: string; expiryDate: string | null } | null;
}) {
  const acquiredHref =
    serial.acquiredDocumentType && serial.acquiredDocumentId
      ? DOC_HREF[serial.acquiredDocumentType]?.(serial.acquiredDocumentId)
      : undefined;
  const soldHref =
    serial.soldDocumentType && serial.soldDocumentId
      ? DOC_HREF[serial.soldDocumentType]?.(serial.soldDocumentId)
      : undefined;

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link
          href={item ? `/app/items/${item.id}` : "/app/items"}
          className="btn-link text-small"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {item ? "Back to item" : "Back to items"}
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          eyebrow="Serial trace"
          title={serial.serialNumber}
          description={item ? item.name : "Unit trace — acquisition through sale."}
        />
        <span
          className={`inline-flex items-center rounded-full border-hairline px-2 py-0.5 text-caption font-medium ${STATUS_CLASS[serial.status]}`}
        >
          {STATUS_LABEL[serial.status]}
        </span>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Item" value={item?.name ?? "—"} />
        <Stat label="SKU" value={item?.sku ?? "—"} />
        <Stat
          label="Batch"
          value={batch ? batch.batchNumber : "—"}
          href={batch ? `/app/items/batches/${batch.id}` : undefined}
        />
        <Stat label="Unit cost" value={formatLKR(serial.unitCostCents)} />
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">
            Acquired
          </p>
          <dl className="mt-3 space-y-2 text-small">
            <Row label="Received" value={formatDate(serial.acquiredAt)} />
            <Row
              label="Source"
              value={
                serial.acquiredDocumentType
                  ? DOC_LABEL[serial.acquiredDocumentType] ?? serial.acquiredDocumentType
                  : "—"
              }
              href={acquiredHref}
            />
          </dl>
        </div>
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">
            Sold
          </p>
          <dl className="mt-3 space-y-2 text-small">
            <Row
              label="Sold on"
              value={serial.soldAt ? formatDate(serial.soldAt) : "—"}
            />
            <Row
              label="Document"
              value={
                serial.soldDocumentType
                  ? DOC_LABEL[serial.soldDocumentType] ?? serial.soldDocumentType
                  : "—"
              }
              href={soldHref}
            />
            <Row
              label="Warranty expires"
              value={
                serial.warrantyExpiresAt
                  ? formatDate(serial.warrantyExpiresAt)
                  : "—"
              }
            />
          </dl>
        </div>
      </section>

      {serial.notes && (
        <p className="mt-6 rounded-md border-hairline border-border bg-surface-elevated px-4 py-3 text-small text-text-secondary">
          {serial.notes}
        </p>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="rounded-md border-hairline border-border bg-surface-elevated p-3">
      <p className="text-caption text-text-tertiary">{label}</p>
      {href ? (
        <Link
          href={href}
          className="mt-1 block text-body font-medium text-charcoal underline-offset-4 hover:underline"
        >
          {value}
        </Link>
      ) : (
        <p className="mt-1 text-body font-medium text-charcoal">{value}</p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="text-charcoal">
        {href ? (
          <Link href={href} className="underline-offset-4 hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
