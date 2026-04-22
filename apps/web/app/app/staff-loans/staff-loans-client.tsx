"use client";

import Link from "next/link";
import { Plus, Wallet } from "lucide-react";
import type { EmployeeLoanRow, LoanStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const statusStyles: Record<LoanStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  approved: "bg-warning-bg/60 text-warning",
  disbursed: "bg-mint-surface text-mint-dark",
  closed: "bg-surface-recessed text-text-secondary",
  written_off: "bg-danger-bg/60 text-danger",
  cancelled: "bg-surface-recessed text-text-tertiary",
};

const statusLabels: Record<LoanStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  disbursed: "Disbursed",
  closed: "Closed",
  written_off: "Written off",
  cancelled: "Cancelled",
};

export function StaffLoansClient({ loans }: { loans: EmployeeLoanRow[] }) {
  const totals = loans.reduce(
    (acc, l) => {
      if (l.status === "disbursed") {
        acc.activeCount += 1;
        acc.outstanding += l.principalOutstandingCents + l.interestOutstandingCents;
      }
      if (l.disbursedAt) acc.disbursed += l.principalCents;
      return acc;
    },
    { activeCount: 0, outstanding: 0, disbursed: 0 },
  );

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Staff loans"
        description="Apply, approve, disburse. EMIs auto-deduct from the next payroll run and flow through to the Employee loans receivable account."
        action={
          <Link href="/app/staff-loans/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New loan
          </Link>
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Active loans"
          value={`${totals.activeCount}`}
          sub={`${loans.length} total applications`}
        />
        <SummaryCard
          label="Total outstanding"
          value={formatLKR(totals.outstanding)}
          sub="Principal + interest on disbursed loans"
          emphasis
        />
        <SummaryCard
          label="Disbursed lifetime"
          value={formatLKR(totals.disbursed)}
          sub="Sum of all principal disbursed"
        />
      </section>

      {loans.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <Wallet className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No staff loans yet.</p>
          <p className="mt-1 text-small text-text-secondary">
            Festival, salary advance, emergency, housing, vehicle — five types seeded at signup. Start an application above.
          </p>
          <Link href="/app/staff-loans/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New loan
          </Link>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-32 px-4 py-3 text-left">Loan #</th>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="w-28 px-4 py-3 text-right">Principal</th>
                <th className="w-20 px-4 py-3 text-right">Tenure</th>
                <th className="w-28 px-4 py-3 text-right">EMI</th>
                <th className="w-28 px-4 py-3 text-right">Outstanding</th>
                <th className="w-28 px-4 py-3 text-left">Applied</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {loans.map((l) => {
                const outstanding = l.principalOutstandingCents + l.interestOutstandingCents;
                return (
                  <tr key={l.id} className="transition-colors hover:bg-surface-recessed/40">
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      <Link
                        href={`/app/staff-loans/${l.id}`}
                        className="text-charcoal underline-offset-4 hover:underline"
                      >
                        {l.loanNumber ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-primary">
                      {l.employeeName}
                      {l.employeeCode && (
                        <span className="ml-2 text-caption text-text-tertiary">{l.employeeCode}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {l.loanTypeName ?? <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatLKR(l.principalCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                      {l.tenureMonths} mo
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                      {l.emiCents > 0 ? formatLKR(l.emiCents) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                      {l.status === "disbursed" ? formatLKR(outstanding) : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      {formatDate(l.appliedAt.slice(0, 10))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[l.status]}`}
                      >
                        {statusLabels[l.status]}
                      </span>
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

function SummaryCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border-hairline p-5 ${
        emphasis ? "border-charcoal/20 bg-mint-surface/40" : "border-border bg-surface-elevated"
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-2 text-h3 text-charcoal">{value}</p>
      <p className="mt-1 text-caption text-text-secondary">{sub}</p>
    </div>
  );
}
