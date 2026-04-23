"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import {
  api,
  ApiError,
  type DepreciationMethod,
  type FixedAssetCategory,
  type FixedAssetDepreciationEntry,
  type FixedAssetRow,
  type FixedAssetStatus,
  type FixedAssetTaxDepreciationEntry,
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

const methodLabels: Record<DepreciationMethod, string> = {
  straight_line: "SLM",
  wdv: "WDV",
  sum_of_years_digits: "SOYD",
};

export function FixedAssetDetailClient({
  asset: initialAsset,
  history,
  taxHistory,
}: {
  asset: FixedAssetRow;
  history: FixedAssetDepreciationEntry[];
  taxHistory: FixedAssetTaxDepreciationEntry[];
}) {
  const router = useRouter();
  const [asset, setAsset] = useState(initialAsset);
  const [tab, setTab] = useState<"book" | "tax">("book");
  const [editing, setEditing] = useState(false);

  const depreciable = asset.costCents - asset.salvageCents;
  const bookProgressPct = depreciable > 0 ? (asset.accumulatedDepreciationCents / depreciable) * 100 : 0;
  const taxDepreciable = asset.costCents - asset.taxSalvageCents;
  const taxProgressPct = taxDepreciable > 0 ? (asset.taxAccumulatedDepreciationCents / taxDepreciable) * 100 : 0;

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
        description={`${asset.code ? asset.code + " · " : ""}Acquired ${formatDate(asset.acquisitionDate)} · Book ${methodLabels[asset.depreciationMethod]} ${asset.usefulLifeMonths} mo · Tax ${methodLabels[asset.taxDepreciationMethod]} ${asset.taxUsefulLifeMonths} mo`}
        action={
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[asset.status]}`}>
              {statusLabels[asset.status]}
            </span>
            <button type="button" onClick={() => setEditing(true)} className="btn-secondary">
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit tax schedule
            </button>
          </div>
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        <StatCard label="Cost" value={formatLKR(asset.costCents)} sub={`Salvage ${formatLKR(asset.salvageCents)}`} />
        <StatCard
          label="Book NBV"
          value={formatLKR(asset.netBookValueCents)}
          sub={`Accumulated ${formatLKR(asset.accumulatedDepreciationCents)}`}
          emphasis
        />
        <StatCard
          label="Tax NBV"
          value={formatLKR(asset.taxNetBookValueCents)}
          sub={`Accumulated ${formatLKR(asset.taxAccumulatedDepreciationCents)}`}
          emphasis
        />
        <StatCard
          label="Book ↔ tax gap"
          value={formatLKR(asset.netBookValueCents - asset.taxNetBookValueCents)}
          sub={
            asset.netBookValueCents > asset.taxNetBookValueCents
              ? "Tax depreciated faster"
              : asset.netBookValueCents < asset.taxNetBookValueCents
                ? "Book depreciated faster"
                : "Schedules match"
          }
        />
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-2">
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Book depreciation</p>
          <p className="mt-2 tabular-nums text-small text-text-secondary">
            {bookProgressPct.toFixed(1)}% · {history.length} of {asset.usefulLifeMonths} months
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-recessed">
            <div
              className="h-full rounded-full bg-mint"
              style={{ width: `${Math.min(100, bookProgressPct)}%`, transition: "width 0.6s ease-out" }}
            />
          </div>
          <p className="mt-2 text-caption text-text-tertiary">
            {methodLabels[asset.depreciationMethod]} · started {formatDate(asset.depreciationStartDate)}
            {asset.lastDepreciationRunDate && <> · last run {formatDate(asset.lastDepreciationRunDate)}</>}
          </p>
        </div>
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Tax depreciation (memo)</p>
          <p className="mt-2 tabular-nums text-small text-text-secondary">
            {taxProgressPct.toFixed(1)}% · {taxHistory.length} of {asset.taxUsefulLifeMonths} months
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-recessed">
            <div
              className="h-full rounded-full bg-charcoal/60"
              style={{ width: `${Math.min(100, taxProgressPct)}%`, transition: "width 0.6s ease-out" }}
            />
          </div>
          <p className="mt-2 text-caption text-text-tertiary">
            {methodLabels[asset.taxDepreciationMethod]}
            {asset.taxDepreciationMethod === "wdv" && asset.taxAnnualRateBps != null && (
              <> @ {(asset.taxAnnualRateBps / 100).toFixed(2)}%</>
            )}
            · started {formatDate(asset.taxDepreciationStartDate)}
            {asset.taxLastDepreciationRunDate && <> · last run {formatDate(asset.taxLastDepreciationRunDate)}</>}
          </p>
        </div>
      </section>

      <section className="mt-6">
        <div role="tablist" className="mb-3 flex gap-2">
          <TabButton active={tab === "book"} onClick={() => setTab("book")}>
            Book history ({history.length})
          </TabButton>
          <TabButton active={tab === "tax"} onClick={() => setTab("tax")}>
            Tax history ({taxHistory.length})
          </TabButton>
        </div>
        {tab === "book" ? (
          <HistoryTable rows={history} showJournal />
        ) : (
          <HistoryTable rows={taxHistory} showJournal={false} />
        )}
      </section>

      {asset.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-text-primary">{asset.notes}</p>
        </section>
      )}

      {editing && (
        <EditModal
          asset={asset}
          onClose={() => setEditing(false)}
          onSaved={(a) => {
            setAsset(a);
            setEditing(false);
            router.refresh();
          }}
        />
      )}
    </main>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-small transition-colors ${
        active ? "bg-charcoal text-white" : "bg-surface-recessed text-text-secondary hover:bg-surface-recessed/60"
      }`}
    >
      {children}
    </button>
  );
}

