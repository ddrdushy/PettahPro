import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { formatLKR, formatDate } from "@/lib/format";
import type { InvoiceListRow } from "@/lib/api";

export const metadata: Metadata = { title: "Invoices" };

type Channel = "web" | "pos" | "all";

async function fetchInvoices(channel: Channel): Promise<InvoiceListRow[]> {
  const qs = `?channel=${channel}`;
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/invoices${qs}`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { invoices: InvoiceListRow[] };
  return data.invoices;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { channel?: string };
}) {
  // Default view hides the POS tape — cashier receipts otherwise drown
  // the list AR uses daily. `?channel=pos` or `?channel=all` for recon.
  const channel: Channel =
    searchParams.channel === "pos" ? "pos" : searchParams.channel === "all" ? "all" : "web";
  const invoices = await fetchInvoices(channel);

  const columns: Column<InvoiceListRow>[] = [
    {
      header: "Invoice",
      accessor: (inv) => (
        <Link href={`/app/invoices/${inv.id}`} className="group block">
          <p className="font-medium text-charcoal group-hover:underline">
            {inv.invoiceNumber ?? <span className="italic text-text-tertiary">Draft</span>}
          </p>
          <p className="text-caption text-text-tertiary">
            Issued {formatDate(inv.issueDate)}
          </p>
        </Link>
      ),
    },
    {
      header: "Customer",
      accessor: (inv) => <span className="text-charcoal">{inv.customerName}</span>,
    },
    {
      header: "Due",
      accessor: (inv) => formatDate(inv.dueDate),
    },
    {
      header: "Subtotal",
      align: "right",
      mono: true,
      accessor: (inv) => formatLKR(inv.subtotalCents),
    },
    {
      header: "Tax",
      align: "right",
      mono: true,
      accessor: (inv) =>
        inv.taxCents > 0 ? formatLKR(inv.taxCents) : <span className="text-text-tertiary">—</span>,
    },
    {
      header: "Total",
      align: "right",
      mono: true,
      accessor: (inv) => <span className="font-medium text-charcoal">{formatLKR(inv.totalCents)}</span>,
    },
    {
      header: "Status",
      align: "center",
      accessor: (inv) => <StatusBadge status={inv.status} />,
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Sell"
        title="Invoices"
        description="Every invoice raised, posted, paid, and voided. Drafts don't hit the ledger — post to record."
        action={
          <div className="flex gap-2">
            <Link href="/app/invoices/batch" className="btn-secondary">
              From delivery notes
            </Link>
            <Link href="/app/invoices/new" className="btn-primary">
              <Plus className="h-4 w-4" aria-hidden />
              New invoice
            </Link>
          </div>
        }
      />

      <div className="mt-6 flex items-center gap-2 text-small">
        <span className="text-text-tertiary">View:</span>
        {(
          [
            { value: "web", label: "Billing" },
            { value: "pos", label: "POS sales" },
            { value: "all", label: "All channels" },
          ] as { value: Channel; label: string }[]
        ).map((opt) => (
          <Link
            key={opt.value}
            href={opt.value === "web" ? "/app/invoices" : `/app/invoices?channel=${opt.value}`}
            className={
              opt.value === channel
                ? "rounded-full bg-charcoal px-3 py-1 text-offwhite"
                : "rounded-full border-hairline border-border px-3 py-1 text-text-secondary hover:border-charcoal hover:text-charcoal"
            }
          >
            {opt.label}
          </Link>
        ))}
      </div>

      <div className="mt-4">
        <DataTable
          rows={invoices}
          columns={columns}
          empty={
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
                <FileText className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No invoices yet.</p>
              <p className="text-small">Create your first invoice — it's the activation moment.</p>
              <Link href="/app/invoices/new" className="btn-primary mt-2">
                <Plus className="h-4 w-4" aria-hidden />
                New invoice
              </Link>
            </div>
          }
        />
      </div>
    </main>
  );
}
