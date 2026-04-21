import Link from "next/link";
import type { AgingBucketLabel, AgingDetailReport } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const BUCKET_ORDER: AgingBucketLabel[] = ["current", "0-30", "30-60", "60-90", "90+"];

const BUCKET_LABEL: Record<AgingBucketLabel, string> = {
  current: "Current",
  "0-30": "1–30 days",
  "30-60": "31–60 days",
  "60-90": "61–90 days",
  "90+": "90+ days",
};

const BUCKET_TONE: Record<AgingBucketLabel, string> = {
  current: "text-mint-dark",
  "0-30": "text-text-secondary",
  "30-60": "text-amber-700",
  "60-90": "text-amber-800",
  "90+": "text-danger",
};

export function AgingDetailView({
  mode,
  data,
}: {
  mode: "ar" | "ap";
  data: AgingDetailReport;
}) {
  const docPathBase = mode === "ar" ? "/app/invoices" : "/app/bills";
  const partyPathBase = mode === "ar" ? "/app/customers" : "/app/suppliers";
  const eyebrow = "Reports";
  const title = mode === "ar" ? "Receivables aging" : "Payables aging";
  const description =
    mode === "ar"
      ? "What each customer owes you, bucketed by how overdue it is. Chase the bottom of the table first."
      : "What you owe each supplier, bucketed by how overdue it is. Prioritise 60+ to stay credit-worthy.";

  return (
    <main className="container-p py-10">
      <PageHeader eyebrow={eyebrow} title={title} description={`As at ${formatDate(data.asOf)}. ${description}`} />

      <section className="mt-6 grid gap-3 sm:grid-cols-5">
        {BUCKET_ORDER.map((b) => (
          <div key={b} className="rounded-card border-hairline border-border bg-surface-elevated p-4">
            <p className="text-caption uppercase tracking-wide text-text-tertiary">{BUCKET_LABEL[b]}</p>
            <p className={`mt-2 text-h4 font-medium tabular-nums ${BUCKET_TONE[b]}`}>
              {formatLKR(data.bucketTotals[b])}
            </p>
          </div>
        ))}
      </section>

      <div className="mt-6 rounded-card border-hairline border-border bg-mint-surface/40 px-5 py-3 text-small text-charcoal">
        <strong className="font-medium">Grand total outstanding:</strong>{" "}
        <span className="tabular-nums">{formatLKR(data.grandTotalCents)}</span>
      </div>

      {data.groups.length === 0 ? (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">
            {mode === "ar" ? "No outstanding customer balances." : "No outstanding supplier balances."}
          </p>
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">{mode === "ar" ? "Customer" : "Supplier"} / Document</th>
                <th className="w-28 px-4 py-3 text-left">Due</th>
                <th className="w-24 px-4 py-3 text-right">Overdue</th>
                <th className="w-24 px-4 py-3 text-right">Bucket</th>
                <th className="w-32 px-4 py-3 text-right">Total</th>
                <th className="w-28 px-4 py-3 text-right">Paid</th>
                <th className="w-32 px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {data.groups.map((g) => (
                <>
                  <tr key={`h-${g.partyId}`} className="bg-surface-recessed/40">
                    <td className="px-4 py-2">
                      <Link
                        href={`${partyPathBase}/${g.partyId}`}
                        className="font-medium text-charcoal underline-offset-4 hover:underline"
                      >
                        {g.partyName}
                      </Link>
                      <span className="ml-2 text-caption text-text-tertiary">
                        {g.rows.length} {g.rows.length === 1 ? "doc" : "docs"}
                      </span>
                    </td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-charcoal">
                      {formatLKR(g.totalBalanceCents)}
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 pl-8">
                        <Link href={`${docPathBase}/${r.id}`} className="text-charcoal underline-offset-4 hover:underline">
                          {r.docNumber ?? "Draft"}
                        </Link>
                        {r.reference && (
                          <span className="ml-2 text-caption text-text-tertiary">{r.reference}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(r.dueDate)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${r.daysOverdue > 0 ? "text-danger" : "text-text-tertiary"}`}>
                        {r.daysOverdue > 0 ? `${r.daysOverdue}d` : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right text-caption ${BUCKET_TONE[r.bucket]}`}>
                        {BUCKET_LABEL[r.bucket]}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                        {formatLKR(r.totalCents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                        {r.amountPaidCents > 0 ? formatLKR(r.amountPaidCents) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                        {formatLKR(r.balanceDueCents)}
                      </td>
                    </tr>
                  ))}
                </>
              ))}
              <tr className="bg-surface-recessed font-medium">
                <td colSpan={6} className="px-4 py-3 text-charcoal">
                  Grand total
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                  {formatLKR(data.grandTotalCents)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
