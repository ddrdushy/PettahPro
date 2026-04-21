import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { CheckCircle2, Clock, FileClock, AlertTriangle } from "lucide-react";
import type { ThreeWayMatchReport, ThreeWayMatchStatus, ThreeWayMatchFilter } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "3-way match" };

async function fetchReport(params: URLSearchParams): Promise<ThreeWayMatchReport | null> {
  const qs = params.toString();
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/reports/three-way-match${qs ? `?${qs}` : ""}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as ThreeWayMatchReport;
}

const STATUS_LABEL: Record<ThreeWayMatchStatus, string> = {
  ok: "Matched",
  awaiting_grn: "Awaiting receipt",
  awaiting_bill: "Awaiting bill",
  under_received: "Under-received",
  over_received: "Over-received",
  bill_mismatch: "Bill mismatch",
};

const STATUS_CLASS: Record<ThreeWayMatchStatus, string> = {
  ok: "bg-mint-surface/60 text-mint-dark border-mint/40",
  awaiting_grn: "bg-surface-recessed text-text-secondary border-border",
  awaiting_bill: "bg-amber-50 text-amber-800 border-amber-200",
  under_received: "bg-danger-bg/60 text-danger border-danger/40",
  over_received: "bg-danger-bg/60 text-danger border-danger/40",
  bill_mismatch: "bg-danger-bg/60 text-danger border-danger/40",
};

