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
  qs.set("limit", "200");
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

function relativeTime(s: string | null): string {
  if (!s) return "Never";
  const diffMs = Date.now() - new Date(s).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case "active":
      return { label: "Active", cls: "bg-mint/20 text-mint ring-1 ring-inset ring-mint/30" };
    case "suspended":
      return { label: "Suspended", cls: "bg-red-500/20 text-red-300 ring-1 ring-inset ring-red-500/30" };
    case "trial":
      return { label: "Trial", cls: "bg-amber-400/20 text-amber-200 ring-1 ring-inset ring-amber-400/30" };
    case "past-due":
      return { label: "Past due", cls: "bg-orange-500/20 text-orange-200 ring-1 ring-inset ring-orange-500/30" };
    case "churned":
      return { label: "Churned", cls: "bg-white/10 text-white/60 ring-1 ring-inset ring-white/20" };
    default:
      return { label: status, cls: "bg-white/10 text-white/70" };
  }
}

type SortKey = "name" | "status" | "country" | "users" | "lastActive" | "created";
type SortDir = "asc" | "desc";

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function sortTenants(
  tenants: TenantSummary[],
  key: SortKey,
  dir: SortDir,
): TenantSummary[] {
  const out = [...tenants];
  out.sort((a, b) => {
    let delta = 0;
    switch (key) {
      case "name":
        delta = cmp(a.businessName.toLowerCase(), b.businessName.toLowerCase());
        break;
      case "status":
        delta = cmp(a.status, b.status);
        break;
      case "country":
        delta = cmp(a.country, b.country);
        break;
      case "users":
        delta = cmp(a.userCount, b.userCount);
        break;
      case "lastActive":
        delta = cmp(
          a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : null,
          b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : null,
        );
        break;
      case "created":
        delta = cmp(new Date(a.createdAt).getTime(), new Date(b.createdAt).getTime());
        break;
    }
    return dir === "desc" ? -delta : delta;
  });
  return out;
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  params,
  align,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  params: { status?: string; search?: string };
  align?: "left" | "right";
}) {
  const active = currentKey === sortKey;
  const nextDir: SortDir = active && currentDir === "asc" ? "desc" : "asc";
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.search) qs.set("search", params.search);
  qs.set("sort", sortKey);
  qs.set("dir", nextDir);
  const arrow = active ? (currentDir === "asc" ? "↑" : "↓") : "";
  return (
    <th className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <Link
        href={`/platform/tenants?${qs.toString()}`}
        className={`group inline-flex items-center gap-1 hover:text-white ${
          active ? "text-white" : ""
        }`}
      >
        {label}
        <span className="text-[0.6rem] opacity-60 group-hover:opacity-100">
          {arrow || "↕"}
        </span>
      </Link>
    </th>
  );
}

export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: {
    status?: string;
    search?: string;
    sort?: SortKey;
    dir?: SortDir;
  };
}) {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const data = await fetchTenants({
    status: searchParams.status,
    search: searchParams.search,
  });
  const tenantsRaw = data?.tenants ?? [];
  const total = data?.total ?? 0;
  const currentStatus = searchParams.status ?? "all";
  const currentSort = (searchParams.sort as SortKey) ?? "created";
  const currentDir = (searchParams.dir as SortDir) ?? "desc";
  const tenants = sortTenants(tenantsRaw, currentSort, currentDir);

  return (
    <div className="px-6 py-10">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 text-caption text-white/50">
            <Link href="/platform" className="hover:text-white">
              Overview
            </Link>
            <span aria-hidden>›</span>
            <span className="text-white/70">Tenants</span>
          </div>
          <h1 className="mt-2 text-h1 text-white">Tenants</h1>
          <p className="mt-1 text-small text-white/60">
            {total.toLocaleString()} {total === 1 ? "business" : "businesses"} on the platform.
          </p>
        </div>
      </div>

      <form
        method="GET"
        action="/platform/tenants"
        className="mt-8 flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[200px]">
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
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="past-due">Past due</option>
            <option value="suspended">Suspended</option>
            <option value="churned">Churned</option>
          </select>
        </div>
        {/* Preserve sort state when the user hits Apply */}
        {searchParams.sort && (
          <input type="hidden" name="sort" value={searchParams.sort} />
        )}
        {searchParams.dir && (
          <input type="hidden" name="dir" value={searchParams.dir} />
        )}
        <button
          type="submit"
          className="rounded-md border border-white/10 bg-white/10 px-4 py-2 text-small text-white hover:bg-white/20"
        >
          Apply
        </button>
        {(searchParams.search || searchParams.status) && (
          <Link
            href="/platform/tenants"
            className="rounded-md px-4 py-2 text-small text-white/60 hover:text-white"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="mt-6 overflow-hidden rounded-card border border-white/10">
        <table className="w-full text-small">
          <thead className="bg-black/40 text-caption uppercase tracking-wide text-white/60">
            <tr>
              <SortHeader
                label="Business"
                sortKey="name"
                currentKey={currentSort}
                currentDir={currentDir}
                params={searchParams}
              />
              <SortHeader
                label="Status"
                sortKey="status"
                currentKey={currentSort}
                currentDir={currentDir}
                params={searchParams}
              />
              <SortHeader
                label="Country"
                sortKey="country"
                currentKey={currentSort}
                currentDir={currentDir}
                params={searchParams}
              />
              <SortHeader
                label="Users"
                sortKey="users"
                currentKey={currentSort}
                currentDir={currentDir}
                params={searchParams}
                align="right"
              />
              <SortHeader
                label="Last active"
                sortKey="lastActive"
                currentKey={currentSort}
                currentDir={currentDir}
                params={searchParams}
              />
              <SortHeader
                label="Created"
                sortKey="created"
                currentKey={currentSort}
                currentDir={currentDir}
                params={searchParams}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {tenants.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-white/50">
                  No tenants match those filters.
                </td>
              </tr>
            )}
            {tenants.map((t) => {
              const pill = statusPill(t.status);
              return (
                <tr
                  key={t.id}
                  className="cursor-pointer transition hover:bg-white/5"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/platform/tenants/${t.id}`}
                      className="block text-white hover:text-mint"
                    >
                      {t.businessName}
                    </Link>
                    <span className="text-caption text-white/40">/{t.slug}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-caption ${pill.cls}`}
                    >
                      {pill.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/70">{t.country}</td>
                  <td className="px-4 py-3 text-right text-white/80 tabular-nums">
                    {t.userCount}
                  </td>
                  <td className="px-4 py-3 text-white/70">
                    {relativeTime(t.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3 text-white/70">
                    {formatDate(t.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
