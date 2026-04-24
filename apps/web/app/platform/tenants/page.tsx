import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { PlatformPlan, TenantSummary } from "@/lib/platform-api";
import { SavedViewsBar } from "@/components/platform/saved-views-bar";
import { TenantListClient } from "@/components/platform/tenant-list-client";

export const metadata: Metadata = {
  title: "Tenants · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

// Platform console is path-scoped so we always re-verify the session on
// each request — no client-side trust. Uses the cookie header verbatim
// (the platform cookie is path=/platform, but Next's `cookies()` gives
// us the raw header which includes it when the incoming request URL
// starts with /platform).

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

async function fetchTenants(params: {
  status?: string;
  plan?: string;
  subscriptionStatus?: string;
  trialEndingSoon?: string;
  search?: string;
}): Promise<{ total: number; tenants: TenantSummary[] } | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.plan && params.plan !== "all") qs.set("plan", params.plan);
  if (params.subscriptionStatus && params.subscriptionStatus !== "all") {
    qs.set("subscriptionStatus", params.subscriptionStatus);
  }
  if (params.trialEndingSoon === "true") qs.set("trialEndingSoon", "true");
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

type SortKey =
  | "name"
  | "status"
  | "plan"
  | "subscription"
  | "country"
  | "users"
  | "lastActive"
  | "created";
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
        delta = cmp(
          a.businessName.toLowerCase(),
          b.businessName.toLowerCase(),
        );
        break;
      case "status":
        delta = cmp(a.status, b.status);
        break;
      case "plan":
        delta = cmp(a.planCode, b.planCode);
        break;
      case "subscription":
        delta = cmp(a.subscriptionStatus, b.subscriptionStatus);
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
        delta = cmp(
          new Date(a.createdAt).getTime(),
          new Date(b.createdAt).getTime(),
        );
        break;
    }
    return dir === "desc" ? -delta : delta;
  });
  return out;
}

// Build the canonical querystring for the current filter state. Used
// by the SavedViewsBar so "save current view" captures the right
// filter + sort combo.
function currentQueryString(sp: {
  status?: string;
  plan?: string;
  subscriptionStatus?: string;
  trialEndingSoon?: string;
  search?: string;
  sort?: string;
  dir?: string;
}): string {
  const qs = new URLSearchParams();
  if (sp.status && sp.status !== "all") qs.set("status", sp.status);
  if (sp.plan && sp.plan !== "all") qs.set("plan", sp.plan);
  if (sp.subscriptionStatus && sp.subscriptionStatus !== "all") {
    qs.set("subscriptionStatus", sp.subscriptionStatus);
  }
  if (sp.trialEndingSoon === "true") qs.set("trialEndingSoon", "true");
  if (sp.search) qs.set("search", sp.search);
  if (sp.sort) qs.set("sort", sp.sort);
  if (sp.dir) qs.set("dir", sp.dir);
  return qs.toString();
}

export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: {
    status?: string;
    plan?: string;
    subscriptionStatus?: string;
    trialEndingSoon?: string;
    search?: string;
    sort?: SortKey;
    dir?: SortDir;
  };
}) {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const [data, availablePlans] = await Promise.all([
    fetchTenants({
      status: searchParams.status,
      plan: searchParams.plan,
      subscriptionStatus: searchParams.subscriptionStatus,
      trialEndingSoon: searchParams.trialEndingSoon,
      search: searchParams.search,
    }),
    fetchPlans(),
  ]);
  const tenantsRaw = data?.tenants ?? [];
  const total = data?.total ?? 0;
  const currentStatus = searchParams.status ?? "all";
  const currentPlan = searchParams.plan ?? "all";
  const currentSubStatus = searchParams.subscriptionStatus ?? "all";
  const trialSoonOn = searchParams.trialEndingSoon === "true";
  const currentSort = (searchParams.sort as SortKey) ?? "created";
  const currentDir = (searchParams.dir as SortDir) ?? "desc";
  const tenants = sortTenants(tenantsRaw, currentSort, currentDir);
  // #59 — bulk suspend/reactivate is super_admin-only, mirroring the
  // role gate on the single-endpoint + bulk-action API route.
  const canBulkAct = me.role === "super_admin";
  const currentQs = currentQueryString(searchParams);

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
            {total.toLocaleString()} {total === 1 ? "business" : "businesses"}{" "}
            on the platform.
          </p>
        </div>
      </div>

      {/* Saved views live above the filter form — one-tap apply, and
          a "save current" button that captures the exact querystring
          you're staring at. */}
      <div className="mt-8">
        <SavedViewsBar
          scope="tenants"
          pageBasePath="/platform/tenants"
          currentQueryString={currentQs}
        />
      </div>

      <form
        method="GET"
        action="/platform/tenants"
        className="mt-4 flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="search" className="block text-caption text-white/60">
            Search
          </label>
          <input
            id="search"
            name="search"
            defaultValue={searchParams.search ?? ""}
            placeholder="Business name or slug  (press / to focus)"
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
        {/* Plan filter (#66) — catalogue-driven so hidden / grandfathered
            plans still filterable. Sorted server-side by sort_order. */}
        <div>
          <label htmlFor="plan" className="block text-caption text-white/60">
            Plan
          </label>
          <select
            id="plan"
            name="plan"
            defaultValue={currentPlan}
            className="mt-1 block rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
          >
            <option value="all">All plans</option>
            {availablePlans.map((p) => (
              <option key={p.id} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {/* Subscription-status filter — distinct from tenant lifecycle status.
            Revenue ops uses this to find past_due tenants to dun, and
            cancelled tenants to re-engage. */}
        <div>
          <label htmlFor="subscriptionStatus" className="block text-caption text-white/60">
            Subscription
          </label>
          <select
            id="subscriptionStatus"
            name="subscriptionStatus"
            defaultValue={currentSubStatus}
            className="mt-1 block rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
          >
            <option value="all">All</option>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {/* Trial-ending-soon toggle. Narrow 7-day window so ops gets a
            call-today list, not the full trial pool. */}
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-small text-white hover:bg-white/10">
            <input
              type="checkbox"
              name="trialEndingSoon"
              value="true"
              defaultChecked={trialSoonOn}
              className="h-4 w-4 cursor-pointer rounded border-white/20 bg-black/40 text-mint focus:ring-mint"
            />
            Trial ending in 7d
          </label>
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
        {(searchParams.search ||
          searchParams.status ||
          searchParams.plan ||
          searchParams.subscriptionStatus ||
          searchParams.trialEndingSoon) && (
          <Link
            href="/platform/tenants"
            className="rounded-md px-4 py-2 text-small text-white/60 hover:text-white"
          >
            Clear
          </Link>
        )}
      </form>

      <TenantListClient
        tenants={tenants}
        searchTerm={searchParams.search ?? ""}
        canBulkAct={canBulkAct}
        currentSort={currentSort}
        currentDir={currentDir}
        baseParams={{
          status: searchParams.status,
          plan: searchParams.plan,
          subscriptionStatus: searchParams.subscriptionStatus,
          trialEndingSoon: searchParams.trialEndingSoon,
          search: searchParams.search,
        }}
      />
    </div>
  );
}
