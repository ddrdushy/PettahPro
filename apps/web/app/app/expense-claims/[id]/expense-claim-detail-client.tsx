"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Loader2,
  Send,
  XCircle,
} from "lucide-react";
import {
  api,
  ApiError,
  type Account,
  type ExpenseClaim,
  type ExpenseClaimRow,
  type ExpenseClaimStatus,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate, formatLKR } from "@/lib/format";

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

export function ExpenseClaimDetailClient({
  claim: initialClaim,
  accounts,
}: {
  claim: ExpenseClaimRow;
  accounts: Account[];
}) {
  const router = useRouter();
  const [claim, setClaim] = useState(initialClaim);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bankAccounts = accounts.filter(
    (a) =>
      a.isActive && (a.accountSubtype === "bank" || a.accountSubtype === "cash"),
  );

  const [paymentAccountId, setPaymentAccountId] = useState(
    bankAccounts[0]?.id ?? "",
  );
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [paymentReference, setPaymentReference] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [voidReason, setVoidReason] = useState("");

  async function runAction(fn: () => Promise<{ claim: ExpenseClaim }>) {
    setError(null);
    setBusy(true);
    try {
      const res = await fn();
      setClaim({ ...claim, ...res.claim });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't complete action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/expense-claims" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to expense claims
        </Link>
      </div>

      <PageHeader
        eyebrow={`Expense claim · ${claim.categoryName ?? "Uncategorised"}`}
        title={`${claim.employeeName}${
          claim.employeeCode ? ` · ${claim.employeeCode}` : ""
        }`}
        description={
          claim.claimNumber
            ? `${claim.claimNumber} · ${formatDate(claim.claimDate)}`
            : `${formatDate(claim.claimDate)}`
        }
        action={
          <span
            className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[claim.status]}`}
          >
            {statusLabels[claim.status]}
          </span>
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Amount" value={formatLKR(claim.amountCents)} emphasis />
        <StatCard
          label="Disbursement"
          value={claim.disbursementMethod === "direct" ? "Direct pay" : "Payroll"}
          sub={
            claim.disbursementMethod === "direct"
              ? "Posts DR expense / CR bank at approval."
              : "Bundled into the next payroll run."
          }
        />
        <StatCard
          label="Tax treatment"
          value={claim.isTaxable ? "Taxable" : "Tax-free"}
          sub={
            claim.isTaxable
              ? "Counts toward EPF/ETF/PAYE when bundled."
              : "No impact on statutory calculations."
          }
        />
      </section>

      {claim.description && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">
            Description
          </p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">
            {claim.description}
          </p>
        </section>
      )}

      {claim.receiptRef && (
        <section className="mt-4 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">
            Receipt reference
          </p>
          <p className="mt-2 text-small text-text-primary">{claim.receiptRef}</p>
        </section>
      )}

      {claim.rejectionReason && (
        <section className="mt-4 rounded-card border-hairline border-danger/20 bg-danger-bg/30 p-5">
          <p className="text-caption uppercase tracking-wide text-danger">
            Rejection reason
          </p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">
            {claim.rejectionReason}
          </p>
        </section>
      )}

      {/* Actions */}
      <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
        <h2 className="text-h3 text-charcoal">Actions</h2>

        {claim.status === "draft" && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                runAction(() => api.submitExpenseClaim(claim.id))
              }
              disabled={busy}
              className="btn-primary disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
              Submit for approval
            </button>
            <Link
              href={`/app/expense-claims/new`}
              className="btn-secondary"
            >
              Edit (coming soon)
            </Link>
            <p className="w-full text-caption text-text-tertiary">
              Submitting allocates a claim number and locks the claim until an admin approves or rejects.
            </p>
          </div>
        )}

        {claim.status === "submitted" && claim.disbursementMethod === "direct" && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Pay from account
              </label>
              <select
                value={paymentAccountId}
                onChange={(e) => setPaymentAccountId(e.target.value)}
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
                Payment date
              </label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="input mt-1.5"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">
                Reference (optional)
              </label>
              <input
                type="text"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="Cheque #, transfer ref…"
                className="input mt-1.5"
              />
            </div>
            <div className="md:col-span-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  runAction(async () => {
                    if (!paymentAccountId)
                      throw new ApiError(400, "MISSING", "Pick a bank account.");
                    return api.approveAndPayExpenseClaim(claim.id, {
                      paymentAccountId,
                      paymentDate,
                      paymentReference: paymentReference.trim() || undefined,
                    });
                  })
                }
                disabled={busy || !paymentAccountId}
                className="btn-primary disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                )}
                Approve &amp; pay
              </button>
              <div className="flex flex-1 items-center gap-2">
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Rejection reason (required)"
                  className="input flex-1"
                />
                <button
                  type="button"
                  onClick={() =>
                    runAction(async () => {
                      if (!rejectReason.trim())
                        throw new ApiError(400, "MISSING", "Reason required.");
                      return api.rejectExpenseClaim(claim.id, {
                        reason: rejectReason.trim(),
                      });
                    })
                  }
                  disabled={busy}
                  className="btn-secondary disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" aria-hidden />
                  Reject
                </button>
              </div>
              <p className="w-full text-caption text-text-tertiary">
                A submitter can't approve or reject their own claim — needs a second admin.
              </p>
            </div>
          </div>
        )}

        {claim.status === "submitted" && claim.disbursementMethod === "payroll" && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => runAction(() => api.approveExpenseClaim(claim.id))}
              disabled={busy}
              className="btn-primary disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              )}
              Approve
            </button>
            <div className="flex flex-1 items-center gap-2">
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Rejection reason (required)"
                className="input flex-1"
              />
              <button
                type="button"
                onClick={() =>
                  runAction(async () => {
                    if (!rejectReason.trim())
                      throw new ApiError(400, "MISSING", "Reason required.");
                    return api.rejectExpenseClaim(claim.id, {
                      reason: rejectReason.trim(),
                    });
                  })
                }
                disabled={busy}
                className="btn-secondary disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" aria-hidden />
                Reject
              </button>
            </div>
            <p className="w-full text-caption text-text-tertiary">
              Once approved, the next payroll run for this employee will pick up the claim and bundle the reimbursement into their net pay.
            </p>
          </div>
        )}

        {claim.status === "approved" && (
          <p className="mt-4 text-small text-text-secondary">
            Waiting for the next payroll run to bundle this reimbursement.
            {claim.appliedInRunId && (
              <>
                {" "}
                <Link
                  href={`/app/payroll/${claim.appliedInRunId}`}
                  className="btn-link"
                >
                  View run
                </Link>
              </>
            )}
          </p>
        )}

        {claim.status === "rejected" && (
          <p className="mt-4 text-small text-text-secondary">
            This claim was rejected. Edit (coming soon) and re-submit, or void it.
          </p>
        )}

        {(claim.status === "draft" ||
          claim.status === "submitted" ||
          claim.status === "approved" ||
          claim.status === "rejected") && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t-hairline border-border pt-4">
            <input
              type="text"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Void reason (optional)"
              className="input flex-1"
            />
            <button
              type="button"
              onClick={() =>
                runAction(() =>
                  api.voidExpenseClaim(
                    claim.id,
                    voidReason.trim() ? { reason: voidReason.trim() } : undefined,
                  ),
                )
              }
              disabled={busy}
              className="btn-danger disabled:opacity-50"
            >
              <Ban className="h-4 w-4" aria-hidden />
              Void claim
            </button>
          </div>
        )}

        {(claim.status === "paid" || claim.status === "void") && (
          <p className="mt-4 text-small text-text-secondary">
            This claim is {statusLabels[claim.status].toLowerCase()} — no further actions available.
          </p>
        )}

        {error && <p className="mt-3 text-small text-danger">{error}</p>}
      </section>

      {claim.paymentJournalId && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">
            Payment journal
          </p>
          <p className="mt-2 text-small">
            <Link
              href={`/app/journals/${claim.paymentJournalId}`}
              className="btn-link"
            >
              View GL entry
            </Link>
            {claim.paymentDate && (
              <>
                {" "}
                <span className="text-text-tertiary">
                  · Paid {formatDate(claim.paymentDate)}
                  {claim.paymentReference ? ` · Ref ${claim.paymentReference}` : ""}
                </span>
              </>
            )}
          </p>
        </section>
      )}

      {claim.voidReason && (
        <section className="mt-4 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">
            Void reason
          </p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">
            {claim.voidReason}
          </p>
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
  sub?: string;
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
      {sub && <p className="mt-1 text-caption text-text-secondary">{sub}</p>}
    </div>
  );
}
