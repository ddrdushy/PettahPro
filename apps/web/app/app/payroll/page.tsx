import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Briefcase, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { formatLKR, formatDate } from "@/lib/format";
import type { Account, PayrollRun, PayrollRunStatus, StatutoryBalance } from "@/lib/api";
import { StatutoryPanel } from "./statutory-panel";

export const metadata: Metadata = { title: "Payroll runs" };

const statusTone: Record<PayrollRunStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  posted: "bg-mint-surface text-mint-dark",
  paid: "bg-mint text-mint-dark",
  void: "bg-danger-bg/60 text-danger",
};

const statusLabel: Record<PayrollRunStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  paid: "Paid",
  void: "Void",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

async function fetchAll() {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  const [runsRes, statutoryRes, coaRes] = await Promise.all([
    fetch(`${base}/payroll-runs`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/payroll/statutory-summary`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/coa`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
  ]);
  const runs = runsRes.ok ? ((await runsRes.json()) as { runs: PayrollRun[] }).runs : [];
  const statutory = statutoryRes.ok
    ? ((await statutoryRes.json()) as { statutory: StatutoryBalance[] }).statutory
    : [];
  const coa = coaRes.ok ? ((await coaRes.json()) as { accounts: Account[] }).accounts : [];
  const bankAccounts = coa.filter(
    (a) => a.accountType === "asset" && (a.accountSubtype === "bank" || a.accountSubtype === "cash"),
  );
  return { runs, statutory, bankAccounts };
}

export default async function PayrollPage() {
  const { runs, statutory, bankAccounts } = await fetchAll();

  const columns: Column<PayrollRun>[] = [
    {
      header: "Run",
      accessor: (r) => (
        <Link href={`/app/payroll/${r.id}`} className="group block">
          <p className="font-medium text-charcoal group-hover:underline">
            {r.runNumber ?? <span className="italic text-text-tertiary">Draft</span>}
          </p>
          <p className="text-caption text-text-tertiary">
            {MONTHS[r.periodMonth - 1]} {r.periodYear}
          </p>
        </Link>
      ),
    },
    {
      header: "Pay date",
      accessor: (r) => formatDate(r.payDate),
    },
    {
      header: "Employees",
      align: "center",
      accessor: (r) => <span className="tabular-nums">{r.employeeCount}</span>,
    },
    {
      header: "Gross",
      align: "right",
      mono: true,
      accessor: (r) => formatLKR(r.grossCents),
    },
    {
      header: "Deductions",
      align: "right",
      mono: true,
      accessor: (r) => formatLKR(r.epfEmployeeCents + r.payeCents),
    },
    {
      header: "Net pay",
      align: "right",
      mono: true,
      accessor: (r) => (
        <span className="font-medium text-charcoal">{formatLKR(r.netPayCents)}</span>
      ),
    },
    {
      header: "Status",
      align: "center",
      accessor: (r) => (
        <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusTone[r.status]}`}>
          {statusLabel[r.status]}
        </span>
      ),
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Payroll runs"
        description="Monthly payroll. Computes EPF (12% employer / 8% employee), ETF (3%), and PAYE per IRD 2024-25 slabs from each employee's basic salary."
        action={
          <Link href="/app/payroll/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New run
          </Link>
        }
      />

      <div className="mt-6">
        <StatutoryPanel balances={statutory} bankAccounts={bankAccounts} />

        <DataTable
          rows={runs}
          columns={columns}
          empty={
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
                <Briefcase className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No payroll runs yet.</p>
              <p className="text-small">Your first run includes every active employee with a basic salary &gt; 0.</p>
              <Link href="/app/payroll/new" className="btn-primary mt-2">
                <Plus className="h-4 w-4" aria-hidden />
                New run
              </Link>
            </div>
          }
        />
      </div>
    </main>
  );
}
