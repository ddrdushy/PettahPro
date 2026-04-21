"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Box, CheckCircle2, Loader2, Plus, TrendingDown } from "lucide-react";
import {
  api,
  ApiError,
  type FixedAssetRow,
  type FixedAssetCategory,
  type FixedAssetStatus,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

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

export function FixedAssetsClient({
  assets,
  totals,
}: {
  assets: FixedAssetRow[];
  totals: { costCents: number; accumulatedCents: number; netBookValueCents: number; count: number };
}) {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    processed: number;
    totalDepreciationCents: number;
    entryNumber?: string;
    skipped: Array<{ id: string; name: string; reason: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runDepreciation() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await api.runDepreciation(year, month);
      setResult({
        processed: res.processed,
        totalDepreciationCents: res.totalDepreciationCents,
        entryNumber: res.entryNumber,
        skipped: res.skipped,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't run depreciation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Accounting"
        title="Fixed assets"
        description="Vehicles, equipment, buildings, and other long-lived assets. Monthly depreciation runs straight-line across the useful life."
        action={
          <Link href="/app/fixed-assets/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            Register asset
          </Link>
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Total cost" value={formatLKR(totals.costCents)} sub={`${totals.count} ${totals.count === 1 ? "asset" : "assets"}`} />
        <SummaryCard label="Accumulated depreciation" value={formatLKR(totals.accumulatedCents)} sub="Contra-asset on the balance sheet" />
        <SummaryCard label="Net book value" value={formatLKR(totals.netBookValueCents)} sub="Cost − accumulated" emphasis />
      </section>

      <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
        <div className="flex flex-wrap items-end gap-3">
          <TrendingDown className="h-4 w-4 flex-none text-text-tertiary" aria-hidden />
          <div>
            <p className="text-small font-medium text-charcoal">Run monthly depreciation</p>
            <p className="text-caption text-text-tertiary">
              Posts a consolidated JE on the last day of the selected month. Idempotent per (asset, month).
            </p>
          </div>
          <div className="ml-auto flex items-end gap-2">
            <div>
              <label htmlFor="year" className="block text-caption uppercase tracking-wide text-text-tertiary">
                Year
              </label>
              <input
                id="year"
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="mt-1 w-24 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="month" className="block text-caption uppercase tracking-wide text-text-tertiary">
                Month
              </label>
              <select
                id="month"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="mt-1 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {new Date(2000, m - 1, 1).toLocaleDateString("en-GB", { month: "long" })}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={runDepreciation}
              disabled={busy || assets.length === 0}
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              Run
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-small text-danger">{error}</p>}
        {result && (
          <div className="mt-3 rounded-md border-hairline border-mint/40 bg-mint-surface/40 px-4 py-3 text-small">
            <p className="text-charcoal">
              Depreciated {result.processed} {result.processed === 1 ? "asset" : "assets"} · posted{" "}
              <span className="tabular-nums font-medium">{formatLKR(result.totalDepreciationCents)}</span>
              {result.entryNumber && <> as <span className="tabular-nums">{result.entryNumber}</span></>}
            </p>
            {result.skipped.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-caption text-text-secondary">
                  {result.skipped.length} skipped — click for reasons
                </summary>
                <ul className="mt-2 space-y-1">
                  {result.skipped.map((s) => (
                    <li key={s.id} className="text-caption text-text-tertiary">
                      <span className="text-text-secondary">{s.name}</span> · {skippedReasonLabel(s.reason)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      {assets.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <Box className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No fixed assets registered yet.</p>
          <p className="mt-1 text-small text-text-secondary">
            Register a vehicle, a computer, office furniture — anything over LKR 50,000 with a useful life over a year.
          </p>
          <Link href="/app/fixed-assets/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            Register asset
          </Link>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-24 px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="w-28 px-4 py-3 text-left">Category</th>
                <th className="w-28 px-4 py-3 text-left">Acquired</th>
                <th className="w-20 px-4 py-3 text-right">Life (mo)</th>
                <th className="w-32 px-4 py-3 text-right">Cost</th>
                <th className="w-32 px-4 py-3 text-right">Accumulated</th>
                <th className="w-32 px-4 py-3 text-right">NBV</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {assets.map((a) => (
                <tr key={a.id} className="transition-colors hover:bg-surface-recessed/40">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {a.code ?? <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/app/fixed-assets/${a.id}`} className="text-charcoal underline-offset-4 hover:underline">
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{categoryLabels[a.category]}</td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(a.acquisitionDate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{a.usefulLifeMonths}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatLKR(a.costCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {formatLKR(a.accumulatedDepreciationCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(a.netBookValueCents)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[a.status]}`}>
                      {statusLabels[a.status]}
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

function SummaryCard({
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

function skippedReasonLabel(r: string): string {
  const map: Record<string, string> = {
    already_run_for_period: "Already depreciated for this period",
    missing_gl_accounts: "Missing GL accounts — edit the asset to wire them",
    before_start_date: "Depreciation start date is after this period",
    fully_depreciated: "Fully depreciated — nothing left to accumulate",
  };
  return map[r] ?? r;
}
