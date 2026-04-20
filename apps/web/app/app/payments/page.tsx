import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { formatLKR, formatDate } from "@/lib/format";
import type { PaymentListRow, PaymentMethod } from "@/lib/api";

export const metadata: Metadata = { title: "Payments" };

const methodLabels: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  lankaqr: "LankaQR",
  payhere: "PayHere",
  frimi: "FriMi",
  genie: "Genie",
  ipay: "iPay",
  other: "Other",
};

async function fetchPayments(): Promise<PaymentListRow[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/payments`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { payments: PaymentListRow[] };
  return data.payments;
}

export default async function PaymentsPage() {
  const payments = await fetchPayments();

  const columns: Column<PaymentListRow>[] = [
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
      header: "Customer",
      accessor: (p) => <span className="text-charcoal">{p.customerName}</span>,
    },
    {
      header: "Method",
      accessor: (p) => (
        <span className="text-small">{methodLabels[p.method] ?? p.method}</span>
      ),
    },
    {
      header: "Reference",
      accessor: (p) => p.reference ?? <span className="text-text-tertiary">—</span>,
    },
    {
      header: "Received to",
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
        eyebrow="Sell"
        title="Payments received"
        description="Every receipt allocated against a customer invoice. Posting here clears AR and moves money into your bank or cash."
      />

      <div className="mt-6">
        <DataTable
          rows={payments}
          columns={columns}
          empty={
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
                <Wallet className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No payments yet.</p>
              <p className="text-small">
                Record a payment from an invoice — open a posted invoice and click{" "}
                <span className="font-medium text-charcoal">Record payment</span>.
              </p>
              <Link href="/app/invoices" className="btn-secondary mt-2">
                Go to invoices
              </Link>
            </div>
          }
        />
      </div>
    </main>
  );
}
