import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Banknote } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { formatLKR, formatDate } from "@/lib/format";
import type { SupplierPaymentListRow, SupplierPaymentMethod } from "@/lib/api";

export const metadata: Metadata = { title: "Payments out" };

const methodLabels: Record<SupplierPaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  slips: "SLIPS",
  other: "Other",
};

async function fetchPayments(): Promise<SupplierPaymentListRow[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/supplier-payments`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { payments: SupplierPaymentListRow[] };
  return data.payments;
}

export default async function SupplierPaymentsPage() {
  const payments = await fetchPayments();

  const columns: Column<SupplierPaymentListRow>[] = [
    {
      header: "Payment",
      accessor: (p) => (
        <div>
          <p className="font-medium text-charcoal">{p.paymentNumber ?? "—"}</p>
          <p className="text-caption text-text-tertiary">{formatDate(p.paymentDate)}</p>
        </div>
      ),
    },
    {
      header: "Supplier",
      accessor: (p) => <span className="text-charcoal">{p.supplierName}</span>,
    },
    {
      header: "Method",
      accessor: (p) => <span className="text-small">{methodLabels[p.method] ?? p.method}</span>,
    },
    {
      header: "Reference",
      accessor: (p) =>
        p.chequeNumber ? (
          <div>
            <p className="text-small">Cheque {p.chequeNumber}</p>
            {p.reference && <p className="text-caption text-text-tertiary">{p.reference}</p>}
          </div>
        ) : (
          p.reference ?? <span className="text-text-tertiary">—</span>
        ),
    },
    {
      header: "Paid from",
      accessor: (p) => (
        <div>
          <p className="tabular-nums text-small font-medium text-charcoal">{p.bankAccountCode}</p>
          <p className="text-caption text-text-tertiary">{p.bankAccountName}</p>
        </div>
      ),
    },
    {
      header: "Amount",
      align: "right",
      mono: true,
      accessor: (p) => <span className="font-medium text-charcoal">{formatLKR(p.amountCents)}</span>,
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Buy"
        title="Payments sent"
        description="Outgoing payments allocated against supplier bills. Posting here clears AP and moves money out of the bank or cash."
      />

      <div className="mt-6">
        <DataTable
          rows={payments}
          columns={columns}
          empty={
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
                <Banknote className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No supplier payments yet.</p>
              <p className="text-small">
                Pay a bill from its detail page — click{" "}
                <span className="font-medium text-charcoal">Record payment</span>.
              </p>
              <Link href="/app/bills" className="btn-secondary mt-2">
                Go to bills
              </Link>
            </div>
          }
        />
      </div>
    </main>
  );
}
