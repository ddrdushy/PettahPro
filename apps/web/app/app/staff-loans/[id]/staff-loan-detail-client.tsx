"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Send, XCircle, Ban } from "lucide-react";
import {
  api,
  ApiError,
  type Account,
  type EmployeeLoan,
  type EmployeeLoanRow,
  type LoanScheduleRow,
  type LoanStatus,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate, formatLKR } from "@/lib/format";

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

const scheduleStyles: Record<LoanScheduleRow["status"], string> = {
  pending: "bg-surface-recessed text-text-secondary",
  paid: "bg-mint-surface text-mint-dark",
  waived: "bg-danger-bg/60 text-danger",
};

export function StaffLoanDetailClient({
  loan: initialLoan,
  schedule: initialSchedule,
  accounts,
}: {
  loan: EmployeeLoanRow;
  schedule: LoanScheduleRow[];
  accounts: Account[];
}) {
  const router = useRouter();
  const [loan, setLoan] = useState(initialLoan);
  const [schedule] = useState(initialSchedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bankAccounts = accounts.filter(
    (a) =>
      a.isActive &&
      (a.accountSubtype === "bank" || a.accountSubtype === "cash"),
  );

  const [disbursementDate, setDisbursementDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [disbursementAccountId, setDisbursementAccountId] = useState(
    bankAccounts[0]?.id ?? "",
  );
  const [firstInstallmentDate, setFirstInstallmentDate] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [writeOffReason, setWriteOffReason] = useState("");

  async function runAction(fn: () => Promise<{ loan: EmployeeLoan }>) {
    setError(null);
    setBusy(true);
    try {
      const res = await fn();
      setLoan({ ...loan, ...res.loan });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't complete action.");
    } finally {
      setBusy(false);
    }
  }

  const outstanding = loan.principalOutstandingCents + loan.interestOutstandingCents;
  const paidInstallments = schedule.filter((r) => r.status === "paid").length;

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/staff-loans" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to staff loans
        </Link>
      </div>

      <PageHeader
        eyebrow={`Staff loan · ${loan.loanTypeName ?? "Ad-hoc"}`}
        title={`${loan.employeeName}${loan.employeeCode ? ` · ${loan.employeeCode}` : ""}`}
        description={
          loan.loanNumber
            ? `${loan.loanNumber} · Applied ${formatDate(loan.appliedAt.slice(0, 10))}`
            : `Applied ${formatDate(loan.appliedAt.slice(0, 10))}`
        }
        action={
          <span
            className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[loan.status]}`}
          >
            {statusLabels[loan.status]}
          </span>
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        <StatCard label="Principal" value={formatLKR(loan.principalCents)} sub={`${loan.tenureMonths}-month tenure`} />
        <StatCard
          label="Interest"
          value={formatLKR(loan.totalInterestCents)}
          sub={`${(loan.interestRateBps / 100).toFixed(2)}% flat`}
        />
        <StatCard
          label="Monthly EMI"
          value={loan.emiCents > 0 ? formatLKR(loan.emiCents) : "—"}
          sub={loan.firstInstallmentDate ? `First due ${formatDate(loan.firstInstallmentDate)}` : "Not disbursed"}
          emphasis
        />
        <StatCard
          label="Outstanding"
          value={formatLKR(outstanding)}
          sub={
            loan.status === "disbursed"
              ? `${paidInstallments} of ${loan.tenureMonths} paid`
              : statusLabels[loan.status]
          }
        />
      </section>

      {loan.applicationReason && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Application reason</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{loan.applicationReason}</p>
        </section>
      )}

      {/* Action panel */}
      <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
        <h2 className="text-h3 text-charcoal">Actions</h2>

        {loan.status === "draft" && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => runAction(() => api.approveEmployeeLoan(loan.id))}
              disabled={busy}
              className="btn-primary disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              Approve
            </button>
            <div className="flex flex-1 items-center gap-2">
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason to cancel (optional)"
                className="input flex-1"
              />
              <button
                type="button"
                onClick={() =>
                  runAction(() => api.cancelEmployeeLoan(loan.id, cancelReason ? { reason: cancelReason } : undefined))
                }
                disabled={busy}
                className="btn-secondary disabled:opacity-50"
              >
                <Ban className="h-4 w-4" aria-hidden />
                Cancel
              </button>
            </div>
            <p className="w-full text-caption text-text-tertiary">
              The applicant can't approve their own loan — a second admin must approve.
            </p>
          </div>
        )}

        {loan.status === "approved" && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Disbursement date
              </label>
              <input
                type="date"
                value={disbursementDate}
                onChange={(e) => setDisbursementDate(e.target.value)}
                className="input mt-1.5"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Pay from account
              </label>
              <select
                value={disbursementAccountId}
                onChange={(e) => setDisbursementAccountId(e.target.value)}
                className="input mt-1.5"
              >
                <option value="">Select bank / cash…</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                First installment (optional)
              </label>
              <input
                type="date"
                value={firstInstallmentDate}
                onChange={(e) => setFirstInstallmentDate(e.target.value)}
                className="input mt-1.5"
              />
            </div>
            <div className="md:col-span-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  runAction(async () => {
                    if (!disbursementAccountId) throw new ApiError(400, "MISSING", "Pick a bank account.");
                    const res = await api.disburseEmployeeLoan(loan.id, {
                      disbursementDate,
                      disbursementAccountId,
                      firstInstallmentDate: firstInstallmentDate || undefined,
                    });
                    return { loan: res.loan };
                  })
                }
                disabled={busy || !disbursementAccountId}
                className="btn-primary disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                Disburse &amp; post JE
              </button>
              <button
                type="button"
                onClick={() =>
                  runAction(() => api.cancelEmployeeLoan(loan.id, cancelReason ? { reason: cancelReason } : undefined))
                }
                disabled={busy}
                className="btn-secondary disabled:opacity-50"
              >
                <Ban className="h-4 w-4" aria-hidden />
                Cancel
              </button>
              <p className="w-full text-caption text-text-tertiary">
                Posts DR 1150 Employee loans receivable / CR selected bank for the principal. Interest accrues row-by-row as EMIs are claimed in payroll.
              </p>
            </div>
          </div>
        )}

        {loan.status === "disbursed" && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex flex-1 items-center gap-2">
              <input
                type="text"
                value={writeOffReason}
                onChange={(e) => setWriteOffReason(e.target.value)}
                placeholder="Write-off reason (required)"
                className="input flex-1"
              />
              <button
                type="button"
                onClick={() =>
                  runAction(async () => {
                    if (!writeOffReason.trim())
                      throw new ApiError(400, "MISSING", "Reason required for write-off.");
                    return api.writeOffEmployeeLoan(loan.id, { reason: writeOffReason.trim() });
                  })
                }
                disabled={busy}
                className="btn-danger disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" aria-hidden />
                Write off
              </button>
            </div>
            <p className="w-full text-caption text-text-tertiary">
              Write-off moves the outstanding principal to bad debt and waives remaining installments. Journal posts today.
            </p>
          </div>
        )}

        {(loan.status === "closed" ||
          loan.status === "written_off" ||
          loan.status === "cancelled") && (
          <p className="mt-4 text-small text-text-secondary">
            This loan is {statusLabels[loan.status].toLowerCase()} — no further actions available.
          </p>
        )}

        {error && <p className="mt-3 text-small text-danger">{error}</p>}
      </section>

      {/* Schedule */}
      {schedule.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-h3 text-charcoal">Repayment schedule</h2>
            <span className="text-small text-text-secondary">
              {schedule.length} installments
            </span>
          </div>
          <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <table className="w-full text-small">
              <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="w-12 px-4 py-3 text-left">#</th>
                  <th className="w-28 px-4 py-3 text-left">Due date</th>
                  <th className="w-28 px-4 py-3 text-right">Principal</th>
                  <th className="w-28 px-4 py-3 text-right">Interest</th>
                  <th className="w-28 px-4 py-3 text-right">EMI</th>
                  <th className="w-32 px-4 py-3 text-right">Closing balance</th>
                  <th className="w-24 px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-left">Applied in</th>
                </tr>
              </thead>
              <tbody className="divide-y-hairline divide-border">
                {schedule.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">{r.installmentNo}</td>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(r.dueDate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatLKR(r.principalCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                      {formatLKR(r.interestCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                      {formatLKR(r.totalCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                      {formatLKR(r.closingBalanceCents)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${scheduleStyles[r.status]}`}
                      >
                        {r.status === "paid" ? "Paid" : r.status === "waived" ? "Waived" : "Pending"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {r.appliedInRunId ? (
                        <Link
                          href={`/app/payroll/${r.appliedInRunId}`}
                          className="btn-link text-small"
                        >
                          View run
                        </Link>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {loan.disbursementJournalId && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Disbursement journal</p>
          <p className="mt-2 text-small">
            <Link href={`/app/journals/${loan.disbursementJournalId}`} className="btn-link">
              View GL entry
            </Link>
          </p>
        </section>
      )}

      {loan.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{loan.notes}</p>
        </section>
      )}
    </main>
  );
}

function StatCard({
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
