import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type {
  PlatformImpersonationRequest,
  PlatformImpersonationSession,
} from "@/lib/platform-api";
import {
  StartImpersonationButton,
  EndImpersonationButton,
} from "@/components/platform/impersonation-dashboard-client";

/**
 * /platform/impersonation (#57 / gap L1 v1).
 *
 * The operator's dashboard: see what you've requested, start approved
 * sessions, and watch who's currently inside a tenant. Super_admin sees
 * everyone's requests/sessions; support sees only their own (the API
 * enforces that — the page just renders whatever it's given).
 *
 * Billing can't hit this URL anyway because the layout hides the nav
 * entry and the API refuses both list endpoints for the billing role.
 */

export const metadata: Metadata = {
  title: "Impersonation · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

interface MeResponse {
  user: { email: string; role: string };
}

async function fetchMe(): Promise<MeResponse["user"] | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  const res = await fetch(`${API}/platform/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as MeResponse;
  return body.user;
}

async function fetchRequests(): Promise<PlatformImpersonationRequest[]> {
  const cookieHeader = cookies().toString();
  const res = await fetch(`${API}/platform/impersonation-requests`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    requests: PlatformImpersonationRequest[];
  };
  return body.requests;
}

async function fetchSessions(): Promise<PlatformImpersonationSession[]> {
  const cookieHeader = cookies().toString();
  const res = await fetch(`${API}/platform/impersonation-sessions`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    sessions: PlatformImpersonationSession[];
  };
  return body.sessions;
}

function formatDateTime(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

function statusBadge(status: PlatformImpersonationRequest["status"]): {
  label: string;
  className: string;
} {
  switch (status) {
    case "pending":
      return {
        label: "Waiting for owner",
        className: "border-amber-400/40 bg-amber-400/10 text-amber-200",
      };
    case "approved":
      return {
        label: "Approved",
        className: "border-mint/40 bg-mint/10 text-mint",
      };
    case "refused":
      return {
        label: "Refused",
        className: "border-red-400/40 bg-red-400/10 text-red-200",
      };
    case "expired":
      return {
        label: "Expired",
        className: "border-white/10 bg-white/5 text-white/50",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        className: "border-white/10 bg-white/5 text-white/50",
      };
  }
}

export default async function ImpersonationDashboardPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");
  if (me.role !== "super_admin" && me.role !== "support") {
    // Billing ends up here if they type the URL. Send them home.
    redirect("/platform");
  }

  const [requests, sessions] = await Promise.all([
    fetchRequests(),
    fetchSessions(),
  ]);

  const activeSessions = sessions.filter((s) => s.endedAt === null);
  const endedSessions = sessions.filter((s) => s.endedAt !== null);

  // An approved request is "startable" by the current user if it's theirs
  // and no session has been created from it yet. The API enforces both
  // checks, but we hide the button when we can to keep the UI honest.
  const sessionRequestIds = new Set(sessions.map((s) => s.requestId));

  return (
    <div className="px-6 py-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-h1 text-white">Impersonation</h1>
          <p className="mt-1 text-small text-white/60">
            Your requests, live sessions, and history.{" "}
            {me.role === "support"
              ? "You see only your own records."
              : "You see every operator's records."}
          </p>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="text-h3 text-white">Active sessions</h2>
        <p className="mt-1 text-caption text-white/60">
          Someone is currently inside a tenant's books. Ends automatically at
          the deadline; can be cut short from here or by the tenant owner.
        </p>
        <div className="mt-4 overflow-hidden rounded-card border border-white/10">
          <table className="w-full text-small">
            <thead className="bg-black/40 text-caption uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-4 py-2 text-left">Operator</th>
                <th className="px-4 py-2 text-left">Tenant</th>
                <th className="px-4 py-2 text-left">As user</th>
                <th className="px-4 py-2 text-left">Started</th>
                <th className="px-4 py-2 text-left">Ends</th>
                <th className="px-4 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-black/20">
              {activeSessions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-white/50">
                    No one is impersonating a tenant right now.
                  </td>
                </tr>
              )}
              {activeSessions.map((s) => {
                const canEnd =
                  me.role === "super_admin" ||
                  s.platformUserEmail === me.email;
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-2 text-white/90">
                      {s.platformUserEmail}
                    </td>
                    <td className="px-4 py-2 text-white/90">
                      {s.tenantSlug ? (
                        <Link
                          href={`/platform/tenants/${s.targetTenantId}`}
                          className="hover:text-mint"
                        >
                          {s.tenantBusinessName ?? s.tenantSlug}
                        </Link>
                      ) : (
                        s.targetTenantId
                      )}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {s.targetUserEmail}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {formatDateTime(s.startedAt)}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {formatDateTime(s.endsAt)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {canEnd && <EndImpersonationButton sessionId={s.id} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-h3 text-white">Requests</h2>
        <p className="mt-1 text-caption text-white/60">
          Most recent first. Approved requests stay here until you start the
          session (or they expire 24 h after approval).
        </p>
        <div className="mt-4 overflow-hidden rounded-card border border-white/10">
          <table className="w-full text-small">
            <thead className="bg-black/40 text-caption uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-4 py-2 text-left">Tenant</th>
                <th className="px-4 py-2 text-left">Operator</th>
                <th className="px-4 py-2 text-left">Reason</th>
                <th className="px-4 py-2 text-left">Minutes</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Created</th>
                <th className="px-4 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-black/20">
              {requests.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-white/50">
                    No requests yet.
                  </td>
                </tr>
              )}
              {requests.map((r) => {
                const badge = statusBadge(r.status);
                const mine =
                  r.requestingPlatformUserEmail === me.email;
                const startable =
                  mine &&
                  r.status === "approved" &&
                  !sessionRequestIds.has(r.id);
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-white/90">
                      {r.tenantSlug ? (
                        <Link
                          href={`/platform/tenants/${r.targetTenantId}`}
                          className="hover:text-mint"
                        >
                          {r.tenantBusinessName ?? r.tenantSlug}
                        </Link>
                      ) : (
                        r.targetTenantId
                      )}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {r.requestingPlatformUserEmail}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      <span className="line-clamp-2" title={r.reason}>
                        {r.reason}
                      </span>
                      {r.refusedReason && (
                        <div className="mt-1 text-caption text-red-300/80">
                          Refused: {r.refusedReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {r.approvedMinutes ?? r.requestedMinutes}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-caption ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {startable && (
                        <StartImpersonationButton requestId={r.id} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {endedSessions.length > 0 && (
        <section className="mt-10">
          <h2 className="text-h3 text-white">Session history</h2>
          <div className="mt-4 overflow-hidden rounded-card border border-white/10">
            <table className="w-full text-small">
              <thead className="bg-black/40 text-caption uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-4 py-2 text-left">Operator</th>
                  <th className="px-4 py-2 text-left">Tenant</th>
                  <th className="px-4 py-2 text-left">Started</th>
                  <th className="px-4 py-2 text-left">Ended</th>
                  <th className="px-4 py-2 text-left">Ended by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-black/20">
                {endedSessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2 text-white/90">
                      {s.platformUserEmail}
                    </td>
                    <td className="px-4 py-2 text-white/80">
                      {s.tenantBusinessName ?? s.tenantSlug ?? s.targetTenantId}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {formatDateTime(s.startedAt)}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {formatDateTime(s.endedAt)}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {s.endedBy ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
