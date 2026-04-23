"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Filter, ChevronDown, ArrowRight, ShieldCheck } from "lucide-react";
import { api, type AuditEvent, type AuditKindBucket, type AuditLogListResponse } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Drawer } from "@/components/app/drawer";

// Human labels for known kinds. Anything unknown falls back to the raw
// string — new event kinds show up un-prettified until we add them here.
const KIND_LABEL: Record<string, string> = {
  "user.login": "Login",
  "user.logout": "Logout",
  "journal.post": "Journal posted",
  "journal.void": "Journal voided",
  "journal.approve": "Journal approved",
  "journal.reject": "Journal rejected",
  "approval.decide": "Approval decided",
  "approval.cancel": "Approval withdrawn",
  "period.close": "Period soft-closed",
  "period.reopen": "Period reopened",
  "period.close_year": "Year-end closed",
  "invoice.void": "Invoice voided",
  "bill.void": "Bill voided",
  "payment.void": "Payment voided",
  "supplier_payment.void": "Supplier payment voided",
  "bad_debt.writeoff": "Bad debt write-off",
  "bad_debt.reverse": "Bad debt reversed",
  "customer.credit_hold": "Customer credit hold",
  "customer.credit_release": "Customer credit released",
  "employee.exit": "Employee exit",
  "employee.confirm_probation": "Probation confirmed",
  "salary_revision.create": "Salary revised",
  "payroll.post": "Payroll posted",
  "payroll.void": "Payroll voided",
  "settings.update": "Settings updated",
  "number_series.update": "Number series updated",
};

// Maps refType → deep-link base path. Used to render a "View source" link
// in the drawer so reviewers can jump straight to the affected doc.
const REF_ROUTES: Record<string, (id: string) => string> = {
  journal_entry: (id) => `/app/journals/${id}`,
  invoice: (id) => `/app/invoices/${id}`,
  bill: (id) => `/app/bills/${id}`,
  employee: (id) => `/app/employees/${id}`,
  customer: (id) => `/app/customers/${id}`,
  period: () => `/app/accounting/periods`,
};

function kindLabel(k: string): string {
  return KIND_LABEL[k] ?? k;
}

function categoryOf(kind: string): string {
  const [head] = kind.split(".");
  return head ?? "other";
}

const CATEGORY_CLASS: Record<string, string> = {
  user: "bg-mint-surface/60 text-mint-dark border-mint/40",
  journal: "bg-blue-50 text-blue-800 border-blue-200",
  period: "bg-amber-50 text-amber-800 border-amber-200",
  invoice: "bg-red-50 text-red-800 border-red-200",
  bill: "bg-red-50 text-red-800 border-red-200",
  payment: "bg-red-50 text-red-800 border-red-200",
  supplier_payment: "bg-red-50 text-red-800 border-red-200",
  bad_debt: "bg-purple-50 text-purple-800 border-purple-200",
  customer: "bg-surface-recessed text-text-tertiary border-border",
  employee: "bg-surface-recessed text-text-tertiary border-border",
  salary_revision: "bg-surface-recessed text-text-tertiary border-border",
  payroll: "bg-surface-recessed text-text-tertiary border-border",
  settings: "bg-surface-recessed text-text-tertiary border-border",
  number_series: "bg-surface-recessed text-text-tertiary border-border",
};

function categoryClass(kind: string): string {
  return CATEGORY_CLASS[categoryOf(kind)] ?? "bg-surface-recessed text-text-tertiary border-border";
}

