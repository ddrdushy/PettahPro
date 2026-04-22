import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { AuditKindBucket, AuditLogListResponse } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { AuditLogClient } from "./audit-log-client";

export const metadata: Metadata = { title: "Audit log" };

// Server component — fetches the initial 30-day window and the distinct
// kinds so the filter dropdown has real data on first paint. Client
// handles filtering, deep-links, and the drawer.
async function fetchInitial(): Promise<
  | { events: AuditLogListResponse; kinds: AuditKindBucket[] }
  | null
> {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [eventsRes, kindsRes] = await Promise.all([
    fetch(`${base}/audit-log`, { headers, cache: "no-store" }),
    fetch(`${base}/audit-log/kinds`, { headers, cache: "no-store" }),
  ]);
  if (!eventsRes.ok || !kindsRes.ok) return null;
  const events = (await eventsRes.json()) as AuditLogListResponse;
  const { kinds } = (await kindsRes.json()) as { kinds: AuditKindBucket[] };
  return { events, kinds };
}

export default async function AuditLogPage() {
  const data = await fetchInitial();

  if (!data) {
    return (
      <main className="container-p py-10">
        <PageHeader eyebrow="Admin" title="Audit log" description="Couldn't load audit events." />
      </main>
    );
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Admin"
        title="Audit log"
        description="Immutable record of governance-sensitive actions — logins, postings, voids, write-offs, period locks, employee exits. Append-only: nothing in this list can be edited or deleted once it lands."
      />
      <AuditLogClient initial={data.events} kinds={data.kinds} />
    </main>
  );
}
