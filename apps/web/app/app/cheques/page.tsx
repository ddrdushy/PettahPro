import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowDownLeft, ArrowUpRight, FileSignature } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { formatLKR, formatDate } from "@/lib/format";
import type { ChequeListRow, ChequeStatus } from "@/lib/api";

export const metadata: Metadata = { title: "Cheques" };

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

async function fetchCheques(): Promise<ChequeListRow[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/cheques`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { cheques: ChequeListRow[] };
  return data.cheques;
}

export default async function ChequesPage() {
  const cheques = await fetchCheques();

  const inClearing = cheques.filter(
    (c) => c.direction === "received" && ["received", "deposited", "in_clearing"].includes(c.status),
  );
  const inTransit = cheques.filter(
    (c) => c.direction === "issued" && ["drafted", "issued", "presented"].includes(c.status),
  );
  const bounced = cheques.filter((c) => c.status === "bounced");

  const inClearingCents = inClearing.reduce((s, c) => s + c.amountCents, 0);
  const inTransitCents = inTransit.reduce((s, c) => s + c.amountCents, 0);

  const columns: Column<ChequeListRow>[] = [
    {
      header: "Cheque",
      accessor: (c) => (
        <Link href={`/app/cheques/${c.id}`} className="group block">
          <p className="font-medium text-charcoal group-hover:underline">{c.chequeNumber}</p>
          <p className="text-caption text-text-tertiary">
            {c.direction === "received" ? "From customer" : "To supplier"} · {formatDate(c.chequeDate)}
          </p>
        </Link>
      ),
    },
    {
      header: "Direction",
      accessor: (c) => (
        <span
          className={`inline-flex items-center gap-1 text-small ${
            c.direction === "received" ? "text-mint-dark" : "text-charcoal"
          }`}
        >
          {c.direction === "received" ? (
            <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          )}
          {c.direction === "received" ? "Received" : "Issued"}
        </span>
      ),
    },
    {
      header: "Party",
      accessor: (c) => <span className="text-charcoal">{c.partyName}</span>,
    },
    {
      header: "Amount",
      align: "right",
      mono: true,
      accessor: (c) => <span className="font-medium text-charcoal">{formatLKR(c.amountCents)}</span>,
    },
    {
      header: "Bounces",
      align: "center",
      accessor: (c) =>
        c.bounceCount > 0 ? (
          <span className="text-danger">{c.bounceCount}×</span>
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
    {
      header: "Status",
      align: "center",
      accessor: (c) => (
        <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusTone[c.status]}`}>
          {statusLabel[c.status]}
        </span>
      ),
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Banking"
        title="Cheques"
        description="Every cheque issued to a supplier or received from a customer. Tracked through the nine states of the SL Bounced Cheques Act."
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Received · not yet cleared" value={formatLKR(inClearingCents)} sub={`${inClearing.length} cheque${inClearing.length === 1 ? "" : "s"}`} tone="mint" />
        <Kpi label="Issued · not yet cleared" value={formatLKR(inTransitCents)} sub={`${inTransit.length} cheque${inTransit.length === 1 ? "" : "s"}`} />
        <Kpi label="Bounced" value={String(bounced.length)} sub="needs follow-up" tone={bounced.length > 0 ? "danger" : undefined} />
      </div>

      <div className="mt-6">
        <DataTable
          rows={cheques}
          columns={columns}
          empty={
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
                <FileSignature className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No cheques yet.</p>
              <p className="text-small">
                Record a payment with method <span className="font-medium text-charcoal">cheque</span> and it'll appear here for lifecycle tracking.
              </p>
            </div>
          }
        />
      </div>
    </main>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "mint" | "danger";
}) {
  const dot =
    tone === "mint"
      ? "bg-mint"
      : tone === "danger"
        ? "bg-danger"
        : "bg-text-tertiary";
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
      <div className="flex items-center justify-between">
        <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      </div>
      <p className="tabular-nums mt-2 text-h2 text-charcoal">{value}</p>
      {sub && <p className="mt-1 text-caption text-text-secondary">{sub}</p>}
    </div>
  );
}
