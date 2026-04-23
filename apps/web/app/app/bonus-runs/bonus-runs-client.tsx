"use client";

import Link from "next/link";
import { Gift, Plus } from "lucide-react";
import type { BonusRunRow, BonusRunStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const statusStyles: Record<BonusRunStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  pending_approval: "bg-warning-bg text-warning",
  posted: "bg-mint-surface text-mint-dark",
  void: "bg-danger-bg/60 text-danger",
};

const statusLabels: Record<BonusRunStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  posted: "Posted",
  void: "Void",
};

export function BonusRunsClient({ runs }: { runs: BonusRunRow[] }) {
  const totals = runs.reduce(
    (acc, r) => {
      if (r.status === "posted") {
        acc.postedCount += 1;
        acc.gross += r.grossCents;
        acc.net += r.netPayCents;
      }
      if (r.status === "draft") acc.draftCount += 1;
      return acc;
    },
    { postedCount: 0, draftCount: 0, gross: 0, net: 0 },
  );

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Bonus runs"
        description="Off-cycle bonus payouts — Avurudu, Christmas, performance. Pick a scheme, review computed amounts, adjust if needed, post to book the journal."
        action={
          <Link href="/app/bonus-runs/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New run
          </Link>
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Posted runs" value={`${totals.postedCount}`} sub={`${runs.length} total`} />
        <SummaryCard
          label="Posted gross"
          value={formatLKR(totals.gross)}
          sub="Total bonus gross across posted runs"
          emphasis
        />
        <SummaryCard
          label="Drafts"
          value={`${totals.draftCount}`}
          sub="Awaiting review + post"
        />
      </section>

      {runs.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <Gift className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No bonus runs yet.</p>
          <p className="mt-1 text-small text-text-secondary">
            Start a new run from any active scheme. Eligible employees are seeded automatically; adjust per-employee amounts before posting.
          </p>
          <Link href="/app/bonus-runs/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New run
          </Link>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Run #</th>
                <th className="px-4 py-3 text-left">Label</th>
                <th className="px-4 py-3 text-left">Scheme</th>
                <th className="w-28 px-4 py-3 text-left">Pay date</th>
                <th className="w-20 px-4 py-3 text-right">Emps</th>
                <th className="w-32 px-4 py-3 text-right">Gross</th>
                <th className="w-32 px-4 py-3 text-right">Net</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {runs.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-surface-recessed/40">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    <Link
                      href={`/app/bonus-runs/${r.id}`}
                      className="text-charcoal underline-offset-4 hover:underline"
                    >
                      {r.runNumber ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-primary">{r.label}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {r.schemeName ?? <span className="text-text-tertiary">—</span>}
                    {r.schemeCode && (
                      <span className="ml-2 text-caption text-text-tertiary">{r.schemeCode}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {formatDate(r.payDate)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {r.employeeCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatLKR(r.grossCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(r.netPayCents)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[r.status]}`}
                    >
                      {statusLabels[r.status]}
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
