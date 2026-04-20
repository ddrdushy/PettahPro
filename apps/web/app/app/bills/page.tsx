import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Plus, Receipt } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { formatLKR, formatDate } from "@/lib/format";
import type { BillListRow } from "@/lib/api";

export const metadata: Metadata = { title: "Bills" };

async function fetchBills(): Promise<BillListRow[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/bills`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { bills: BillListRow[] };
  return data.bills;
}

export default async function BillsPage() {
  const bills = await fetchBills();

  const columns: Column<BillListRow>[] = [
    {
      header: "Bill",
      accessor: (b) => (
        <Link href={`/app/bills/${b.id}`} className="group block">
          <p className="font-medium text-charcoal group-hover:underline">
            {b.internalReference ?? <span className="italic text-text-tertiary">Draft</span>}
          </p>
          <p className="text-caption text-text-tertiary">
            {b.supplierBillNumber ? `Supplier: ${b.supplierBillNumber}` : "No supplier ref"}
          </p>
        </Link>
      ),
    },
    {
      header: "Supplier",
      accessor: (b) => <span className="text-charcoal">{b.supplierName}</span>,
    },
    {
      header: "Bill date",
      accessor: (b) => formatDate(b.billDate),
    },
    {
      header: "Due",
      accessor: (b) => formatDate(b.dueDate),
    },
    {
      header: "Total",
      align: "right",
      mono: true,
      accessor: (b) => (
        <span className="font-medium text-charcoal">{formatLKR(b.totalCents)}</span>
      ),
    },
    {
      header: "Status",
      align: "center",
      accessor: (b) => <StatusBadge status={b.status} />,
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Buy"
        title="Bills"
        description="Supplier bills captured against your books. Posting records the expense and the AP liability."
        action={
          <Link href="/app/bills/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New bill
          </Link>
        }
      />

      <div className="mt-6">
        <DataTable
          rows={bills}
          columns={columns}
          empty={
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
                <Receipt className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No bills yet.</p>
              <p className="text-small">Record a supplier bill to start tracking AP.</p>
              <Link href="/app/bills/new" className="btn-primary mt-2">
                <Plus className="h-4 w-4" aria-hidden />
                New bill
              </Link>
            </div>
          }
        />
      </div>
    </main>
  );
}
