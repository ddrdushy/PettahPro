import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

export const metadata: Metadata = { title: "Executive KPIs" };

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://api:4000";

interface KpiPayload {
  period: { from: string; to: string; days: number };
  dso: { days: number | null; arCents: number; salesCents: number };
  dpo: { days: number | null; apCents: number; purchasesCents: number };
  grossMargin: {
    percentBps: number | null;
    revenueCents: number;
    cogsCents: number;
  };
  inventoryTurns: {
    annualized: number | null;
    cogsCents: number;
    avgInventoryCents: number;
  };
  cashRunway: {
    months: number | null;
    cashCents: number;
    netMonthlyOutflowCents: number;
  };
  trend: Array<{
    monthStart: string;
    revenueCents: number;
    cogsCents: number;
    grossMarginBps: number | null;
  }>;
}

async function fetchKpis(params: { from?: string; to?: string }): Promise<KpiPayload | null> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  try {
    const res = await fetch(
      `${INTERNAL_API}/reports/exec-kpis${qs.toString() ? `?${qs.toString()}` : ""}`,
      { headers: { cookie: cookies().toString() }, cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as KpiPayload;
  } catch {
    return null;
  }
}

function formatNumber(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-LK");
}

function formatBps(bps: number | null): string {
  if (bps == null) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

function formatMonths(m: number | null): string {
  if (m == null) return "∞";
  if (m > 36) return ">3 yrs";
  return `${m.toFixed(1)} mo`;
}

function dsoTone(days: number | null): string {
  if (days == null) return "text-text-secondary";
  if (days <= 30) return "text-emerald-700";
  if (days <= 60) return "text-amber-700";
  return "text-rose-700";
}

function gmTone(bps: number | null): string {
  if (bps == null) return "text-text-secondary";
  if (bps >= 4000) return "text-emerald-700"; // 40%+
  if (bps >= 2000) return "text-amber-700"; // 20-40%
  return "text-rose-700"; // <20%
}

function runwayTone(months: number | null): string {
  if (months == null) return "text-emerald-700"; // infinite = good
  if (months >= 6) return "text-emerald-700";
  if (months >= 3) return "text-amber-700";
  return "text-rose-700";
}

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  spark?: number[];
}

function KpiCard({ label, value, hint, tone = "text-text-primary", spark }: KpiCardProps) {
  return (
    <div className="rounded-card border border-border-subtle bg-surface p-5 flex flex-col">
      <div className="text-caption uppercase tracking-wide text-text-secondary">
        {label}
      </div>
      <div className={`mt-2 text-h1 ${tone}`}>{value}</div>
      {hint && <p className="mt-1 text-caption text-text-secondary">{hint}</p>}
      {spark && spark.length > 1 && <Sparkline values={spark} />}
    </div>
  );
}

// Lightweight inline-SVG sparkline. No D3 / no chart lib — single
// polyline scaled into a 100×30 viewbox. Good enough for a credibility
// signal on a KPI card; the full trends + drilldown live on dedicated
// report pages.
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 30 - ((v - min) / range) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="mt-3 h-8 w-full text-mint"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatMonthShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-LK", { month: "short" });
  } catch {
    return iso;
  }
}

