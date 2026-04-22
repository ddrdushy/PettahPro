"use client";

import type { FinalSettlementComputeResult } from "@/lib/api";
import { formatLKR } from "@/lib/format";

/**
 * Gross-to-net worksheet. Renders the compute result (or a saved settlement
 * coerced into compute shape) as a classic earnings / deductions / statutory
 * table. Read-only — editing happens via the `Overrides` editor on the detail
 * page, which re-fetches after PATCH.
 */
export function SettlementWorksheet({
  compute,
}: {
  compute: FinalSettlementComputeResult;
}) {
  const earnings = compute.lines.filter((l) => l.kind === "earning");
  const deductions = compute.lines.filter((l) => l.kind === "deduction");
  const statutory = compute.lines.filter((l) => l.kind === "statutory");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Years of service"
          value={compute.yearsOfService.toFixed(2)}
          hint={`${compute.gratuityYearsCompleted} completed · gratuity ${compute.gratuityYearsCompleted >= 5 ? "eligible" : "not eligible (< 5y)"}`}
        />
        <Stat
          label="Pro-rata days"
          value={`${compute.proRataDaysWorked} / ${compute.proRataDaysInPeriod}`}
          hint="Days worked in settlement month"
        />
        <Stat
          label="Gross"
          value={formatLKR(compute.grossCents)}
          hint="Before deductions"
        />
        <Stat
          label="Net payable"
          value={formatLKR(compute.netPayableCents)}
          hint="After all deductions"
          accent
        />
      </div>

      <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <Section title="Earnings" rows={earnings} tone="earning" />
        <Section title="Deductions" rows={deductions} tone="deduction" />
        <Section title="Statutory" rows={statutory} tone="statutory" />
        <div className="flex items-center justify-between border-t-hairline border-border bg-surface-recessed px-4 py-3">
          <span className="text-small font-semibold text-charcoal">
            Net payable
          </span>
          <span className="font-mono text-h3 font-semibold text-charcoal">
            {formatLKR(compute.netPayableCents)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-card border-hairline p-4 ${
        accent
          ? "border-mint-dark/30 bg-mint-surface/50"
          : "border-border bg-surface-elevated"
      }`}
    >
      <p className="text-caption font-medium uppercase tracking-wider text-text-tertiary">
        {label}
      </p>
      <p className="mt-1 font-mono text-h3 font-semibold text-charcoal">
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-caption text-text-tertiary">{hint}</p>
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: FinalSettlementComputeResult["lines"];
  tone: "earning" | "deduction" | "statutory";
}) {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => sum + r.amountCents, 0);
  const sign = tone === "earning" ? "+" : "−";
  const toneClass =
    tone === "earning"
      ? "text-charcoal"
      : tone === "deduction"
        ? "text-danger"
        : "text-text-secondary";

  return (
    <div className="border-t-hairline border-border first:border-t-0">
      <div className="flex items-center justify-between bg-surface-recessed px-4 py-2">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-text-tertiary">
          {title}
        </h3>
        <span className={`font-mono text-small font-medium ${toneClass}`}>
          {sign} {formatLKR(total)}
        </span>
      </div>
      <ul className="divide-y-hairline divide-border">
        {rows.map((line) => (
          <li
            key={line.code}
            className="flex items-center justify-between px-4 py-2.5"
          >
            <div>
              <p className="text-small text-charcoal">{line.name}</p>
              {line.meta && <MetaLine meta={line.meta} />}
            </div>
            <span className={`font-mono text-small ${toneClass}`}>
              {sign} {formatLKR(line.amountCents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetaLine({ meta }: { meta: Record<string, unknown> }) {
  const parts = Object.entries(meta).map(([k, v]) => `${k}: ${String(v)}`);
  if (parts.length === 0) return null;
  return (
    <p className="mt-0.5 text-caption text-text-tertiary">
      {parts.join(" · ")}
    </p>
  );
}
