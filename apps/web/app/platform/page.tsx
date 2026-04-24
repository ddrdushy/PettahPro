import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { TenantSummary } from "@/lib/platform-api";

export const metadata: Metadata = {
  title: "Tenants · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

// Platform console is path-scoped so we always re-verify the session on
// each request — no client-side trust. Uses the cookie header verbatim
// (the platform cookie is path=/platform, but Next's `cookies()` gives
// us the raw header which includes it when the incoming request URL
// starts with /platform).

async function fetchMe(): Promise<{ email: string; fullName: string } | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/platform/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user: { email: string; fullName: string } };
    return body.user;
  } catch {
    return null;
  }
}

async function fetchTenants(params: {
  status?: string;
  search?: string;
}): Promise<{ total: number; tenants: TenantSummary[] } | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.search) qs.set("search", params.search);
  qs.set("limit", "100");
  try {
    const res = await fetch(`${API}/platform/tenants?${qs.toString()}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as { total: number; tenants: TenantSummary[] };
  } catch {
    return null;
  }
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case "active":
      return { label: "Active", cls: "bg-mint/20 text-mint" };
    case "suspended":
      return { label: "Suspended", cls: "bg-red-500/20 text-red-300" };
    case "trial":
      return { label: "Trial", cls: "bg-amber-400/20 text-amber-200" };
    case "past-due":
      return { label: "Past due", cls: "bg-orange-500/20 text-orange-200" };
    case "churned":
      return { label: "Churned", cls: "bg-white/10 text-white/60" };
    default:
      return { label: status, cls: "bg-white/10 text-white/70" };
  }
}

export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: { status?: string; search?: string };
}) {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const data = await fetchTenants({ status: searchParams.status, search: searchParams.search });
  const tenants = data?.tenants ?? [];
  const total = data?.total ?? 0;
  const currentStatus = searchParams.status ?? "all";

  return (
    <div className="px-6 py-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-h1 text-white">Tenants</h1>
          <p className="mt-2 text-small text-white/70">
            Every business on the platform. {total.toLocaleString()} total.
          </p>
        </div>
        <div className="text-right text-caption text-white/50">
          Signed in as<br />
          <span className="text-white/80">{me.email}</span>
        </div>
      </div>

      <form method="GET" action="/platform" className="mt-8 flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="search" className="block text-caption text-white/60">
            Search
          </label>
          <input
            id="search"
            name="search"
            defaultValue={searchParams.search ?? ""}
            placeholder="Business name or slug"
            className="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body text-white placeholder:text-white/30 focus:border-mint focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="status" className="block text-caption text-white/60">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={currentStatus}
            className="mt-1 block rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="past-due">Past due</option>
            <option value="suspended">Suspended</option>
            <option value="churned">Churned</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md border border-white/10 bg-white/10 px-4 py-2 text-small text-white hover:bg-white/20"
        >
          Apply
        </button>
      </form>

      <div className="mt-8 overflow-hidden rounded-card border border-white/10">
        <table className="w-full text-small">
          <thead className="bg-black/40 text-caption uppercase tracking-wide text-white/60">
            <tr>
              <th className="px-4 py-3 text-left">Business</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Country</th>
              <th className="px-4 py-3 text-right">Users</th>
              <th className="px-4 py-3 text-left">Last active</th>
              <th className="px-4 py-3 text-left">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {tenants.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-white/50">
                  No tenants match those filters.
                </td>
              </tr>
            )}
            {tenants.map((t) => {
              const pill = statusPill(t.status);
              return (
                <tr key={t.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <Link
                      href={`/platform/tenants/${t.id}`}
                      className="block text-white hover:underline"
                    >
                      {t.businessName}
                    </Link>
                    <span className="text-caption text-white/40">/{t.slug}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-caption ${pill.cls}`}>
                      {pill.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/70">{t.country}</td>
                  <td className="px-4 py-3 text-right text-white/70">{t.userCount}</td>
                  <td className="px-4 py-3 text-white/70">{formatDate(t.lastLoginAt)}</td>
                  <td className="px-4 py-3 text-white/70">{formatDate(t.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
