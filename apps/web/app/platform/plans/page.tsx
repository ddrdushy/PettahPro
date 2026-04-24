import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { PlatformPlan } from "@/lib/platform-api";

export const metadata: Metadata = {
  title: "Plans · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

// #61 — Plan catalogue read-out. Shows the three seeded tiers side-by-
// side so an operator can eyeball "what's on the menu" without opening
// a tenant. Read-only for this PR; plan editing (add/edit/archive) is
// a later ticket once we have a real need to edit prices outside of a
// migration.

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

async function fetchPlans(): Promise<PlatformPlan[]> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return [];
  try {
    const res = await fetch(`${API}/platform/plans`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { plans: PlatformPlan[] };
    return body.plans;
  } catch {
    return [];
  }
}

function formatMoney(cents: number, currency: string): string {
  const major = cents / 100;
  return `${currency} ${major.toLocaleString("en-LK", {
    maximumFractionDigits: currency === "LKR" ? 0 : 2,
  })}`;
}

function formatLimit(n: number | null): string {
  return n == null ? "Unlimited" : n.toLocaleString();
}

export default async function PlatformPlansPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const plans = await fetchPlans();

  return (
    <div className="px-6 py-10">
      <div className="flex items-center gap-3 text-caption text-white/50">
        <Link href="/platform" className="hover:text-white">
          Overview
        </Link>
        <span aria-hidden>›</span>
        <span className="text-white/70">Plans</span>
      </div>
      <h1 className="mt-2 text-h1 text-white">Plan catalogue</h1>
      <p className="mt-1 text-small text-white/60">
        The three seeded tiers. Changes today require a migration; a richer
        editor ships with the self-serve billing PR.
      </p>

      {plans.length === 0 ? (
        <p className="mt-10 rounded-md border border-red-500/30 bg-red-500/10 p-4 text-small text-red-200">
          Could not load plans. Check that the migration ran and the API is up.
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.id}
              className="flex flex-col rounded-card border border-white/10 bg-black/20 p-6"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-h2 text-white">{p.name}</h2>
                  <p className="mt-1 text-caption text-white/50">{p.tagline}</p>
                </div>
                {!p.isPublic && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-caption text-white/60">
                    Hidden
                  </span>
                )}
              </div>
              <div className="mt-6 space-y-1">
                <div className="text-h3 text-white">
                  {formatMoney(p.monthlyPriceCents, p.currency)}
                  <span className="ml-2 text-caption text-white/50">/ mo</span>
                </div>
                <div className="text-small text-white/60">
                  or {formatMoney(p.yearlyPriceCents, p.currency)} / yr
                </div>
              </div>
              <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 text-small">
                <dt className="text-white/50">Users</dt>
                <dd className="text-right text-white/90">
                  {formatLimit(p.maxUsers)}
                </dd>
                <dt className="text-white/50">Invoices / mo</dt>
                <dd className="text-right text-white/90">
                  {formatLimit(p.maxInvoicesMonthly)}
                </dd>
                <dt className="text-white/50">Branches</dt>
                <dd className="text-right text-white/90">
                  {formatLimit(p.maxBranches)}
                </dd>
                <dt className="text-white/50">Warehouses</dt>
                <dd className="text-right text-white/90">
                  {formatLimit(p.maxWarehouses)}
                </dd>
              </dl>
              <div className="mt-6 border-t border-white/10 pt-4">
                <div className="text-caption uppercase tracking-wide text-white/50">
                  Features
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.features.length === 0 ? (
                    <span className="text-caption text-white/40">—</span>
                  ) : (
                    p.features.map((f) => (
                      <span
                        key={f}
                        className="rounded-full bg-white/5 px-2 py-0.5 text-caption text-white/70"
                      >
                        {f}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="mt-6 border-t border-white/10 pt-4 text-caption text-white/40">
                code{" "}
                <span className="font-mono text-white/60">{p.code}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
