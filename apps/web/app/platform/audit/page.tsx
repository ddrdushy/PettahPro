import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { PlatformAuditEntryWithTenant } from "@/lib/platform-api";

export const metadata: Metadata = {
  title: "Audit · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchMe(): Promise<{ email: string; role: string } | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/platform/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      user: { email: string; role: string };
    };
    return body.user;
  } catch {
    return null;
  }
}

async function fetchAudit(params: {
  kind?: string;
  actor?: string;
  limit: number;
  offset: number;
}): Promise<{
  total: number;
  limit: number;
  offset: number;
  entries: PlatformAuditEntryWithTenant[];
} | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  const qs = new URLSearchParams();
  if (params.kind) qs.set("kind", params.kind);
  if (params.actor) qs.set("actor", params.actor);
  qs.set("limit", String(params.limit));
  qs.set("offset", String(params.offset));
  try {
    const res = await fetch(`${API}/platform/audit?${qs.toString()}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      total: number;
      limit: number;
      offset: number;
      entries: PlatformAuditEntryWithTenant[];
    };
  } catch {
    return null;
  }
}

function formatDateTime(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

// Keep the filter-preserving pager tight. We always round-trip kind +
// actor so the user doesn't lose their filter when they page.
function pagerHref(
  offset: number,
  params: { kind?: string; actor?: string; limit: number },
): string {
  const qs = new URLSearchParams();
  if (params.kind) qs.set("kind", params.kind);
  if (params.actor) qs.set("actor", params.actor);
  qs.set("limit", String(params.limit));
  qs.set("offset", String(Math.max(0, offset)));
  return `/platform/audit?${qs.toString()}`;
}

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: {
    kind?: string;
    actor?: string;
    limit?: string;
    offset?: string;
  };
}) {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const limit = Math.min(
    500,
    Math.max(1, Number.parseInt(searchParams.limit ?? "50", 10) || 50),
  );
  const offset = Math.max(
    0,
    Number.parseInt(searchParams.offset ?? "0", 10) || 0,
  );

  const data = await fetchAudit({
    kind: searchParams.kind,
    actor: searchParams.actor,
    limit,
    offset,
  });

  if (!data) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-h1 text-white">Platform audit</h1>
        <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-small text-red-200">
          Could not load audit data. Check the API is running and you're still
          signed in.
        </p>
      </div>
    );
  }

  const { total, entries } = data;
  const pageStart = offset + 1;
  const pageEnd = Math.min(offset + entries.length, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <div className="px-6 py-10">
      <div className="flex items-center gap-3 text-caption text-white/50">
        <Link href="/platform" className="hover:text-white">
          Overview
        </Link>
        <span aria-hidden>›</span>
        <span className="text-white/70">Audit</span>
      </div>
      <div className="mt-2 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-h1 text-white">Platform audit</h1>
          <p className="mt-1 text-small text-white/60">
            Every action taken by platform staff — tenant suspensions,
            impersonation requests, staff changes, reveals. Immutable, most
            recent first.
          </p>
        </div>
      </div>

      <form
        method="GET"
        action="/platform/audit"
        className="mt-8 flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="kind" className="block text-caption text-white/60">
            Action kind
          </label>
          <input
            id="kind"
            name="kind"
            defaultValue={searchParams.kind ?? ""}
            placeholder="e.g. platform.tenant_suspended"
            className="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-small text-white placeholder:text-white/30 focus:border-mint focus:outline-none"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="actor" className="block text-caption text-white/60">
            Actor (email)
          </label>
          <input
            id="actor"
            name="actor"
            type="email"
            defaultValue={searchParams.actor ?? ""}
            placeholder="admin@example.com"
            className="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-small text-white placeholder:text-white/30 focus:border-mint focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="limit" className="block text-caption text-white/60">
            Per page
          </label>
          <select
            id="limit"
            name="limit"
            defaultValue={String(limit)}
            className="mt-1 block rounded-md border border-white/10 bg-black/30 px-3 py-2 text-small text-white focus:border-mint focus:outline-none"
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md border border-white/10 bg-white/10 px-4 py-2 text-small text-white hover:bg-white/20"
        >
          Apply
        </button>
        {(searchParams.kind || searchParams.actor) && (
          <Link
            href="/platform/audit"
            className="rounded-md px-4 py-2 text-small text-white/60 hover:text-white"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="mt-6 flex items-center justify-between text-caption text-white/50">
        <span>
          {total === 0
            ? "No entries"
            : `Showing ${pageStart}–${pageEnd} of ${total.toLocaleString()}`}
        </span>
        <div className="flex items-center gap-2">
          <Link
            href={pagerHref(offset - limit, {
              kind: searchParams.kind,
              actor: searchParams.actor,
              limit,
            })}
            aria-disabled={!hasPrev}
            className={`rounded-md border border-white/10 px-3 py-1 text-caption ${
              hasPrev
                ? "text-white hover:bg-white/10"
                : "pointer-events-none text-white/30"
            }`}
          >
            ← Prev
          </Link>
          <Link
            href={pagerHref(offset + limit, {
              kind: searchParams.kind,
              actor: searchParams.actor,
              limit,
            })}
            aria-disabled={!hasNext}
            className={`rounded-md border border-white/10 px-3 py-1 text-caption ${
              hasNext
                ? "text-white hover:bg-white/10"
                : "pointer-events-none text-white/30"
            }`}
          >
            Next →
          </Link>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-card border border-white/10">
        <table className="w-full text-small">
          <thead className="bg-black/40 text-caption uppercase tracking-wide text-white/60">
            <tr>
              <th className="px-4 py-3 text-left">When</th>
              <th className="px-4 py-3 text-left">Kind</th>
              <th className="px-4 py-3 text-left">Actor</th>
              <th className="px-4 py-3 text-left">Tenant</th>
              <th className="px-4 py-3 text-left">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center text-white/50">
                  No audit entries match those filters.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="px-4 py-3 whitespace-nowrap text-white/60">
                  {formatDateTime(e.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={pagerHref(0, {
                      kind: e.kind,
                      actor: searchParams.actor,
                      limit,
                    })}
                    className="font-mono text-[0.7rem] text-white/70 hover:text-mint"
                    title="Filter by this kind"
                  >
                    {e.kind}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={pagerHref(0, {
                      kind: searchParams.kind,
                      actor: e.platformUserEmail,
                      limit,
                    })}
                    className="text-white/80 hover:text-mint"
                    title="Filter by this actor"
                  >
                    {e.platformUserEmail}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {e.tenantId ? (
                    <Link
                      href={`/platform/tenants/${e.tenantId}`}
                      className="text-white/70 hover:text-mint hover:underline"
                    >
                      tenant →
                    </Link>
                  ) : (
                    <span className="text-white/30">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-white">
                  <div>{e.summary}</div>
                  {e.reason && (
                    <div className="mt-0.5 text-caption text-white/50">
                      Reason: {e.reason}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
