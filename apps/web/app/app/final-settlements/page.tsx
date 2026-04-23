import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { LogOut } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { formatLKR, formatDate } from "@/lib/format";
import type { FinalSettlementRow, FinalSettlementStatus } from "@/lib/api";

export const metadata: Metadata = { title: "Final settlements" };

const statusTone: Record<FinalSettlementStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  pending_approval: "bg-warning-bg text-warning",
  approved: "bg-mint-surface text-mint-dark",
  posted: "bg-mint text-mint-dark",
  paid: "bg-mint text-mint-dark",
  cancelled: "bg-danger-bg/60 text-danger",
};

const statusLabel: Record<FinalSettlementStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  posted: "Posted",
  paid: "Paid",
  cancelled: "Cancelled",
};

async function fetchAll() {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  const res = await fetch(`${base}/final-settlements`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return [] as FinalSettlementRow[];
  return ((await res.json()) as { settlements: FinalSettlementRow[] }).settlements;
}

export default async function FinalSettlementsPage() {
  const settlements = await fetchAll();

  const columns: Column<FinalSettlementRow>[] = [
    {
      header: "Settlement",
      accessor: (s) => (
        <Link href={`/app/final-settlements/${s.id}`} className="group block">
          <p className="font-medium text-charcoal group-hover:underline">
            {s.settlementNumber ?? (
              <span className="italic text-text-tertiary">Draft</span>
            )}
          </p>
          <p className="text-caption text-text-tertiary">{s.employeeFullName}</p>
        </Link>
      ),
    },
    {
      header: "Exit date",
      accessor: (s) => formatDate(s.exitDate),
    },
    {
      header: "Years",
      align: "center",
      accessor: (s) => (
        <span className="tabular-nums">{Number(s.yearsOfService).toFixed(2)}</span>
      ),
    },
    {
      header: "Gross",
      align: "right",
      mono: true,
      accessor: (s) => formatLKR(s.grossCents),
    },
    {
      header: "Deductions",
      align: "right",
      mono: true,
      accessor: (s) => formatLKR(s.totalDeductionsCents),
    },
    {
      header: "Net payable",
      align: "right",
      mono: true,
      accessor: (s) => (
        <span className="font-medium text-charcoal">
          {formatLKR(s.netPayableCents)}
        </span>
      ),
    },
    {
      header: "Status",
      align: "center",
      accessor: (s) => (
        <span
          className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusTone[s.status]}`}
        >
          {statusLabel[s.status]}
        </span>
      ),
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Final settlements"
        description="Compute gratuity, leave encashment, notice pay, loan recovery, and final PAYE/EPF/ETF for exiting employees. Prepare a settlement from the employee lifecycle drawer."
      />

      <div className="mt-6">
        <DataTable
          rows={settlements}
          columns={columns}
          empty={
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
                <LogOut className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No final settlements yet.</p>
              <p className="text-small">
                Final settlements are created when an exiting employee's lifecycle
                is recorded from the <Link href="/app/employees" className="underline">employees</Link> page.
              </p>
            </div>
          }
        />
      </div>
    </main>
  );
}
