import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { RevenuePayload } from "@/lib/platform-api";

export const metadata: Metadata = {
  title: "Revenue · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchMe(): Promise<{
  email: string;
  fullName: string;
  role: string;
} | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/platform/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      user: { email: string; fullName: string; role: string };
    };
    return body.user;
  } catch {
    return null;
  }
}

async function fetchRevenue(): Promise<RevenuePayload | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/platform/revenue`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as RevenuePayload;
  } catch {
    return null;
  }
}

function formatLkr(cents: number): string {
  return `LKR ${(cents / 100).toLocaleString("en-LK", {
    maximumFractionDigits: 0,
  })}`;
}

function formatPct(rate: number | null, digits = 1): string {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

function formatMonthShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-LK", { month: "short" });
  } catch {
    return iso;
  }
}

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  spark?: number[];
  tone?: "default" | "good" | "warn" | "bad";
}

const TONE_CLASSES: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "text-white",
  good: "text-mint",
  warn: "text-amber-300",
  bad: "text-rose-300",
};

function KpiCard({ label, value, hint, spark, tone = "default" }: KpiCardProps) {
  return (
    <div className="rounded-card border border-white/10 bg-black/20 p-5 flex flex-col">
      <div className="text-caption uppercase tracking-wide text-white/50">
        {label}
      </div>
      <div className={`mt-2 text-h1 ${TONE_CLASSES[tone]}`}>{value}</div>
      {hint && <p className="mt-1 text-caption text-white/50">{hint}</p>}
      {spark && spark.length > 1 && <Sparkline values={spark} />}
    </div>
  );
}

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

export default async function PlatformRevenuePage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const data = await fetchRevenue();

  return (
    <div className="px-6 py-10">
      <div className="flex items-center gap-3 text-caption text-white/50">
        <Link href="/platform" className="hover:text-white">
          Overview
        </Link>
        <span aria-hidden>›</span>
        <span className="text-white/70">Revenue</span>
      </div>
      <h1 className="mt-2 text-h1 text-white">Revenue analytics</h1>
      <p className="mt-1 text-small text-white/60">
        MRR, churn, signups, and per-plan breakdown across all tenants.
        Aggregate-only — no tenant-level revealing data per spec §11.
      </p>

      {!data ? (
        <p className="mt-10 rounded-md border border-red-500/30 bg-red-500/10 p-4 text-small text-red-200">
          Couldn't load revenue payload. Refresh, or check the API logs if
          this persists.
        </p>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="MRR (incl. add-ons)"
              value={formatLkr(data.mrrCents)}
              hint={`ARR ${formatLkr(data.arrCents)} · ${data.tenantCountsByStatus.active} active`}
              tone="good"
            />
            <KpiCard
              label="Add-on MRR"
              value={formatLkr(data.addons.mrrCents)}
              hint={`${data.addons.activeCount} active add-on subscription${data.addons.activeCount === 1 ? "" : "s"}`}
            />
            <KpiCard
              label="Signups (30d)"
              value={data.signups.last30Days.toString()}
              hint={`12-month total ${data.signups.last12Months.reduce((s, m) => s + m.count, 0)}`}
              spark={data.signups.last12Months.map((m) => m.count)}
            />
            <KpiCard
              label="Churn this month"
              value={data.churn.thisMonthCount.toString()}
              hint={
                data.churn.thisMonthMrrCents > 0
                  ? `${formatLkr(data.churn.thisMonthMrrCents)}/mo lost · ${formatPct(data.churn.rate)}`
                  : "No churn this month"
              }
              tone={
                data.churn.rate != null && data.churn.rate > 0.05
                  ? "bad"
                  : data.churn.rate != null && data.churn.rate > 0.02
                    ? "warn"
                    : "good"
              }
            />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            <KpiCard
              label="Trial conversion (30d)"
              value={formatPct(data.trialConversion.rate)}
              hint={`${data.trialConversion.last30DaysConverted} converted · ${data.trialConversion.last30DaysExpired} expired`}
            />
            <KpiCard
              label="Coupons redeemed (mo)"
              value={data.coupons.redeemedThisMonth.toString()}
              hint={`${data.coupons.activeRedemptions} active redemption${data.coupons.activeRedemptions === 1 ? "" : "s"}`}
            />
            <KpiCard
              label="Active tenants"
              value={data.tenantCountsByStatus.active.toString()}
              hint={`${data.tenantCountsByStatus.trial} trials · ${data.tenantCountsByStatus.past_due} past-due · ${data.tenantCountsByStatus.paused} paused`}
            />
          </div>

          {/* MRR by plan */}
          <section className="mt-12">
            <h2 className="text-h2 text-white">MRR by plan</h2>
            <div className="mt-4 overflow-hidden rounded-card border border-white/10 bg-black/20">
              <table className="w-full text-small">
                <thead className="bg-white/5 text-caption uppercase tracking-wide text-white/50">
                  <tr>
                    <th className="px-4 py-2 text-left">Plan</th>
                    <th className="px-4 py-2 text-right">Active subscribers</th>
                    <th className="px-4 py-2 text-right">MRR</th>
                    <th className="px-4 py-2 text-right">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.mrrByPlan.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-6 text-center text-caption text-white/50"
                      >
                        No plans in catalogue yet.
                      </td>
                    </tr>
                  ) : (
                    data.mrrByPlan.map((p) => {
                      const share =
                        data.mrrCents > 0
                          ? p.mrrCents / data.mrrCents
                          : 0;
                      return (
                        <tr key={p.planCode}>
                          <td className="px-4 py-3 text-white">
                            {p.planName}
                            <span className="ml-2 text-caption text-white/50 font-mono">
                              {p.planCode}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-white/80">
                            {p.activeSubscribers}
                          </td>
                          <td className="px-4 py-3 text-right text-white">
                            {formatLkr(p.mrrCents)}
                          </td>
                          <td className="px-4 py-3 text-right text-white/60">
                            {(share * 100).toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Signup trend */}
          <section className="mt-12">
            <h2 className="text-h2 text-white">Signups, last 12 months</h2>
            <div className="mt-4 overflow-hidden rounded-card border border-white/10 bg-black/20 p-5">
              <div className="flex items-end gap-2 h-32">
                {data.signups.last12Months.map((m) => {
                  const max = Math.max(
                    ...data.signups.last12Months.map((x) => x.count),
                    1,
                  );
                  const h = (m.count / max) * 100;
                  return (
                    <div
                      key={m.monthStart}
                      className="flex-1 flex flex-col items-center justify-end gap-1"
                      title={`${m.count} signup${m.count === 1 ? "" : "s"}`}
                    >
                      <div
                        className="w-full bg-mint/40 rounded-sm"
                        style={{ height: `${h}%`, minHeight: m.count > 0 ? 2 : 0 }}
                      />
                      <span className="text-caption text-white/40">
                        {formatMonthShort(m.monthStart)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex justify-between text-caption text-white/50">
                <span>
                  Total:{" "}
                  {data.signups.last12Months.reduce(
                    (s, m) => s + m.count,
                    0,
                  )}{" "}
                  signups
                </span>
                <span>Last 30 days: {data.signups.last30Days}</span>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
