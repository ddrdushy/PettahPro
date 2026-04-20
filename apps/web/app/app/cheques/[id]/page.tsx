import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import type { Cheque, ChequeBounceEvent, ChequeStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";
import { ChequeActions } from "./actions";

export const metadata: Metadata = { title: "Cheque" };

const statusTone: Record<ChequeStatus, string> = {
  drafted: "bg-surface-recessed text-text-secondary",
  issued: "bg-mint-surface text-mint-dark",
  received: "bg-mint-surface text-mint-dark",
  deposited: "bg-mint-surface text-mint-dark",
  in_clearing: "bg-mint-surface text-mint-dark",
  presented: "bg-mint-surface text-mint-dark",
  cleared: "bg-mint text-mint-dark",
  bounced: "bg-danger-bg/60 text-danger",
  cancelled: "bg-surface-recessed text-text-tertiary",
  stale: "bg-warning-bg text-warning",
  reissued: "bg-surface-recessed text-text-secondary",
  replaced: "bg-surface-recessed text-text-secondary",
  returned_to_customer: "bg-warning-bg text-warning",
};

const statusLabel: Record<ChequeStatus, string> = {
  drafted: "Drafted",
  issued: "Issued",
  received: "Received",
  deposited: "Deposited",
  in_clearing: "In clearing",
  presented: "Presented",
  cleared: "Cleared",
  bounced: "Bounced",
  cancelled: "Cancelled",
  stale: "Stale",
  reissued: "Reissued",
  replaced: "Replaced",
  returned_to_customer: "Returned",
};

const reasonLabel: Record<string, string> = {
  insufficient_funds: "Insufficient funds",
  account_closed: "Account closed",
  stopped_payment: "Payment stopped",
  signature_mismatch: "Signature mismatch",
  post_dated: "Post-dated",
  stale: "Stale",
  refer_to_drawer: "Refer to drawer",
  other: "Other",
};

async function fetchCheque(id: string) {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/cheques/${id}`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as {
    cheque: Cheque;
    events: ChequeBounceEvent[];
    party: { id: string; name: string } | null;
    bankAccount: { code: string; name: string } | null;
  };
}

export default async function ChequeDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchCheque(params.id);
  if (!data) notFound();
  const { cheque, events, party, bankAccount } = data;

  const isActiveReceived =
    cheque.direction === "received" &&
    (["received", "deposited", "in_clearing"] as const).includes(cheque.status as never);
  const isActiveIssued =
    cheque.direction === "issued" &&
    (["drafted", "issued", "presented"] as const).includes(cheque.status as never);
  const canAct = isActiveReceived || isActiveIssued;

  // Timeline steps per direction
  const steps =
    cheque.direction === "received"
      ? [
          { label: "Received", at: cheque.createdAt },
          { label: "Deposited", at: cheque.depositedAt },
          { label: "Cleared", at: cheque.clearedAt },
        ]
      : [
          { label: "Issued", at: cheque.issuedAt },
          { label: "Handed over", at: cheque.handedOverAt },
          { label: "Presented", at: cheque.presentedAt },
          { label: "Cleared", at: cheque.clearedAt },
        ];
  if (cheque.bouncedAt) {
    steps.push({ label: "Bounced", at: cheque.bouncedAt });
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/cheques" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to cheques
        </Link>
      </div>

      <PageHeader
        eyebrow={cheque.direction === "received" ? "Received from customer" : "Issued to supplier"}
        title={`Cheque ${cheque.chequeNumber}`}
        description={
          party
            ? `${cheque.direction === "received" ? "From" : "To"} ${party.name} · dated ${formatDate(cheque.chequeDate)}`
            : `Dated ${formatDate(cheque.chequeDate)}`
        }
        action={
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-small font-medium ${statusTone[cheque.status]}`}>
              {statusLabel[cheque.status]}
            </span>
            {canAct && (
              <ChequeActions
                id={cheque.id}
                direction={cheque.direction}
                chequeNumber={cheque.chequeNumber}
                amountCents={cheque.amountCents}
              />
            )}
          </div>
        }
      />

      {cheque.bounceCount > 0 && cheque.status === "bounced" && (
        <div className="mt-6 flex items-start gap-3 rounded-card border-hairline border-danger/40 bg-danger-bg/60 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-danger" aria-hidden />
          <div>
            <p className="text-small font-medium text-charcoal">
              Bounced {cheque.bounceCount}× · last reason: {reasonLabel[cheque.lastBounceReason ?? "other"] ?? cheque.lastBounceReason}
            </p>
            <p className="text-caption text-text-secondary">
              The allocated invoice{cheque.direction === "issued" ? " / bill" : ""} has been reopened. Under the SL Bounced Cheques Act, a formal demand letter can follow if the drawer doesn't settle within the statutory window.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Meta label="Amount" value={formatLKR(cheque.amountCents)} mono />
              <Meta label="Cheque date" value={formatDate(cheque.chequeDate)} />
              <Meta label="Stale after" value={cheque.staleAt ? formatDate(cheque.staleAt) : "—"} />
              <Meta
                label="Bank account"
                value={bankAccount ? `${bankAccount.code} · ${bankAccount.name}` : "—"}
              />
              {cheque.draweeBankName && (
                <Meta label="Drawee bank" value={cheque.draweeBankName} />
              )}
              {cheque.draweeBranchName && (
                <Meta label="Branch" value={cheque.draweeBranchName} />
              )}
            </dl>
          </section>

          <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Timeline</p>
            <ol className="mt-4 space-y-4">
              {steps.map((s, i) => {
                const done = !!s.at;
                return (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border-hairline ${
                        done
                          ? s.label === "Bounced"
                            ? "border-danger bg-danger-bg/60 text-danger"
                            : "border-mint-dark bg-mint-surface text-mint-dark"
                          : "border-border bg-surface-elevated text-text-tertiary"
                      }`}
                    >
                      {done ? "•" : i + 1}
                    </span>
                    <div className="flex flex-1 flex-wrap items-baseline justify-between gap-2">
                      <p className={`text-small ${done ? "text-charcoal" : "text-text-tertiary"}`}>
                        {s.label}
                      </p>
                      <p className="text-caption tabular-nums text-text-tertiary">
                        {s.at ? formatDate(s.at) : "—"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {events.length > 0 && (
            <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
              <header className="border-b-hairline border-border px-6 py-4">
                <h2 className="text-h3 text-charcoal">Bounce history</h2>
                <p className="text-caption text-text-tertiary">Every dishonour recorded against this cheque.</p>
              </header>
              <table className="w-full text-small">
                <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="w-12 px-4 py-3 text-center">#</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Reason</th>
                    <th className="px-4 py-3 text-right">Bank charges</th>
                  </tr>
                </thead>
                <tbody className="divide-y-hairline divide-border">
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="px-4 py-3 text-center text-caption text-text-tertiary">
                        {e.bounceNumber}
                      </td>
                      <td className="px-4 py-3 text-charcoal">{formatDate(e.bouncedAt)}</td>
                      <td className="px-4 py-3">
                        <p className="text-charcoal">
                          {reasonLabel[e.reasonCode] ?? e.reasonCode}
                        </p>
                        {e.reasonDetails && (
                          <p className="text-caption text-text-tertiary">{e.reasonDetails}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {e.bankChargesCents > 0 ? formatLKR(e.bankChargesCents) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {cheque.sourceReceiptId && (
            <section className="rounded-card border-hairline border-border bg-surface-elevated p-5">
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Linked receipt</p>
              <Link
                href={`/app/payments`}
                className="mt-2 inline-flex items-center gap-1 text-small font-medium text-charcoal hover:underline"
              >
                Customer payment
              </Link>
            </section>
          )}
          {cheque.sourcePaymentId && (
            <section className="rounded-card border-hairline border-border bg-surface-elevated p-5">
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Linked payment</p>
              <Link
                href={`/app/supplier-payments`}
                className="mt-2 inline-flex items-center gap-1 text-small font-medium text-charcoal hover:underline"
              >
                Supplier payment
              </Link>
            </section>
          )}
          {cheque.memo && (
            <section className="rounded-card border-hairline border-border bg-surface-elevated p-5">
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Memo</p>
              <p className="mt-2 text-small text-charcoal">{cheque.memo}</p>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-caption uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className={`mt-1 text-body text-charcoal ${mono ? "tabular-nums" : ""}`}>{value}</dd>
    </div>
  );
}
