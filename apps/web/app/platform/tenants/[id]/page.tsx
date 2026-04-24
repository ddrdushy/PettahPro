import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type {
  PlatformAuditEntry,
  PlatformPlan,
  PlatformTenantSubscription,
  TenantDetail,
  TenantUser,
} from "@/lib/platform-api";
import { TenantActions } from "@/components/platform/tenant-actions";
import { RevealUsersButton } from "@/components/platform/reveal-users-button";
import { RequestImpersonationButton } from "@/components/platform/request-impersonation-button";
import { TenantNotesEditor } from "@/components/platform/tenant-notes-editor";
import { SubscriptionPanel } from "@/components/platform/subscription-panel";

export const metadata: Metadata = {
  title: "Tenant · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

// #58 — Tabs on the tenant detail. Was a single scrolling page, now a
// three-surface view (+ billing placeholder). Each tab is a distinct
// searchParam so hitting back takes you to the right place and deep
// links land where you expect. We deliberately keep header + stats
// row above the tabs — those identify WHICH tenant you're looking at
// and shouldn't disappear when you switch tab.
type Tab = "overview" | "users" | "audit" | "billing";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "audit", label: "Audit" },
  { key: "billing", label: "Billing" },
];

function asTab(raw: string | undefined): Tab {
  if (raw === "users" || raw === "audit" || raw === "billing") return raw;
  return "overview";
}

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

async function fetchSubscription(
  id: string,
): Promise<PlatformTenantSubscription | null> {
  const cookieHeader = cookies().toString();
  const res = await fetch(`${API}/platform/tenants/${id}/subscription`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    subscription: PlatformTenantSubscription;
  };
  return body.subscription;
}

