import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { CalendarDays, Plus } from "lucide-react";
import type { LeaveRequestListRow, LeaveRequestStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Leave requests" };

const statusStyles: Record<LeaveRequestStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  pending: "bg-warning-bg text-warning",
  approved: "bg-mint text-mint-dark",
  rejected: "bg-danger-bg/60 text-danger",
  cancelled: "bg-surface-recessed text-text-secondary",
};

const statusLabels: Record<LeaveRequestStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

async function fetchRequests(status?: string): Promise<LeaveRequestListRow[]> {
  const qs = status ? `?status=${status}` : "";
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/leave-requests${qs}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { leaveRequests: LeaveRequestListRow[] };
  return data.leaveRequests;
}

export default async function LeaveRequestsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const rows = await fetchRequests(searchParams.status);

  const filters: Array<{ key: string; label: string }> = [
    { key: "", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "draft", label: "Drafts" },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Leave requests"
        description="Apply for leave, approve pending requests, and track who's out when."
        action={
          <Link href="/app/leave-requests/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New request
          </Link>
        }
      />

      <div className="mt-6 flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = (searchParams.status ?? "") === f.key;
          const href = f.key ? `/app/leave-requests?status=${f.key}` : "/app/leave-requests";
          return (
            <Link
              key={f.key}
              href={href}
              className={`rounded-full border-hairline px-3 py-1 text-small transition ${
                active
                  ? "border-charcoal bg-charcoal text-offwhite"
                  : "border-border bg-surface-elevated text-text-secondary hover:border-charcoal hover:text-charcoal"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <CalendarDays className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No leave requests match this filter.</p>
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="w-24 px-4 py-3 text-left">Type</th>
                <th className="w-28 px-4 py-3 text-left">From</th>
                <th className="w-28 px-4 py-3 text-left">To</th>
                <th className="w-20 px-4 py-3 text-right">Days</th>
                <th className="w-28 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-surface-recessed/40">
                  <td className="px-4 py-3">
                    <Link href={`/app/leave-requests/${r.id}`} className="text-charcoal underline-offset-4 hover:underline">
                      {r.employeeName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{r.leaveTypeCode}</td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(r.fromDate)}</td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(r.toDate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">{Number(r.daysCount)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[r.status]}`}>
                      {statusLabels[r.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
