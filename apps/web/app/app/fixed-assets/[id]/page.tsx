import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type {
  FixedAssetRow,
  FixedAssetDepreciationEntry,
  FixedAssetCategory,
  FixedAssetStatus,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Fixed asset" };

const categoryLabels: Record<FixedAssetCategory, string> = {
  vehicle: "Vehicle",
  equipment: "Equipment",
  furniture: "Furniture",
  building: "Building",
  it_hardware: "IT hardware",
  software: "Software",
  land: "Land",
  other: "Other",
};

const statusStyles: Record<FixedAssetStatus, string> = {
  active: "bg-mint-surface text-mint-dark",
  disposed: "bg-surface-recessed text-text-secondary",
  written_off: "bg-danger-bg/60 text-danger",
};

const statusLabels: Record<FixedAssetStatus, string> = {
  active: "Active",
  disposed: "Disposed",
  written_off: "Written off",
};

async function fetchAsset(id: string): Promise<{ asset: FixedAssetRow; history: FixedAssetDepreciationEntry[] } | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/fixed-assets/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export default async function FixedAssetDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchAsset(params.id);
  if (!data) notFound();
  const { asset, history } = data;

  const depreciable = asset.costCents - asset.salvageCents;
  const progressPct = depreciable > 0 ? (asset.accumulatedDepreciationCents / depreciable) * 100 : 0;
  const monthsDepreciated = history.length;
  const monthsRemaining = Math.max(0, asset.usefulLifeMonths - monthsDepreciated);

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/fixed-assets" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to fixed assets
        </Link>
      </div>

      <PageHeader
        eyebrow={`Fixed asset · ${categoryLabels[asset.category]}`}
        title={asset.name}
        description={`${asset.code ? asset.code + " · " : ""}Acquired ${formatDate(asset.acquisitionDate)} · ${asset.usefulLifeMonths}-month life`}
        action={
          <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[asset.status]}`}>
            {statusLabels[asset.status]}
          </span>
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        <StatCard label="Cost" value={formatLKR(asset.costCents)} sub={`Salvage ${formatLKR(asset.salvageCents)}`} />
        <StatCard label="Accumulated" value={formatLKR(asset.accumulatedDepreciationCents)} sub={`${monthsDepreciated} of ${asset.usefulLifeMonths} months`} />
        <StatCard label="Net book value" value={formatLKR(asset.netBookValueCents)} sub="On the balance sheet today" emphasis />
        <StatCard label="Monthly charge" value={formatLKR(Math.round(depreciable / Math.max(1, asset.usefulLifeMonths)))} sub={`${monthsRemaining} months remaining`} />
      </section>

      <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Depreciation progress</p>
          <p className="tabular-nums text-small text-text-secondary">{progressPct.toFixed(1)}%</p>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-recessed">
          <div
            className="h-full rounded-full bg-mint"
            style={{ width: `${Math.min(100, progressPct)}%`, transition: "width 0.6s ease-out" }}
          />
        </div>
        <p className="mt-2 text-caption text-text-tertiary">
          Depreciable base {formatLKR(depreciable)} · started {formatDate(asset.depreciationStartDate)}
          {asset.lastDepreciationRunDate && <> · last run {formatDate(asset.lastDepreciationRunDate)}</>}
        </p>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-h3 text-charcoal">Depreciation history</h2>
          <span className="text-small text-text-secondary">{history.length} {history.length === 1 ? "entry" : "entries"}</span>
        </div>
        {history.length === 0 ? (
          <div className="rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
            <p className="text-body text-text-secondary">No depreciation posted yet.</p>
            <p className="mt-1 text-caption text-text-tertiary">Run depreciation from the fixed assets list to start the schedule.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <table className="w-full text-small">
              <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="w-28 px-4 py-3 text-left">Period</th>
                  <th className="w-28 px-4 py-3 text-left">Run date</th>
                  <th className="w-36 px-4 py-3 text-left">Journal</th>
                  <th className="w-36 px-4 py-3 text-right">Depreciation</th>
                  <th className="w-36 px-4 py-3 text-right">Accumulated after</th>
                </tr>
              </thead>
              <tbody className="divide-y-hairline divide-border">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      {h.periodYear}-{String(h.periodMonth).padStart(2, "0")}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(h.runDate)}</td>
                    <td className="px-4 py-3">
                      {h.journalEntryId ? (
                        <Link href={`/app/journals/${h.journalEntryId}`} className="btn-link text-small">
                          View GL
                        </Link>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatLKR(h.depreciationCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(h.accumulatedAfterCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {asset.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{asset.notes}</p>
        </section>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border-hairline p-5 ${
        emphasis ? "border-charcoal/20 bg-mint-surface/40" : "border-border bg-surface-elevated"
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-2 text-h3 text-charcoal">{value}</p>
      <p className="mt-1 text-caption text-text-secondary">{sub}</p>
    </div>
  );
}
