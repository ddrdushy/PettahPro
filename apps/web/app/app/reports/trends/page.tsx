import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, ArrowDown, ArrowUp } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

export const metadata: Metadata = { title: "Trends" };

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://api:4000";

interface MonthRow {
  monthStart: string;
  revenueCents: number;
  cogsCents: number;
  expensesCents: number;
  cashInCents: number;
  cashOutCents: number;
  netCashCents: number;
  invoiceCount: number;
  paymentCount: number;
  arBalanceCents: number;
  apBalanceCents: number;
}

interface TrendPayload {
  months: MonthRow[];
  deltas: {
    revenuePct: number | null;
    expensesPct: number | null;
    cogsPct: number | null;
    netCashPct: number | null;
  };
}

async function fetchTrends(months: number): Promise<TrendPayload | null> {
  try {
    const res = await fetch(
      `${INTERNAL_API}/reports/dashboard-trends?months=${months}`,
      { headers: { cookie: cookies().toString() }, cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as TrendPayload;
  } catch {
    return null;
  }
}

function formatMonthShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-LK", {
      month: "short",
      year: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatPct(pct: number | null): string {
  if (pct == null) return "—";
  const abs = (Math.abs(pct) * 100).toFixed(1);
  return `${pct >= 0 ? "+" : "-"}${abs}%`;
}

function deltaTone(pct: number | null, polarity: "good-up" | "good-down"): string {
  if (pct == null) return "text-text-secondary";
  const isUp = pct > 0;
  if (polarity === "good-up") {
    return isUp ? "text-emerald-700" : "text-rose-700";
  }
  return isUp ? "text-rose-700" : "text-emerald-700";
}

interface TrendCardProps {
  label: string;
  values: number[];
  monthLabels: string[];
  current: number;
  prior: number | null;
  deltaPct: number | null;
  polarity: "good-up" | "good-down";
  format?: (cents: number) => string;
  color?: string;
}

function TrendCard({
  label,
  values,
  monthLabels,
  current,
  prior,
  deltaPct,
  polarity,
  format = formatLKR,
  color = "text-mint",
}: TrendCardProps) {
  return (
    <div className="rounded-card border border-border-subtle bg-surface p-5">
      <div className="text-caption uppercase tracking-wide text-text-secondary">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <div className="text-h2 text-text-primary">{format(current)}</div>
        {deltaPct != null && (
          <span
            className={`flex items-center gap-1 text-small ${deltaTone(deltaPct, polarity)}`}
          >
            {deltaPct >= 0 ? (
              <ArrowUp className="h-3 w-3" aria-hidden />
            ) : (
              <ArrowDown className="h-3 w-3" aria-hidden />
            )}
            {formatPct(deltaPct)}
          </span>
        )}
      </div>
      {prior != null && (
        <p className="mt-1 text-caption text-text-secondary">
          vs {format(prior)} last month
        </p>
      )}
      <BarSpark values={values} labels={monthLabels} color={color} />
    </div>
  );
}

function BarSpark({
  values,
  labels,
  color,
}: {
  values: number[];
  labels: string[];
  color: string;
}) {
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);
  return (
    <div className="mt-3 flex items-end gap-1 h-16">
      {values.map((v, i) => {
        const h = max === 0 ? 0 : (Math.abs(v) / max) * 100;
        const positive = v >= 0;
        return (
          <div
            key={`${labels[i]}-${i}`}
            className="flex-1 flex flex-col items-center justify-end"
            title={`${labels[i]}: ${formatLKR(v)}`}
          >
            <div
              className={`w-full ${positive ? color : "text-rose-500"} rounded-sm`}
              style={{
                backgroundColor: "currentColor",
                opacity: positive ? 0.6 : 0.7,
                height: `${Math.max(2, h)}%`,
                minHeight: 2,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams?: { months?: string };
}) {
  const monthsParam = Number(searchParams?.months ?? "12");
  const months = Number.isFinite(monthsParam) && monthsParam >= 3 && monthsParam <= 36
    ? monthsParam
    : 12;
  const data = await fetchTrends(months);

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to dashboard
        </Link>
      </div>

      <PageHeader
        eyebrow="Reports"
        title={`Rolling ${months}-month trends`}
        description="Time-series view behind the KPI cards. Bars are monthly totals; the % change is last month vs prior month."
      />

      <form className="mt-6 flex items-end gap-3">
        <div>
          <label
            htmlFor="months"
            className="block text-caption uppercase tracking-wide text-text-tertiary"
          >
            Window
          </label>
          <select
            id="months"
            name="months"
            defaultValue={String(months)}
            className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          >
            <option value="3">3 months</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
            <option value="24">24 months</option>
            <option value="36">36 months</option>
          </select>
        </div>
        <button type="submit" className="btn-secondary text-small">
          Apply
        </button>
      </form>

      {!data ? (
        <p className="mt-10 text-body text-text-secondary">
          Couldn't load trends. Refresh, or contact support.
        </p>
      ) : (
        <>
          {/* Top row — flow trends */}
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <TrendCard
              label="Revenue"
              values={data.months.map((m) => m.revenueCents)}
              monthLabels={data.months.map((m) => formatMonthShort(m.monthStart))}
              current={data.months[data.months.length - 1]?.revenueCents ?? 0}
              prior={
                data.months.length > 1
                  ? data.months[data.months.length - 2]?.revenueCents ?? 0
                  : null
              }
              deltaPct={data.deltas.revenuePct}
              polarity="good-up"
              color="text-mint"
            />
            <TrendCard
              label="COGS"
              values={data.months.map((m) => m.cogsCents)}
              monthLabels={data.months.map((m) => formatMonthShort(m.monthStart))}
              current={data.months[data.months.length - 1]?.cogsCents ?? 0}
              prior={
                data.months.length > 1
                  ? data.months[data.months.length - 2]?.cogsCents ?? 0
                  : null
              }
              deltaPct={data.deltas.cogsPct}
              polarity="good-down"
              color="text-amber-500"
            />
            <TrendCard
              label="Other expenses"
              values={data.months.map((m) => m.expensesCents)}
              monthLabels={data.months.map((m) => formatMonthShort(m.monthStart))}
              current={data.months[data.months.length - 1]?.expensesCents ?? 0}
              prior={
                data.months.length > 1
                  ? data.months[data.months.length - 2]?.expensesCents ?? 0
                  : null
              }
              deltaPct={data.deltas.expensesPct}
              polarity="good-down"
              color="text-orange-500"
            />
            <TrendCard
              label="Net cash flow"
              values={data.months.map((m) => m.netCashCents)}
              monthLabels={data.months.map((m) => formatMonthShort(m.monthStart))}
              current={data.months[data.months.length - 1]?.netCashCents ?? 0}
              prior={
                data.months.length > 1
                  ? data.months[data.months.length - 2]?.netCashCents ?? 0
                  : null
              }
              deltaPct={data.deltas.netCashPct}
              polarity="good-up"
              color="text-sky-500"
            />
          </div>

          {/* AR / AP balance trend */}
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <TrendCard
              label="AR balance (month-end)"
              values={data.months.map((m) => m.arBalanceCents)}
              monthLabels={data.months.map((m) => formatMonthShort(m.monthStart))}
              current={
                data.months[data.months.length - 1]?.arBalanceCents ?? 0
              }
              prior={
                data.months.length > 1
                  ? data.months[data.months.length - 2]?.arBalanceCents ?? 0
                  : null
              }
              deltaPct={null}
              polarity="good-down"
              color="text-mint"
            />
            <TrendCard
              label="AP balance (month-end)"
              values={data.months.map((m) => m.apBalanceCents)}
              monthLabels={data.months.map((m) => formatMonthShort(m.monthStart))}
              current={
                data.months[data.months.length - 1]?.apBalanceCents ?? 0
              }
              prior={
                data.months.length > 1
                  ? data.months[data.months.length - 2]?.apBalanceCents ?? 0
                  : null
              }
              deltaPct={null}
              polarity="good-down"
              color="text-orange-500"
            />
          </div>

          {/* Per-month table */}
          <section className="mt-12">
            <h2 className="text-h2 text-text-primary">Per-month breakdown</h2>
            <div className="mt-4 overflow-x-auto rounded-card border border-border-subtle bg-surface">
              <table className="w-full text-small">
                <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-secondary">
                  <tr>
                    <th className="px-4 py-2 text-left">Month</th>
                    <th className="px-4 py-2 text-right">Revenue</th>
                    <th className="px-4 py-2 text-right">COGS</th>
                    <th className="px-4 py-2 text-right">Expenses</th>
                    <th className="px-4 py-2 text-right">Cash in</th>
                    <th className="px-4 py-2 text-right">Cash out</th>
                    <th className="px-4 py-2 text-right">Net cash</th>
                    <th className="px-4 py-2 text-right">Invoices</th>
                    <th className="px-4 py-2 text-right">Payments</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {data.months.map((m) => (
                    <tr key={m.monthStart}>
                      <td className="px-4 py-2 text-text-primary">
                        {formatMonthShort(m.monthStart)}
                      </td>
                      <td className="px-4 py-2 text-right text-text-primary">
                        {formatLKR(m.revenueCents)}
                      </td>
                      <td className="px-4 py-2 text-right text-text-secondary">
                        {formatLKR(m.cogsCents)}
                      </td>
                      <td className="px-4 py-2 text-right text-text-secondary">
                        {formatLKR(m.expensesCents)}
                      </td>
                      <td className="px-4 py-2 text-right text-emerald-700">
                        {formatLKR(m.cashInCents)}
                      </td>
                      <td className="px-4 py-2 text-right text-rose-700">
                        {formatLKR(m.cashOutCents)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right ${m.netCashCents >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                      >
                        {formatLKR(m.netCashCents)}
                      </td>
                      <td className="px-4 py-2 text-right text-text-secondary">
                        {m.invoiceCount}
                      </td>
                      <td className="px-4 py-2 text-right text-text-secondary">
                        {m.paymentCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