interface Filters {
  from: string;
  to: string;
  kind: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function AuditLogClient({
  initial,
  kinds,
}: {
  initial: AuditLogListResponse;
  kinds: AuditKindBucket[];
}) {
  const [filters, setFilters] = useState<Filters>({
    from: initial.filters.from,
    to: initial.filters.to,
    kind: initial.filters.kind ?? "",
  });
  const [events, setEvents] = useState<AuditEvent[]>(initial.events);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  // Load when filters change. Debounced via effect — cheap enough; users
  // typically tweak 1-2 inputs and stop.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listAuditEvents({
        from: filters.from,
        to: filters.to,
        kind: filters.kind || undefined,
        limit: 200,
      })
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message ?? "Failed to load events");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters.from, filters.to, filters.kind]);

  const grouped = useMemo(() => {
    const map = new Map<string, AuditEvent[]>();
    for (const ev of events) {
      const day = ev.createdAt.slice(0, 10);
      const list = map.get(day) ?? [];
      list.push(ev);
      map.set(day, list);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [events]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border-hairline border-border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-micro uppercase tracking-wide text-text-tertiary">
              From
            </label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              className="mt-1 rounded-md border-hairline border-border px-3 py-1.5 text-body"
            />
          </div>
          <div>
            <label className="block text-micro uppercase tracking-wide text-text-tertiary">
              To
            </label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              className="mt-1 rounded-md border-hairline border-border px-3 py-1.5 text-body"
            />
          </div>
          <div className="relative">
            <label className="block text-micro uppercase tracking-wide text-text-tertiary">
              Event kind
            </label>
            <div className="relative mt-1">
              <select
                value={filters.kind}
                onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))}
                className="appearance-none rounded-md border-hairline border-border bg-white px-3 py-1.5 pr-8 text-body"
              >
                <option value="">All kinds</option>
                {kinds.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {kindLabel(k.kind)} ({k.count})
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFilters({ from: daysAgo(7), to: today(), kind: filters.kind })}
              className="rounded-md border-hairline border-border px-3 py-1.5 text-small text-text-secondary hover:bg-mint-surface"
            >
              Last 7 days
            </button>
            <button
              type="button"
              onClick={() => setFilters({ from: daysAgo(30), to: today(), kind: filters.kind })}
              className="rounded-md border-hairline border-border px-3 py-1.5 text-small text-text-secondary hover:bg-mint-surface"
            >
              Last 30 days
            </button>
            <button
              type="button"
              onClick={() => setFilters({ from: daysAgo(90), to: today(), kind: filters.kind })}
              className="rounded-md border-hairline border-border px-3 py-1.5 text-small text-text-secondary hover:bg-mint-surface"
            >
              Last 90 days
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-small text-text-secondary">
          <Filter className="h-4 w-4" />
          {loading ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </span>
          ) : (
            <span>
              {events.length} event{events.length === 1 ? "" : "s"} · {filters.from} → {filters.to}
            </span>
          )}
        </div>
        {error && (
          <p className="mt-2 text-small text-red-800" role="alert">
            {error}
          </p>
        )}
      </section>

      {grouped.length === 0 && !loading ? (
        <div className="rounded-xl border-hairline border-border bg-white p-10 text-center">
          <ShieldCheck className="mx-auto h-6 w-6 text-text-tertiary" />
          <p className="mt-2 text-body text-text-secondary">
            Nothing in this window. Try widening the date range or clearing filters.
          </p>
        </div>
      ) : (
        grouped.map(([day, rows]) => (
          <section key={day} className="rounded-xl border-hairline border-border bg-white shadow-sm">
            <header className="flex items-center justify-between border-b-hairline border-border px-5 py-3">
              <h3 className="text-small font-medium text-charcoal">{formatDate(day)}</h3>
              <span className="text-micro text-text-tertiary">
                {rows.length} event{rows.length === 1 ? "" : "s"}
              </span>
            </header>
            <ul className="divide-y-hairline divide-border">
              {rows.map((ev) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(ev)}
                    className="flex w-full items-start gap-4 px-5 py-3 text-left transition-colors hover:bg-mint-surface/40"
                  >
                    <span
                      className={`mt-0.5 rounded-md border-hairline px-2 py-0.5 text-micro font-medium ${categoryClass(ev.kind)}`}
                    >
                      {kindLabel(ev.kind)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body text-charcoal">{ev.summary}</p>
                      <p className="mt-0.5 text-micro text-text-tertiary">
                        {ev.actorName ?? ev.actorEmail ?? "System"}
                        {" · "}
                        {new Date(ev.createdAt).toLocaleTimeString()}
                        {ev.ipAddress ? ` · ${ev.ipAddress}` : ""}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-text-tertiary" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? kindLabel(selected.kind) : ""}
        description={selected?.summary}
      >
        {selected && <AuditDetail event={selected} />}
      </Drawer>
    </div>
  );
}

function AuditDetail({ event }: { event: AuditEvent }) {
  const deepLink = event.refType && event.refId ? REF_ROUTES[event.refType]?.(event.refId) : null;

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-small">
        <dt className="text-text-tertiary">When</dt>
        <dd className="col-span-2 text-charcoal">{new Date(event.createdAt).toLocaleString()}</dd>

        <dt className="text-text-tertiary">Actor</dt>
        <dd className="col-span-2 text-charcoal">
          {event.actorName ? (
            <span>
              {event.actorName}
              {event.actorEmail ? ` · ${event.actorEmail}` : ""}
            </span>
          ) : event.actorEmail ? (
            event.actorEmail
          ) : (
            <span className="text-text-tertiary">System / unattributed</span>
          )}
        </dd>

        <dt className="text-text-tertiary">Kind</dt>
        <dd className="col-span-2 font-mono text-charcoal">{event.kind}</dd>

        {event.refType && (
          <>
            <dt className="text-text-tertiary">Target</dt>
            <dd className="col-span-2 text-charcoal">
              <span className="font-mono text-text-secondary">{event.refType}</span>
              {deepLink ? (
                <>
                  {" · "}
                  <Link href={deepLink} className="text-mint-dark underline-offset-2 hover:underline">
                    View source →
                  </Link>
                </>
              ) : null}
            </dd>
          </>
        )}

        {event.ipAddress && (
          <>
            <dt className="text-text-tertiary">IP</dt>
            <dd className="col-span-2 font-mono text-charcoal">{event.ipAddress}</dd>
          </>
        )}
        {event.userAgent && (
          <>
            <dt className="text-text-tertiary">User agent</dt>
            <dd className="col-span-2 text-small text-text-secondary break-words">
              {event.userAgent}
            </dd>
          </>
        )}
      </dl>

      {event.diff ? (
        <section>
          <h4 className="text-micro uppercase tracking-wide text-text-tertiary">Details</h4>
          <pre className="mt-2 overflow-auto rounded-md bg-surface-recessed p-3 text-micro font-mono text-charcoal">
{JSON.stringify(event.diff, null, 2)}
          </pre>
        </section>
      ) : (
        <p className="text-small text-text-tertiary">No structured payload recorded for this event.</p>
      )}
    </div>
  );
}
