import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { PlatformOverview } from "@/lib/platform-api";

export const metadata: Metadata = {
  title: "Overview · Platform",
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

async function fetchOverview(): Promise<PlatformOverview | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/platform/overview`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as PlatformOverview;
  } catch {
    return null;
  }
}

function formatRelative(s: string | null): string {
  if (!s) return "—";
  const diffMs = Date.now() - new Date(s).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(s).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

// Status → pill colour map. Same as the tenants-list page; reimporting
// a shared helper would be a single call site, hardly worth a module.
function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case "active":
      return { label: "Active", cls: "text-mint" };
    case "suspended":
      return { label: "Suspended", cls: "text-red-300" };
    case "trial":
      return { label: "Trial", cls: "text-amber-200" };
    case "past-due":
      return { label: "Past due", cls: "text-orange-200" };
    case "churned":
      return { label: "Churned", cls: "text-white/50" };
    default:
      return { label: status, cls: "text-white/70" };
  }
}

export default async function PlatformOverviewPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const data = await fetchOverview();

  if (!data) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-h1 text-white">Overview</h1>
        <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-small text-red-200">
          Could not load overview data. Check the API is running and you're
          still signed in.
        </p>
      </div>
    );
  }

  const statusOrder = ["active", "trial", "past-due", "suspended", "churned"];
  const healthyCount = data.tenants.byStatus.active ?? 0;
  const attentionCount =
    (data.tenants.byStatus["past-due"] ?? 0) +
    (data.tenants.byStatus.suspended ?? 0);
  const { activeSessions, pendingRequests, approvedWaiting } =
    data.impersonation;

  return (
    <div className="px-6 py-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-h1 text-white">Overview</h1>
          <p className="mt-1 text-small text-white/60">
            Signed in as {me.email} ·{" "}
            <span className="text-white/80">{me.role.replace("_", " ")}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/platform/tenants"
            className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-small text-white hover:bg-white/10"
          >
            All tenants →
          </Link>
          {(me.role === "super_admin" || me.role === "support") && (
            <Link
              href="/platform/impersonation"
              className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-small text-white hover:bg-white/10"
            >
              Impersonation →
            </Link>
          )}
        </div>
      </div>

      {/* Hero strip — one line, at-a-glance summary */}
      <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
        <HeroStat
          label="Tenants"
          value={data.tenants.total.toLocaleString()}
          hint={`${healthyCount} active · ${attentionCount} need attention`}
        />
        <HeroStat
          label="Signups this week"
          value={data.tenants.signupsLast7Days.toString()}
          hint={`${data.tenants.signupsLast30Days} in last 30 days`}
          trend={data.tenants.signupsLast7Days > 0 ? "up" : "flat"}
        />
        <HeroStat
          label="Active users this week"
          value={data.users.activeLast7Days.toLocaleString()}
          hint={`${data.users.total.toLocaleString()} total · ${data.users.activeLast30Days.toLocaleString()} active last 30 d`}
        />
        <HeroStat
          label="Impersonation"
          value={activeSessions.toString()}
          hint={
            activeSessions > 0
              ? `${activeSessions} live ${activeSessions === 1 ? "session" : "sessions"}`
              : pendingRequests > 0
                ? `${pendingRequests} pending approval`
                : "Nothing active"
          }
          accent={activeSessions > 0 ? "red" : pendingRequests > 0 ? "amber" : "mint"}
        />
      </section>

      {/* Two-column layout: tenant health breakdown + recent audit */}
      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2 rounded-card border border-white/10 bg-black/20 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-h3 text-white">Tenant health</h2>
            <Link
              href="/platform/tenants"
              className="text-caption text-white/50 hover:text-white"
            >
              View all →
            </Link>
          </div>
          <p className="mt-1 text-caption text-white/50">
            Every business on the platform, grouped by status.
          </p>
          <ul className="mt-6 space-y-3">
            {statusOrder.map((status) => {
              const n = data.tenants.byStatus[status] ?? 0;
              const pct =
                data.tenants.total > 0 ? (n / data.tenants.total) * 100 : 0;
              const pill = statusPill(status);
              return (
                <li key={status} className="space-y-1">
                  <div className="flex items-center justify-between text-small">
                    <Link
                      href={`/platform/tenants?status=${encodeURIComponent(status)}`}
                      className={`font-medium hover:underline ${pill.cls}`}
                    >
                      {pill.label}
                    </Link>
                    <span className="tabular-nums text-white/70">
                      {n} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={`h-full rounded-full ${
                        status === "active"
                          ? "bg-mint"
                          : status === "suspended"
                            ? "bg-red-400"
                            : status === "trial"
                              ? "bg-amber-400"
                              : status === "past-due"
                                ? "bg-orange-400"
                                : "bg-white/20"
                      }`}
                      style={{ width: `${Math.max(pct, n > 0 ? 3 : 0)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Impersonation subsection — only the super_admin + support
              ever see this in the nav, but we render it here regardless
              so billing gets told "this platform has supervised access"
              without being able to operate it. */}
          {(activeSessions > 0 ||
            pendingRequests > 0 ||
            approvedWaiting > 0) && (
            <div className="mt-6 rounded-md border border-white/10 bg-black/30 p-4">
              <h3 className="text-small font-medium text-white">
                Impersonation pressure
              </h3>
              <dl className="mt-2 grid grid-cols-3 gap-4 text-small">
                <MiniStat
                  label="Pending"
                  value={pendingRequests}
                  color="amber"
                />
                <MiniStat
                  label="Approved, not started"
                  value={approvedWaiting}
                  color="mint"
                />
                <MiniStat
                  label="Live now"
                  value={activeSessions}
                  color="red"
                />
              </dl>
            </div>
          )}
        </div>

        <div className="lg:col-span-3 rounded-card border border-white/10 bg-black/20 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-h3 text-white">Recent platform activity</h2>
            <Link
              href="/platform/audit"
              className="text-caption text-white/50 hover:text-white"
            >
              Full audit →
            </Link>
          </div>
          <p className="mt-1 text-caption text-white/50">
            Last {data.recentAudit.length} actions by platform staff.
          </p>
          {data.recentAudit.length === 0 ? (
            <p className="mt-6 text-small text-white/50">
              No platform activity recorded yet.
            </p>
          ) : (
            <ol className="mt-6 space-y-3">
              {data.recentAudit.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start justify-between gap-4 border-b-hairline border-white/5 pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-small text-white">
                      {e.summary}
                    </p>
                    <p className="mt-0.5 text-caption text-white/50">
                      <span className="font-mono text-[0.7rem] text-white/40">
                        {e.kind}
                      </span>
                      {" · "}
                      {e.platformUserEmail}
                      {e.tenantId && (
                        <>
                          {" · "}
                          <Link
                            href={`/platform/tenants/${e.tenantId}`}
                            className="hover:text-white hover:underline"
                          >
                            tenant
                          </Link>
                        </>
                      )}
                    </p>
                    {e.reason && (
                      <p className="mt-0.5 truncate text-caption text-white/40">
                        Reason: {e.reason}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-caption text-white/50">
                    {formatRelative(e.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

function HeroStat({
  label,
  value,
  hint,
  trend,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: "up" | "down" | "flat";
  accent?: "mint" | "amber" | "red";
}) {
  const accentCls =
    accent === "red"
      ? "border-red-500/40 bg-red-500/10"
      : accent === "amber"
        ? "border-amber-400/40 bg-amber-400/10"
        : "border-white/10 bg-black/20";
  const valueCls =
    accent === "red"
      ? "text-red-300"
      : accent === "amber"
        ? "text-amber-200"
        : "text-white";
  return (
    <div className={`rounded-card border p-5 ${accentCls}`}>
      <p className="text-caption uppercase tracking-wide text-white/50">
        {label}
      </p>
      <p className={`mt-2 text-[2.25rem] font-semibold leading-none tabular-nums ${valueCls}`}>
        {value}
        {trend === "up" && (
          <span className="ml-2 align-middle text-small text-mint">↑</span>
        )}
      </p>
      {hint && <p className="mt-2 text-caption text-white/50">{hint}</p>}
    </div>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "mint" | "amber" | "red";
}) {
  const cls =
    color === "red"
      ? "text-red-300"
      : color === "amber"
        ? "text-amber-200"
        : "text-mint";
  return (
    <div>
      <dt className="text-caption text-white/50">{label}</dt>
      <dd className={`mt-1 text-h3 font-semibold tabular-nums ${cls}`}>
        {value}
      </dd>
    </div>
  );
}