async function fetchPlans(): Promise<PlatformPlan[]> {
  const cookieHeader = cookies().toString();
  const res = await fetch(`${API}/platform/plans`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { plans: PlatformPlan[] };
  return body.plans;
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

function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case "active":
      return {
        label: "Active",
        cls: "bg-mint/20 text-mint ring-1 ring-inset ring-mint/30",
      };
    case "suspended":
      return {
        label: "Suspended",
        cls: "bg-red-500/20 text-red-300 ring-1 ring-inset ring-red-500/30",
      };
    case "trial":
      return {
        label: "Trial",
        cls: "bg-amber-400/20 text-amber-200 ring-1 ring-inset ring-amber-400/30",
      };
    case "past-due":
      return {
        label: "Past due",
        cls: "bg-orange-500/20 text-orange-200 ring-1 ring-inset ring-orange-500/30",
      };
    case "churned":
      return {
        label: "Churned",
        cls: "bg-white/10 text-white/60 ring-1 ring-inset ring-white/20",
      };
    default:
      return { label: status, cls: "bg-white/10 text-white/70" };
  }
}

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const tenant = await fetchTenant(params.id);
  if (!tenant) notFound();

  const tab = asTab(searchParams.tab);
  const isSuspended = tenant.status === "suspended";
  // #56 — role-aware chrome. Super-admin gets suspend/reactivate; support
  // additionally keeps reveal. Billing sees the read-only page.
  const canMutate = me.role === "super_admin";
  const canReveal = me.role === "super_admin" || me.role === "support";
  // #58 — notes are writable by super_admin + support (matches the
  // PATCH /tenants/:id role gate on the API). Billing sees them but
  // can't edit.
  const canEditNotes = me.role === "super_admin" || me.role === "support";
  const pill = statusPill(tenant.status);

  // Only fetch what the current tab needs. Avoids redundant round
  // trips every page load.
  const users = tab === "users" ? await fetchUsers(params.id) : [];
  const audit = tab === "audit" ? await fetchAudit(params.id) : [];
  // #61 — billing tab needs both the subscription and the plan
  // catalogue (for the change-plan dropdown). Parallel fetch.
  const [subscription, plans] =
    tab === "billing"
      ? await Promise.all([fetchSubscription(params.id), fetchPlans()])
      : [null, [] as PlatformPlan[]];

  return (
    <div className="px-6 py-10">
      <div className="flex items-center gap-3 text-caption text-white/50">
        <Link href="/platform" className="hover:text-white">
          Overview
        </Link>
        <span aria-hidden>›</span>
        <Link href="/platform/tenants" className="hover:text-white">
          Tenants
        </Link>
        <span aria-hidden>›</span>
        <span className="text-white/70">{tenant.slug}</span>
      </div>

      <div className="mt-3 flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-h1 text-white">{tenant.businessName}</h1>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-caption ${pill.cls}`}
            >
              {pill.label}
            </span>
          </div>
          <p className="mt-1 text-small text-white/60">
            /{tenant.slug} · {tenant.country} · {tenant.timezone}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canReveal && !isSuspended && (
            <RequestImpersonationButton
              tenantId={tenant.id}
              businessName={tenant.businessName}
            />
          )}
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
      </div>

      {/* Stats strip — always visible, identifies the tenant no matter
          which tab is open. */}
      <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
        <Stat label="Users" value={String(tenant.userCount)} />
        <Stat label="Last active" value={formatDateTime(tenant.lastLoginAt)} />
        <Stat label="Created" value={formatDateTime(tenant.createdAt)} />
        <Stat label="Updated" value={formatDateTime(tenant.updatedAt)} />
      </section>

      {/* Tabs. Server-rendered anchors so you can right-click → open in
          new tab on any of them. */}
      <nav className="mt-10 border-b border-white/10">
        <ul className="flex gap-1 text-small">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <li key={t.key}>
                <Link
                  href={
                    t.key === "overview"
                      ? `/platform/tenants/${tenant.id}`
                      : `/platform/tenants/${tenant.id}?tab=${t.key}`
                  }
                  className={`inline-block border-b-2 px-4 py-2 transition ${
                    active
                      ? "border-mint text-white"
                      : "border-transparent text-white/60 hover:text-white"
                  }`}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {tab === "overview" && (
        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 rounded-card border border-white/10 bg-black/20 p-6">
            <h2 className="text-h3 text-white">Summary</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-small">
              <dt className="text-white/50">Business name</dt>
              <dd className="text-white/90">{tenant.businessName}</dd>
              <dt className="text-white/50">Slug</dt>
              <dd className="font-mono text-white/90">/{tenant.slug}</dd>
              <dt className="text-white/50">Country</dt>
              <dd className="text-white/90">{tenant.country}</dd>
              <dt className="text-white/50">Timezone</dt>
              <dd className="text-white/90">{tenant.timezone}</dd>
              <dt className="text-white/50">Status</dt>
              <dd>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-caption ${pill.cls}`}
                >
                  {pill.label}
                </span>
              </dd>
              <dt className="text-white/50">Tenant ID</dt>
              <dd className="font-mono text-[0.7rem] text-white/70">
                {tenant.id}
              </dd>
            </dl>
          </div>
          <div className="lg:col-span-2 rounded-card border border-white/10 bg-black/20 p-6">
            <TenantNotesEditor
              tenantId={tenant.id}
              initialNotes={tenant.notes}
              readOnly={!canEditNotes}
            />
          </div>
        </section>
      )}

      {tab === "users" && (
        <section className="mt-6 rounded-card border border-white/10 bg-black/20 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-h3 text-white">Users</h2>
              <p className="mt-1 text-caption text-white/60">
                Anonymous by default. Reveal requires a reason and is audited.
              </p>
            </div>
            {canReveal && <RevealUsersButton tenantId={tenant.id} />}
          </div>

          <div
            id="tenant-users-list"
            className="mt-6 overflow-hidden rounded-md border border-white/10"
          >
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
                    <td
                      colSpan={4}
                      className="px-4 py-6 text-center text-white/50"
                    >
                      No users.
                    </td>
                  </tr>
                )}
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2 text-white/90">
                      {u.email ?? u.anonymousLabel}
                      {u.fullName && (
                        <div className="text-caption text-white/50">
                          {u.fullName}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {u.isOwner ? "Owner" : "User"}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {formatDateTime(u.lastLoginAt)}
                    </td>
                    <td className="px-4 py-2 text-white/70">
                      {u.isActive ? "Yes" : "No"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "audit" && (
        <section className="mt-6 rounded-card border border-white/10 bg-black/20 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-h3 text-white">Platform audit</h2>
              <p className="mt-1 text-caption text-white/60">
                Every action a platform admin has taken on this tenant. Most
                recent first.
              </p>
            </div>
            <Link
              href={`/platform/audit?actor=&kind=`}
              className="text-caption text-white/50 hover:text-white"
            >
              Global audit →
            </Link>
          </div>
          <ul className="mt-6 space-y-3">
            {audit.length === 0 && (
              <li className="text-small text-white/50">
                No platform actions recorded yet.
              </li>
            )}
            {audit.map((e) => (
              <li
                key={e.id}
                className="rounded-md border border-white/10 bg-black/30 p-4 text-small text-white/80"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-white">{e.summary}</p>
                    <p className="mt-1 font-mono text-[0.7rem] text-white/40">
                      {e.kind}
                    </p>
                    {e.reason && (
                      <p className="mt-1 text-caption text-white/60">
                        Reason: {e.reason}
                      </p>
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
      )}

      {tab === "billing" && (
        <section className="mt-6 rounded-card border border-white/10 bg-black/20 p-6">
          <h2 className="text-h3 text-white">Billing</h2>
          <p className="mt-2 text-small text-white/60">
            Plan, subscription state, and trial window for this tenant.
            Invoice + payment history ships with the billing collection PR.
          </p>
          <div className="mt-6">
            {subscription ? (
              <SubscriptionPanel
                tenantId={tenant.id}
                initialSubscription={subscription}
                plans={plans}
                canEdit={canMutate}
              />
            ) : (
              <div className="rounded-md border border-dashed border-white/15 bg-black/30 p-6 text-center">
                <p className="text-small text-white/50">
                  No subscription found for this tenant. Backfill may have
                  skipped it — run the migration again or create the
                  subscription directly.
                </p>
              </div>
            )}
          </div>
        </section>
      )}
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
      <p className="text-caption uppercase tracking-wide text-white/50">
        {label}
      </p>
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
