import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Plus, Repeat } from "lucide-react";
import type { RecurringJournalListRow } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate, formatLKR } from "@/lib/format";
import { RecurringJournalActions } from "./recurring-actions-client";

export const metadata: Metadata = { title: "Recurring journals" };

async function fetchList(): Promise<RecurringJournalListRow[] | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/recurring-journals`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return ((await res.json()) as { recurringJournals: RecurringJournalListRow[] }).recurringJournals;
}

function statusPill(row: RecurringJournalListRow) {
  const ended = row.endDate != null && row.endDate < new Date().toISOString().slice(0, 10);
  if (ended) return { label: "Ended", cls: "bg-surface-recessed text-text-tertiary border-border" };
  if (!row.isActive) return { label: "Paused", cls: "bg-amber-50 text-amber-800 border-amber-200" };
  return { label: "Active", cls: "bg-mint-surface/60 text-mint-dark border-mint/40" };
}

export default async function RecurringJournalsPage() {
  const rows = await fetchList();

  return (
    <main className="container-p py-10">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          eyebrow="Accounting"
          title="Recurring journals"
          description="Monthly accruals, prepaid amortisation, deferred revenue releases, inter-company fees. Each template fires on its run date — auto-post directly, or drop into the approval queue."
        />
        <Link href="/app/recurring-journals/new" className="btn-primary inline-flex items-center gap-2 text-small">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New schedule
        </Link>
      </div>

      {!rows || rows.length === 0 ? (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <Repeat className="mx-auto h-6 w-6 text-text-tertiary" aria-hidden />
          <p className="mt-3 text-body text-text-secondary">No recurring journals yet.</p>
          <p className="mt-1 text-caption text-text-tertiary">
            Set up a template for the entries you book every month — rent accruals, insurance amortisation, depreciation adjustments.
          </p>
          <Link href="/app/recurring-journals/new" className="btn-primary mt-4 inline-flex items-center gap-2 text-small">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create your first schedule
          </Link>
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Schedule</th>
                <th className="px-4 py-3 text-left">Cadence</th>
                <th className="px-4 py-3 text-left">Next run</th>
                <th className="px-4 py-3 text-right">Per-run</th>
                <th className="px-4 py-3 text-right">Generated</th>
                <th className="px-4 py-3 text-left">Mode</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {rows.map((r) => {
                const pill = statusPill(r);
                const latestHref = r.lastGeneratedEntryId
                  ? `/app/journals/${r.lastGeneratedEntryId}`
                  : r.lastGeneratedDraftId
                    ? `/app/journals/approvals`
                    : null;
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/recurring-journals/${r.id}`}
                        className="text-charcoal underline-offset-4 hover:underline"
                      >
                        {r.scheduleName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">Monthly · day {r.dayOfMonth}</td>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(r.nextRunDate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                      {formatLKR(r.totalCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                      {r.generatedCount}
                      {latestHref && (
                        <Link
                          href={latestHref}
                          className="ml-2 text-caption text-text-tertiary underline-offset-4 hover:underline"
                        >
                          latest
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border-hairline px-2 py-0.5 text-caption font-medium ${
                          r.autoPost
                            ? "bg-mint-surface/60 text-mint-dark border-mint/40"
                            : "bg-surface-recessed text-text-secondary border-border"
                        }`}
                      >
                        {r.autoPost ? "Auto-post" : "Review queue"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border-hairline px-2 py-0.5 text-caption font-medium ${pill.cls}`}>
                        {pill.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RecurringJournalActions id={r.id} isActive={r.isActive} autoPost={r.autoPost} />
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
