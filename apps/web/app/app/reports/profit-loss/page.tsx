import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { ProfitLoss } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Profit & loss" };

function monthRange(d: Date): { from: string; to: string } {
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

async function fetchPL({
  from,
  to,
  compare,
}: {
  from?: string;
  to?: string;
  compare?: string;
}): Promise<ProfitLoss | null> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (compare) params.set("compare", compare);
  const qs = params.toString();
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/reports/profit-loss${qs ? `?${qs}` : ""}`,
    {
      headers: { cookie: cookies().toString() },
      cache: "no-store",
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as ProfitLoss;
}

export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; compare?: string };
}) {
  const data = await fetchPL(searchParams);

  if (!data) {
    return (
      <main className="container-p py-10">
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">Couldn't load the profit and loss report.</p>
        </div>
      </main>
    );
  }

  const thisMonth = monthRange(new Date());
  const hasCompare = data.comparison !== null;
  const margin = data.totalIncomeCents > 0
    ? (data.netProfitCents / data.totalIncomeCents) * 100
    : null;

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Reports"
        title="Profit &amp; loss"
        description={`${formatDate(data.asOfFrom)} — ${formatDate(data.asOfTo)}${
          data.comparisonFrom ? ` · vs ${formatDate(data.comparisonFrom)} — ${formatDate(data.comparisonTo!)}` : ""
        }`}
      />

      <form className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="from" className="block text-caption uppercase tracking-wide text-text-tertiary">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={searchParams.from ?? thisMonth.from}
            className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="to" className="block text-caption uppercase tracking-wide text-text-tertiary">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={searchParams.to ?? thisMonth.to}
            className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="compare" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Compare to
          </label>
          <select
            id="compare"
            name="compare"
            defaultValue={searchParams.compare ?? "none"}
            className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          >
            <option value="none">No comparison</option>
            <option value="prior_month">Prior month</option>
            <option value="prior_year">Prior year</option>
          </select>
        </div>
        <button type="submit" className="btn-secondary text-small">Apply</button>
      </form>

      {/* Summary strip */}
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Total income"
          value={data.totalIncomeCents}
          comparison={data.comparison?.totalIncomeCents}
        />
        <Stat
          label="Total expenses"
          value={data.totalCogsCents + data.totalOpexCents}
          comparison={
            data.comparison ? data.comparison.totalCogsCents + data.comparison.totalOpexCents : undefined
          }
          inverse
        />
        <Stat
          label="Net profit"
          value={data.netProfitCents}
          comparison={data.comparison?.netProfitCents}
          emphasize
          sub={margin !== null ? `${margin.toFixed(1)}% margin` : undefined}
        />
      </section>

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-20 px-4 py-3 text-left">Code</th>
              <th className="px-4 py-3 text-left">Account</th>
              <th className="w-36 px-4 py-3 text-right">Amount</th>
              {hasCompare && <th className="w-36 px-4 py-3 text-right">Prior</th>}
              {hasCompare && <th className="w-24 px-4 py-3 text-right">Δ</th>}
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {data.sections.map((section) => (
              <>
                <tr key={`h-${section.label}`} className="bg-surface-recessed/40">
                  <td colSpan={hasCompare ? 5 : 3} className="px-4 py-2">
                    <span className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
                      {section.label}
                    </span>
                  </td>
                </tr>
                {section.accounts.length === 0 ? (
                  <tr key={`empty-${section.label}`}>
                    <td colSpan={hasCompare ? 5 : 3} className="px-4 py-3 text-caption text-text-tertiary">
                      No activity in this section.
                    </td>
                  </tr>
                ) : (
                  section.accounts.map((a) => {
                    // Drill-down: clicking any account line jumps to the GL
                    // filtered to that account for the same period the P&L
                    // is currently showing. #48.
                    const glHref = `/app/reports/general-ledger?accountId=${a.accountId}&from=${data.asOfFrom}&to=${data.asOfTo}`;
                    return (
                    <tr key={a.accountId} className="group hover:bg-mint-surface/30">
                      <td className="px-4 py-3 tabular-nums text-text-secondary">
                        <Link
                          href={glHref}
                          className="block text-text-secondary hover:text-mint-dark"
                          title="Open this account in the general ledger"
                        >
                          {a.code}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-charcoal">
                        <Link
                          href={glHref}
                          className="block text-charcoal group-hover:text-mint-dark group-hover:underline underline-offset-2"
                          title="Open this account in the general ledger"
                        >
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                        <Link href={glHref} className="block text-charcoal">
                          {formatLKR(a.amountCents)}
                        </Link>
                      </td>
                      {hasCompare && (
                        <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                          {a.comparisonCents !== undefined ? formatLKR(a.comparisonCents) : "—"}
                        </td>
                      )}
                      {hasCompare && (
                        <td className="px-4 py-3 text-right text-caption">
                          {renderDelta(a.amountCents, a.comparisonCents ?? 0)}
                        </td>
                      )}
                    </tr>
                    );
                  })
                )}
                <tr key={`t-${section.label}`} className="bg-surface-recessed/30">
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-caption text-text-secondary">
                    Subtotal {section.label.toLowerCase()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-charcoal">
                    {formatLKR(section.totalCents)}
                  </td>
                  {hasCompare && (
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                      {section.comparisonTotalCents !== undefined
                        ? formatLKR(section.comparisonTotalCents)
                        : "—"}
                    </td>
                  )}
                  {hasCompare && <td className="px-4 py-2" />}
                </tr>
              </>
            ))}

            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-charcoal">Gross profit</td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(data.grossProfitCents)}
              </td>
              {hasCompare && (
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                  {formatLKR(data.comparison!.grossProfitCents)}
                </td>
              )}
              {hasCompare && (
                <td className="px-4 py-3 text-right text-caption">
                  {renderDelta(data.grossProfitCents, data.comparison!.grossProfitCents)}
                </td>
              )}
            </tr>
            <tr className="bg-mint-surface/60 font-medium">
              <td className="px-4 py-4" />
              <td className="px-4 py-4 text-charcoal">Net profit</td>
              <td className="px-4 py-4 text-right tabular-nums text-h3 text-charcoal">
                {formatLKR(data.netProfitCents)}
              </td>
              {hasCompare && (
                <td className="px-4 py-4 text-right tabular-nums text-text-secondary">
                  {formatLKR(data.comparison!.netProfitCents)}
                </td>
              )}
              {hasCompare && (
                <td className="px-4 py-4 text-right text-caption">
                  {renderDelta(data.netProfitCents, data.comparison!.netProfitCents)}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  comparison,
  emphasize,
  inverse,
  sub,
}: {
  label: string;
  value: number;
  comparison?: number;
  emphasize?: boolean;
  inverse?: boolean;
  sub?: string;
}) {
  const delta = comparison !== undefined ? value - comparison : null;
  const pct = comparison !== undefined && comparison !== 0 ? (delta! / Math.abs(comparison)) * 100 : null;
  const up = (delta ?? 0) > 0;
  // For "total expenses", up is BAD; for income and net profit, up is good
  const trendGood = inverse ? !up : up;

  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p
        className={`tabular-nums mt-1 ${emphasize ? "text-h1 text-charcoal" : "text-h2 text-charcoal"}`}
      >
        {formatLKR(value)}
      </p>
      {sub && <p className="mt-1 text-caption text-text-secondary">{sub}</p>}
      {delta !== null && pct !== null && (
        <p
          className={`mt-2 inline-flex items-center gap-1 text-caption ${
            trendGood ? "text-mint-dark" : "text-danger"
          }`}
        >
          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {up ? "+" : ""}
          {pct.toFixed(1)}%
          <span className="text-text-tertiary">vs prior</span>
        </p>
      )}
    </div>
  );
}

function renderDelta(current: number, prior: number) {
  const diff = current - prior;
  if (diff === 0 || prior === 0) return <span className="text-text-tertiary">—</span>;
  const pct = (diff / Math.abs(prior)) * 100;
  return (
    <span className={diff > 0 ? "text-mint-dark" : "text-danger"}>
      {diff > 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}
