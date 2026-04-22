"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Receipt } from "lucide-react";
import type { ExpenseClaimRow, ExpenseClaimStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const statusStyles: Record<ExpenseClaimStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  submitted: "bg-warning-bg/60 text-warning",
  approved: "bg-warning-bg/60 text-warning",
  rejected: "bg-danger-bg/60 text-danger",
  paid: "bg-mint-surface text-mint-dark",
  void: "bg-surface-recessed text-text-tertiary",
};

const statusLabels: Record<ExpenseClaimStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
  void: "Void",
};

const filters: Array<{ key: "all" | ExpenseClaimStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
];

export function ExpenseClaimsClient({ claims }: { claims: ExpenseClaimRow[] }) {
  const [filter, setFilter] = useState<"all" | ExpenseClaimStatus>("all");

  const filtered = useMemo(
    () => (filter === "all" ? claims : claims.filter((c) => c.status === filter)),
    [filter, claims],
  );

  const totals = useMemo(() => {
    const submitted = claims.filter((c) => c.status === "submitted");
    const paidThisYear = claims.filter(
      (c) =>
        c.status === "paid" && c.claimDate.startsWith(`${new Date().getUTCFullYear()}-`),
    );
    return {
      pendingCount: submitted.length,
      pendingCents: submitted.reduce((s, c) => s + c.amountCents, 0),
      paidYtdCount: paidThisYear.length,
      paidYtdCents: paidThisYear.reduce((s, c) => s + c.amountCents, 0),
    };
  }, [claims]);

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Expense claims"
        description="Employees submit receipts, a second admin approves. Pay directly from a bank account or bundle the reimbursement into the next payroll run."
        action={
          <Link href="/app/expense-claims/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New claim
          </Link>
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Pending approval"
          value={`${totals.pendingCount}`}
          sub={
            totals.pendingCount === 0
              ? "No claims waiting"
              : `${formatLKR(totals.pendingCents)} across ${totals.pendingCount} submitted`
          }
          emphasis={totals.pendingCount > 0}
        />
        <SummaryCard
          label="Paid this year"
          value={formatLKR(totals.paidYtdCents)}
          sub={`${totals.paidYtdCount} reimbursements`}
        />
        <SummaryCard
          label="Total claims"
          value={`${claims.length}`}
          sub="All time, excluding voided drafts"
        />
      </section>

      <section className="mt-6 flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border-hairline px-3 py-1 text-small ${
              filter === f.key
                ? "border-charcoal bg-charcoal text-white"
                : "border-border bg-surface-elevated text-text-secondary hover:border-charcoal/30"
            }`}
          >
            {f.label}
          </button>
        ))}
      </section>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <Receipt className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No expense claims here.</p>
          <p className="mt-1 text-small text-text-secondary">
            Travel, meals, fuel, communication, misc — five default categories are seeded. Start a claim above.
          </p>
          <Link href="/app/expense-claims/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New claim
          </Link>
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-32 px-4 py-3 text-left">Claim #</th>
                <th className="w-28 px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="w-24 px-4 py-3 text-left">Method</th>
                <th className="w-28 px-4 py-3 text-right">Amount</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {filtered.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-surface-recessed/40">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    <Link
                      href={`/app/expense-claims/${c.id}`}
                      className="text-charcoal underline-offset-4 hover:underline"
                    >
                      {c.claimNumber ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {formatDate(c.claimDate)}
                  </td>
                  <td className="px-4 py-3 text-text-primary">
                    {c.employeeName}
                    {c.employeeCode && (
                      <span className="ml-2 text-caption text-text-tertiary">
                        {c.employeeCode}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {c.categoryName ?? <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {c.disbursementMethod === "direct" ? "Direct pay" : "Payroll"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatLKR(c.amountCents)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[c.status]}`}
                    >
                      {statusLabels[c.status]}
                    </span>
                  </td>
                </tr>
              ))}
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