export default async function ExecKpiPage({
  searchParams,
}: {
  searchParams?: { from?: string; to?: string };
}) {
  const data = await fetchKpis({
    from: searchParams?.from,
    to: searchParams?.to,
  });

  if (!data) {
    return (
      <main className="container-p py-10">
        <p className="text-body text-text-secondary">
          Couldn't load KPIs. Refresh, or contact support if this keeps happening.
        </p>
      </main>
    );
  }

  const revenueSpark = data.trend.map((t) => t.revenueCents);
  const gmSpark = data.trend
    .map((t) => t.grossMarginBps ?? 0)
    .filter((_, i, arr) => arr.length > 0);

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
        title="Executive KPIs"
        description={`Operating ratios for ${data.period.from} → ${data.period.to} (${data.period.days} days). Directional credibility, not GAAP — one click away from the numbers behind each card.`}
      />

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="DSO — Days sales outstanding"
          value={data.dso.days != null ? `${data.dso.days} days` : "—"}
          hint={
            data.dso.days != null
              ? `${formatLKR(data.dso.arCents)} AR ÷ ${formatLKR(data.dso.salesCents)} sales`
              : "Need sales in window to compute"
          }
          tone={dsoTone(data.dso.days)}
        />
        <KpiCard
          label="DPO — Days payables outstanding"
          value={data.dpo.days != null ? `${data.dpo.days} days` : "—"}
          hint={
            data.dpo.days != null
              ? `${formatLKR(data.dpo.apCents)} AP ÷ ${formatLKR(data.dpo.purchasesCents)} purchases`
              : "Need purchases in window to compute"
          }
        />
        <KpiCard
          label="Gross margin"
          value={formatBps(data.grossMargin.percentBps)}
          hint={`Revenue ${formatLKR(data.grossMargin.revenueCents)} − COGS ${formatLKR(data.grossMargin.cogsCents)}`}
          tone={gmTone(data.grossMargin.percentBps)}
          spark={gmSpark.length > 1 ? gmSpark : undefined}
        />
        <KpiCard
          label="Inventory turns (annualized)"
          value={
            data.inventoryTurns.annualized != null
              ? `${data.inventoryTurns.annualized.toFixed(1)}×`
              : "—"
          }
          hint={
            data.inventoryTurns.avgInventoryCents > 0
              ? `${formatLKR(data.inventoryTurns.cogsCents)} COGS ÷ ${formatLKR(data.inventoryTurns.avgInventoryCents)} avg inventory`
              : "No inventory on hand"
          }
        />
        <KpiCard
          label="Cash runway"
          value={formatMonths(data.cashRunway.months)}
          hint={
            data.cashRunway.netMonthlyOutflowCents > 0
              ? `${formatLKR(data.cashRunway.cashCents)} cash ÷ ${formatLKR(data.cashRunway.netMonthlyOutflowCents)}/mo burn`
              : `${formatLKR(data.cashRunway.cashCents)} cash · cash growing (last 90 days)`
          }
          tone={runwayTone(data.cashRunway.months)}
        />
        <KpiCard
          label="Revenue trend (last 6 mo)"
          value={formatLKR(
            data.trend.reduce((s, t) => s + t.revenueCents, 0),
          )}
          hint={
            data.trend.length > 0
              ? `${formatMonthShort(data.trend[0]!.monthStart)} → ${formatMonthShort(data.trend[data.trend.length - 1]!.monthStart)}`
              : "—"
          }
          spark={revenueSpark}
        />
      </div>

      {/* Trend table */}
      <section className="mt-12">
        <h2 className="text-h2 text-text-primary">6-month trend</h2>
        <div className="mt-4 overflow-hidden rounded-card border border-border-subtle bg-surface">
          <table className="w-full text-small">
            <thead className="bg-surface-2 text-caption uppercase tracking-wide text-text-secondary">
              <tr>
                <th className="px-4 py-2 text-left">Month</th>
                <th className="px-4 py-2 text-right">Revenue</th>
                <th className="px-4 py-2 text-right">COGS</th>
                <th className="px-4 py-2 text-right">Gross margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {data.trend.map((t) => (
                <tr key={t.monthStart}>
                  <td className="px-4 py-2 text-text-primary">
                    {formatMonthShort(t.monthStart)}
                  </td>
                  <td className="px-4 py-2 text-right text-text-primary">
                    {formatLKR(t.revenueCents)}
                  </td>
                  <td className="px-4 py-2 text-right text-text-secondary">
                    {formatLKR(t.cogsCents)}
                  </td>
                  <td
                    className={`px-4 py-2 text-right ${gmTone(t.grossMarginBps)}`}
                  >
                    {formatBps(t.grossMarginBps)}
                  </td>
                </tr>
              ))}
              {data.trend.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-caption text-text-secondary"
                  >
                    No activity in the last 6 months.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

void formatNumber; // exported for future per-month invoice-count column