type AnyHistoryRow = {
  id: string;
  runDate: string;
  periodYear: number;
  periodMonth: number;
  depreciationCents: number;
  accumulatedAfterCents: number;
  journalEntryId?: string | null;
};

function HistoryTable({ rows, showJournal }: { rows: AnyHistoryRow[]; showJournal: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
        <p className="text-body text-text-secondary">No depreciation posted yet.</p>
        <p className="mt-1 text-caption text-text-tertiary">
          Run depreciation from the fixed assets list to start the schedule.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
      <table className="w-full text-small">
        <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="w-28 px-4 py-3 text-left">Period</th>
            <th className="w-28 px-4 py-3 text-left">Run date</th>
            {showJournal && <th className="w-36 px-4 py-3 text-left">Journal</th>}
            <th className="w-36 px-4 py-3 text-right">Depreciation</th>
            <th className="w-36 px-4 py-3 text-right">Accumulated after</th>
          </tr>
        </thead>
        <tbody className="divide-y-hairline divide-border">
          {rows.map((h) => (
            <tr key={h.id}>
              <td className="px-4 py-3 tabular-nums text-text-secondary">
                {h.periodYear}-{String(h.periodMonth).padStart(2, "0")}
              </td>
              <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(h.runDate)}</td>
              {showJournal && (
                <td className="px-4 py-3">
                  {h.journalEntryId ? (
                    <Link href={`/app/journals/${h.journalEntryId}`} className="btn-link text-small">
                      View GL
                    </Link>
                  ) : (
                    <span className="text-text-tertiary">—</span>
                  )}
                </td>
              )}
              <td className="px-4 py-3 text-right tabular-nums">{formatLKR(h.depreciationCents)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(h.accumulatedAfterCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function EditModal({
  asset,
  onClose,
  onSaved,
}: {
  asset: FixedAssetRow;
  onClose: () => void;
  onSaved: (a: FixedAssetRow) => void;
}) {
  const [method, setMethod] = useState<DepreciationMethod>(asset.taxDepreciationMethod);
  const [life, setLife] = useState(String(asset.taxUsefulLifeMonths));
  const [salvage, setSalvage] = useState((asset.taxSalvageCents / 100).toFixed(2));
  const [ratePct, setRatePct] = useState(
    asset.taxAnnualRateBps != null ? (asset.taxAnnualRateBps / 100).toFixed(2) : "",
  );
  const [startDate, setStartDate] = useState(asset.taxDepreciationStartDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const lifeN = Number(life);
    const salvN = Math.round(Number(salvage) * 100);
    const rateN = ratePct.trim() ? Math.round(Number(ratePct) * 100) : null;
    if (!Number.isFinite(lifeN) || lifeN <= 0) {
      setError("Useful life must be positive.");
      return;
    }
    if (!Number.isFinite(salvN) || salvN < 0 || salvN > asset.costCents) {
      setError("Salvage must be between 0 and cost.");
      return;
    }

    setBusy(true);
    try {
      const res = await api.updateFixedAsset(asset.id, {
        taxDepreciationMethod: method,
        taxUsefulLifeMonths: lifeN,
        taxSalvageCents: salvN,
        taxAnnualRateBps: rateN,
        taxDepreciationStartDate: startDate,
      });
      onSaved(res.asset);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-h3 text-charcoal">Edit tax schedule</h2>
        <p className="mt-1 text-small text-text-secondary">
          Tax depreciation is memo-only. Changes apply to future runs; past tax entries stay as posted.
        </p>

        <div className="mt-4 grid gap-3">
          <div>
            <label className="block text-caption uppercase tracking-wide text-text-tertiary">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as DepreciationMethod)} className="input mt-1.5 w-full">
              <option value="straight_line">Straight line (SLM)</option>
              <option value="wdv">Written down value (WDV)</option>
              <option value="sum_of_years_digits">Sum of years' digits</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Useful life (months)</label>
              <input
                type="number"
                min="1"
                max="600"
                value={life}
                onChange={(e) => setLife(e.target.value)}
                className="input mt-1.5 w-full text-right tabular-nums"
              />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Salvage (LKR)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={salvage}
                onChange={(e) => setSalvage(e.target.value)}
                className="input mt-1.5 w-full text-right tabular-nums"
              />
            </div>
          </div>
          {method === "wdv" && (
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Annual rate (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={ratePct}
                onChange={(e) => setRatePct(e.target.value)}
                placeholder="e.g. 20"
                className="input mt-1.5 w-full text-right tabular-nums"
              />
              <p className="mt-1 text-caption text-text-tertiary">
                Leave blank to derive from useful life.
              </p>
            </div>
          )}
          <div>
            <label className="block text-caption uppercase tracking-wide text-text-tertiary">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input mt-1.5 w-full"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-small text-danger">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={save} className="btn-primary" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
