"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { DepreciationMethod, FixedAssetScheduleRow } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

const methodLabels: Record<DepreciationMethod, string> = {
  straight_line: "SLM",
  wdv: "WDV",
  sum_of_years_digits: "SOYD",
};

export function ScheduleClient({
  year,
  rows,
  totals,
}: {
  year: number;
  rows: FixedAssetScheduleRow[];
  totals: {
    costCents: number;
    bookYearCents: number;
    bookAccumulatedCents: number;
    bookNbvCents: number;
    taxYearCents: number;
    taxAccumulatedCents: number;
    taxNbvCents: number;
  };
}) {
  const router = useRouter();
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i + 1);

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/fixed-assets" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to fixed assets
        </Link>
      </div>

      <PageHeader
        eyebrow="Accounting"
        title={`Depreciation schedule · ${year}`}
        description="Book schedule (posted to GL) alongside tax schedule (memo-only, used for tax computation). The difference between book and tax NBV drives deferred-tax recognition."
        action={
          <select
            value={year}
            onChange={(e) => router.push(`/app/fixed-assets/schedule?year=${e.target.value}`)}
            className="input"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label={`Book ${year} charge`}
          value={formatLKR(totals.bookYearCents)}
          sub={`Closing accumulated ${formatLKR(totals.bookAccumulatedCents)}`}
        />
        <SummaryCard
          label={`Tax ${year} charge`}
          value={formatLKR(totals.taxYearCents)}
          sub={`Closing accumulated ${formatLKR(totals.taxAccumulatedCents)}`}
        />
        <SummaryCard
          label="Timing difference"
          value={formatLKR(totals.bookYearCents - totals.taxYearCents)}
          sub={
            totals.bookYearCents === totals.taxYearCents
              ? "Book and tax charge match this year"
              : totals.bookYearCents > totals.taxYearCents
                ? "Book > tax: deferred tax asset builds"
                : "Tax > book: deferred tax liability builds"
          }
          emphasis
        />
      </section>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">No fixed assets registered.</p>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left" rowSpan={2}>Asset</th>
                <th className="w-28 px-4 py-3 text-right" rowSpan={2}>Cost</th>
                <th className="px-4 py-3 text-center" colSpan={3}>Book</th>
                <th className="px-4 py-3 text-center" colSpan={3}>Tax (memo)</th>
                <th className="w-28 px-4 py-3 text-right" rowSpan={2}>NBV gap</th>
              </tr>
              <tr>
                <th className="w-20 px-3 py-2 text-center text-caption">Method</th>
                <th className="w-28 px-3 py-2 text-right text-caption">{year} charge</th>
                <th className="w-28 px-3 py-2 text-right text-caption">Closing NBV</th>
                <th className="w-20 px-3 py-2 text-center text-caption">Method</th>
                <th className="w-28 px-3 py-2 text-right text-caption">{year} charge</th>
                <th className="w-28 px-3 py-2 text-right text-caption">Closing NBV</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {rows.map((r) => {
                const gap = r.bookNbvCents - r.taxNbvCents;
                return (
                  <tr key={r.id} className="transition-colors hover:bg-surface-recessed/40">
                    <td className="px-4 py-3">
                      <Link href={`/app/fixed-assets/${r.id}`} className="text-charcoal underline-offset-4 hover:underline">
                        {r.name}
                      </Link>
                      {r.code && <p className="text-caption text-text-tertiary tabular-nums">{r.code}</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatLKR(r.costCents)}</td>
                    <td className="px-3 py-3 text-center text-caption text-text-secondary">
                      {methodLabels[r.bookMethod]}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                      {formatLKR(r.bookYearCents)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-charcoal">
                      {formatLKR(r.bookNbvCents)}
                    </td>
                    <td className="px-3 py-3 text-center text-caption text-text-secondary">
                      {methodLabels[r.taxMethod]}
                      {r.taxMethod === "wdv" && r.taxAnnualRateBps != null && (
                        <span className="ml-1 text-text-tertiary">{(r.taxAnnualRateBps / 100).toFixed(0)}%</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                      {formatLKR(r.taxYearCents)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-charcoal">
                      {formatLKR(r.taxNbvCents)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        gap === 0 ? "text-text-tertiary" : gap > 0 ? "text-mint-dark" : "text-danger"
                      }`}
                    >
                      {formatLKR(gap)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-surface-recessed/40 text-small font-medium">
              <tr>
                <td className="px-4 py-3 text-charcoal">Totals</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatLKR(totals.costCents)}</td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3 text-right tabular-nums">{formatLKR(totals.bookYearCents)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatLKR(totals.bookNbvCents)}</td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3 text-right tabular-nums">{formatLKR(totals.taxYearCents)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatLKR(totals.taxNbvCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                  {formatLKR(totals.bookNbvCents - totals.taxNbvCents)}
                </td>
              </tr>
            </tfoot>
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