function StatusPill({ status }: { status: ThreeWayMatchStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border-hairline px-2 py-0.5 text-caption font-medium ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const TABS: Array<{ key: ThreeWayMatchFilter | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "variance", label: "Variance" },
  { key: "bill_mismatch", label: "Bill mismatch" },
  { key: "under_received", label: "Under-received" },
  { key: "over_received", label: "Over-received" },
  { key: "awaiting_bill", label: "Awaiting bill" },
  { key: "awaiting_grn", label: "Awaiting receipt" },
  { key: "ok", label: "Matched" },
];

function formatQty(n: number) {
  return n.toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export default async function ThreeWayMatchPage({
  searchParams,
}: {
  searchParams: { status?: string; from?: string; to?: string };
}) {
  const params = new URLSearchParams();
  if (searchParams.status && searchParams.status !== "all") params.set("status", searchParams.status);
  if (searchParams.from) params.set("from", searchParams.from);
  if (searchParams.to) params.set("to", searchParams.to);

  const data = await fetchReport(params);

  if (!data) {
    return (
      <main className="container-p py-10">
        <PageHeader eyebrow="Reports" title="3-way match" description="Couldn't load the reconciliation report." />
      </main>
    );
  }

  const activeTab = (searchParams.status ?? "all") as ThreeWayMatchFilter | "all";

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Reports"
        title="3-way match"
        description="Reconcile each purchase order line against what was received (GRN) and what was billed. Variance means someone owes an explanation."
      />

      <form className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="from" className="block text-caption uppercase tracking-wide text-text-tertiary">From (order date)</label>
          <input id="from" name="from" type="date" defaultValue={searchParams.from ?? ""} className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="to" className="block text-caption uppercase tracking-wide text-text-tertiary">To (order date)</label>
          <input id="to" name="to" type="date" defaultValue={searchParams.to ?? ""} className="input mt-1.5" />
        </div>
        {activeTab !== "all" && <input type="hidden" name="status" value={activeTab} />}
        <button type="submit" className="btn-secondary text-small">Apply</button>
        {(searchParams.from || searchParams.to) && (
          <a href={`/app/reports/three-way-match${activeTab !== "all" ? `?status=${activeTab}` : ""}`} className="btn-link text-small">
            Clear dates
          </a>
        )}
      </form>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={<CheckCircle2 className="h-4 w-4" />} label="Matched" value={data.summary.ok} total={data.summary.total} tone="mint" />
        <SummaryCard icon={<Clock className="h-4 w-4" />} label="Awaiting receipt" value={data.summary.awaitingGrn} total={data.summary.total} tone="neutral" />
        <SummaryCard icon={<FileClock className="h-4 w-4" />} label="Awaiting bill" value={data.summary.awaitingBill} total={data.summary.total} tone="amber" />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Variance"
          value={data.summary.underReceived + data.summary.overReceived + data.summary.billMismatch}
          total={data.summary.total}
          tone="danger"
        />
      </section>

      <nav className="mt-6 flex flex-wrap gap-1 border-b-hairline border-border">
        {TABS.map((t) => {
          const isActive = activeTab === t.key;
          const tabParams = new URLSearchParams();
          if (t.key !== "all") tabParams.set("status", t.key);
          if (searchParams.from) tabParams.set("from", searchParams.from);
          if (searchParams.to) tabParams.set("to", searchParams.to);
          const href = `/app/reports/three-way-match${tabParams.toString() ? `?${tabParams.toString()}` : ""}`;
          return (
            <Link
              key={t.key}
              href={href}
              className={`border-b-2 px-3 py-2 text-small ${
                isActive
                  ? "border-charcoal text-charcoal"
                  : "border-transparent text-text-secondary hover:text-charcoal"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {data.purchaseOrders.length === 0 ? (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">No purchase orders match this filter.</p>
        </div>
      ) : (
        <section className="mt-6 space-y-3">
          {data.purchaseOrders.map((po) => (
            <details key={po.poId} className="group overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
              <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 hover:bg-surface-recessed/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/app/purchase-orders/${po.poId}`}
                      className="text-small font-medium text-charcoal underline-offset-4 hover:underline"
                    >
                      {po.poNumber ?? "Draft PO"}
                    </Link>
                    <StatusPill status={po.status} />
                    {po.varianceCount > 0 && (
                      <span className="text-caption text-text-tertiary">
                        {po.varianceCount} of {po.lineCount} {po.varianceCount === 1 ? "line" : "lines"} with variance
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-caption text-text-secondary">
                    {po.supplierName} · {formatDate(po.orderDate)} · {formatLKR(po.totalCents)}
                    {po.convertedBillId && " · bill linked"}
                  </p>
                </div>
              </summary>
              <div className="border-t-hairline border-border">
                <table className="w-full text-small">
                  <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                    <tr>
                      <th className="w-10 px-4 py-2 text-left">#</th>
                      <th className="px-4 py-2 text-left">Description</th>
                      <th className="w-24 px-4 py-2 text-right">Ordered</th>
                      <th className="w-24 px-4 py-2 text-right">Received</th>
                      <th className="w-24 px-4 py-2 text-right">Billed</th>
                      <th className="w-32 px-4 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-hairline divide-border">
                    {po.lines.map((line) => (
                      <tr key={line.lineId}>
                        <td className="px-4 py-2 tabular-nums text-text-tertiary">{line.lineNo}</td>
                        <td className="px-4 py-2 text-charcoal">{line.description}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatQty(line.orderedQty)}</td>
                        <td className={`px-4 py-2 text-right tabular-nums ${line.receivedQty !== line.orderedQty ? "font-medium text-charcoal" : ""}`}>
                          {formatQty(line.receivedQty)}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums ${line.billedQty !== line.receivedQty && po.convertedBillId ? "font-medium text-charcoal" : ""}`}>
                          {formatQty(line.billedQty)}
                        </td>
                        <td className="px-4 py-2"><StatusPill status={line.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </section>
      )}
    </main>
  );
}

function SummaryCard({
  label,
  value,
  total,
  tone,
  icon,
}: {
  label: string;
  value: number;
  total: number;
  tone: "mint" | "amber" | "danger" | "neutral";
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "mint"
      ? "text-mint-dark"
      : tone === "amber"
      ? "text-amber-700"
      : tone === "danger"
      ? "text-danger"
      : "text-text-secondary";
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-4">
      <div className="flex items-center gap-2">
        <span className={toneClass}>{icon}</span>
        <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      </div>
      <p className={`mt-2 text-h3 font-medium tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-caption text-text-tertiary">{pct}% of {total} POs</p>
    </div>
  );
}
