import { formatLKR } from "@/lib/format";
import type { PartyAgingBucket, PartyKpis } from "@/lib/api";

export function PartyKpiStrip({
  kpis,
  side,
}: {
  kpis: PartyKpis;
  side: "receivable" | "payable";
}) {
  return (
    <section className="grid gap-4 sm:grid-cols-4">
      <Kpi
        label={side === "receivable" ? "Total billed" : "Total received"}
        value={formatLKR(kpis.totalBilledCents)}
      />
      <Kpi
        label={side === "receivable" ? "Paid to date" : "Paid out"}
        value={formatLKR(kpis.totalPaidCents)}
      />
      <Kpi
        label={side === "receivable" ? "Balance owed" : "Balance due"}
        value={formatLKR(kpis.balanceDueCents)}
        sub={`${kpis.openCount} open ${kpis.openCount === 1 ? "doc" : "docs"}`}
        tone="mint"
      />
      <Kpi
        label="Overdue"
        value={formatLKR(kpis.overdueCents)}
        sub={`${kpis.overdueCount} ${kpis.overdueCount === 1 ? "document" : "documents"}`}
        tone={kpis.overdueCount > 0 ? "warning" : undefined}
      />
    </section>
  );
}

export function AgingBars({
  aging,
  totalCents,
}: {
  aging: PartyAgingBucket[];
  totalCents: number;
}) {
  if (totalCents === 0) {
    return (
      <div className="rounded-card border-hairline border-border bg-surface-elevated p-6 text-center text-small text-text-secondary">
        No outstanding balance.
      </div>
    );
  }
  return (
    <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
      <div className="flex items-center justify-between">
        <p className="text-caption uppercase tracking-wide text-text-tertiary">Aging breakdown</p>
        <span className="tabular-nums text-small font-medium text-charcoal">
          {formatLKR(totalCents)}
        </span>
      </div>
      <ul className="mt-5 space-y-3">
        {aging.map((b) => {
          const pct = totalCents > 0 ? (b.balanceCents / totalCents) * 100 : 0;
          const overdue = b.label !== "current";
          return (
            <li key={b.label}>
              <div className="flex items-baseline justify-between text-small">
                <span className="text-text-primary">{labelFor(b.label)}</span>
                <span className="tabular-nums text-text-secondary">
                  {formatLKR(b.balanceCents)}
                  {b.invoiceCount > 0 && (
                    <span className="ml-2 text-caption text-text-tertiary">
                      {b.invoiceCount}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-recessed">
                <div
                  className={`h-full rounded-full ${overdue ? "bg-warning-accent" : "bg-mint"}`}
                  style={{ width: `${pct}%`, transition: "width 0.6s ease-out" }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "mint" | "warning";
}) {
  const dot =
    tone === "mint"
      ? "bg-mint"
      : tone === "warning"
        ? "bg-warning-accent"
        : "bg-text-tertiary";
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
      <div className="flex items-center justify-between">
        <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      </div>
      <p className="tabular-nums mt-2 text-h2 text-charcoal">{value}</p>
      {sub && <p className="mt-1 text-caption text-text-secondary">{sub}</p>}
    </div>
  );
}

function labelFor(b: PartyAgingBucket["label"]) {
  if (b === "current") return "Current (not yet due)";
  if (b === "0-30") return "1-30 days overdue";
  if (b === "30-60") return "31-60 days overdue";
  if (b === "60-90") return "61-90 days overdue";
  return "90+ days overdue";
}
