import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type {
  PlatformAuditEntry,
  TenantDetail,
  TenantUser,
} from "@/lib/platform-api";
import { TenantActions } from "@/components/platform/tenant-actions";
import { RevealUsersButton } from "@/components/platform/reveal-users-button";

export const metadata: Metadata = {
  title: "Tenant · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchMe(): Promise<{
  email: string;
  fullName: string;
  role: string;
} | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  const res = await fetch(`${API}/platform/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    user: { email: string; fullName: string; role: string };
  };
  return body.user;
}

async function fetchTenant(id: string): Promise<TenantDetail | null> {
  const cookieHeader = cookies().toString();
  const res = await fetch(`${API}/platform/tenants/${id}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const body = (await res.json()) as { tenant: TenantDetail };
  return body.tenant;
}

async function fetchUsers(id: string): Promise<TenantUser[]> {
  const cookieHeader = cookies().toString();
  const res = await fetch(`${API}/platform/tenants/${id}/users`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { users: TenantUser[] };
  return body.users;
}

async function fetchAudit(id: string): Promise<PlatformAuditEntry[]> {
  const cookieHeader = cookies().toString();
  const res = await fetch(`${API}/platform/tenants/${id}/platform-audit`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { entries: PlatformAuditEntry[] };
  return body.entries;
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

export default async function TenantDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const tenant = await fetchTenant(params.id);
  if (!tenant) notFound();

  const [users, audit] = await Promise.all([fetchUsers(params.id), fetchAudit(params.id)]);
  const isSuspended = tenant.status === "suspended";
  // #56 — role-aware chrome. Super-admin gets suspend/reactivate; support
  // additionally keeps reveal. Billing sees the read-only page.
  const canMutate = me.role === "super_admin";
  const canReveal = me.role === "super_admin" || me.role === "support";

  return (
    <div className="px-6 py-10">
      <div className="flex items-center gap-3 text-caption text-white/50">
        <Link href="/platform" className="hover:text-white">
          Tenants
        </Link>
        <span aria-hidden>›</span>
        <span className="text-white/70">{tenant.slug}</span>
      </div>

      <div className="mt-3 flex items-start justify-between">
        <div>
          <h1 className="text-h1 text-white">{tenant.businessName}</h1>
          <p className="mt-1 text-small text-white/60">
            /{tenant.slug} · {tenant.country} · {tenant.timezone}
          </p>
        </div>
        {canMutate ? (
          <TenantActions
            tenantId={tenant.id}
            businessName={tenant.businessName}
            currentStatus={tenant.status}
          />
        ) : (
          <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-caption text-white/50">
            Read-only for your role
          </span>
        )}
      </div>

      <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
        <Stat label="Status" value={tenant.status} highlight={isSuspended ? "red" : undefined} />
        <Stat label="Users" value={String(tenant.userCount)} />
        <Stat label="Last active" value={formatDateTime(tenant.lastLoginAt)} />
        <Stat label="Created" value={formatDateTime(tenant.createdAt)} />
      </section>

      <section className="mt-10 rounded-card border border-white/10 bg-black/20 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-h3 text-white">Users</h2>
            <p className="mt-1 text-caption text-white/60">
              Anonymous by default. Reveal requires a reason and is audited.
            </p>
          </div>
          {canReveal && <RevealUsersButton tenantId={tenant.id} />}
        </div>

        <div id="tenant-users-list" className="mt-6 overflow-hidden rounded-md border border-white/10">
          <table className="w-full text-small">
            <thead className="bg-black/40 text-caption uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-4 py-2 text-left">User</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Last login</th>
                <th className="px-4 py-2 text-left">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-white/50">
                    No users.
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2 text-white/90">
                    {u.email ?? u.anonymousLabel}
                    {u.fullName && <div className="text-caption text-white/50">{u.fullName}</div>}
                  </td>
                  <td className="px-4 py-2 text-white/70">{u.isOwner ? "Owner" : "User"}</td>
                  <td className="px-4 py-2 text-white/70">{formatDateTime(u.lastLoginAt)}</td>
                  <td className="px-4 py-2 text-white/70">{u.isActive ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 rounded-card border border-white/10 bg-black/20 p-6">
        <h2 className="text-h3 text-white">Platform audit</h2>
        <p className="mt-1 text-caption text-white/60">
          Everything a platform admin has done to this tenant. Most recent first.
        </p>
        <ul className="mt-6 space-y-3">
          {audit.length === 0 && (
            <li className="text-small text-white/50">No platform actions recorded yet.</li>
          )}
          {audit.map((e) => (
            <li
              key={e.id}
              className="rounded-md border border-white/10 bg-black/30 p-4 text-small text-white/80"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-white">{e.summary}</p>
                  {e.reason && (
                    <p className="mt-1 text-caption text-white/60">Reason: {e.reason}</p>
                  )}
                </div>
                <div className="shrink-0 text-right text-caption text-white/50">
                  <div>{formatDateTime(e.createdAt)}</div>
                  <div>{e.platformUserEmail}</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "red";
}) {
  return (
    <div className="rounded-card border border-white/10 bg-black/20 p-4">
      <p className="text-caption uppercase tracking-wide text-white/50">{label}</p>
      <p
        className={`mt-1 text-body-lg ${
          highlight === "red" ? "text-red-300" : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
