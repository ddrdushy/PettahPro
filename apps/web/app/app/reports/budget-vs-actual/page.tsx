import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Budget, BudgetVsActualReport } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

export const metadata: Metadata = { title: "Budget vs actual" };

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchReport(params: {
  budgetId?: string;
  fiscalYear?: string;
  from?: string;
  to?: string;
}): Promise<BudgetVsActualReport | { error: string } | null> {
  const qs = new URLSearchParams();
  if (params.budgetId) qs.set("budgetId", params.budgetId);
  if (params.fiscalYear) qs.set("fiscalYear", params.fiscalYear);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const q = qs.toString();
  const res = await fetch(
    `${INTERNAL_API}/reports/budget-vs-actual${q ? `?${q}` : ""}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) {
    return { error: "No matching budget for this period yet." };
  }
  if (!res.ok) return null;
  return (await res.json()) as BudgetVsActualReport;
}

async function fetchBudgets(): Promise<Budget[]> {
  const res = await fetch(`${INTERNAL_API}/budgets`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return ((await res.json()) as { budgets: Budget[] }).budgets;
}

function tone(variance: number, pctConsumed: number | null): string {
  // Variance > 0 = under budget (good for expenses); revenue is sign-
  // flipped already by the income/expense convention on the API side.
  if (variance >= 0) return "text-emerald-700";
  if (pctConsumed != null && pctConsumed > 1.2) return "text-rose-700";
  return "text-amber-700";
}

export default async function BudgetVsActualPage({
  searchParams,
}: {
  searchParams: { budgetId?: string; fiscalYear?: string; from?: string; to?: string };
}) {
  const [report, budgets] = await Promise.all([
    fetchReport(searchParams),
    fetchBudgets(),
  ]);

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/accounting/budgets" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to budgets
        </Link>
      </div>

      <PageHeader
        eyebrow="Reports"
        title="Budget vs actual"
        description="Per-line variance: prorated annual budget vs posted actuals in the chosen window."
      />

      <form className="mt-6 flex flex-wrap items-end gap-3">
        {budgets.length > 0 && (
          <div>
            <label
              htmlFor="budgetId"
              className="block text-caption uppercase tracking-wide text-text-tertiary"
            >
              Budget
            </label>
            <select
              id="budgetId"
              name="budgetId"
              defaultValue={searchParams.budgetId ?? ""}
              className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
            >
              <option value="">— Active for current year —</option>
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} (FY {b.fiscalYear} · {b.status})
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label
            htmlFor="from"
            className="block text-caption uppercase tracking-wide text-text-tertiary"
          >
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={searchParams.from ?? ""}
            className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="to"
            className="block text-caption uppercase tracking-wide text-text-tertiary"
          >
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={searchParams.to ?? ""}
            className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          />
        </div>
        <button type="submit" className="btn-secondary text-small">
          Apply
        </button>
      </form>

      {!report ? (
        <p className="mt-10 text-body text-text-secondary">
          Couldn't load the report. Refresh, or contact support.
        </p>
      ) : "error" in report ? (
        <div className="mt-10 rounded-card border border-amber-300 bg-amber-50/40 p-6">
          <p className="text-body text-text-primary">{report.error}</p>
          <p className="mt-2 text-small text-text-secondary">
            Create an active budget first, then come back here.
          </p>
          <Link
            href="/app/accounting/budgets"
            className="btn-primary mt-4 inline-block text-small"
          >
            Manage budgets
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
            <Stat label="Budget annual" value={formatLKR(report.totals.budgetedAnnualCents)} />
            <Stat
              label={`Budget prorated (${report.period.days}d)`}
              value={formatLKR(report.totals.budgetedProratedCents)}
            />
            <Stat label="Actual" value={formatLKR(report.totals.actualCents)} />
            <Stat
              label="Variance"
              value={formatLKR(report.totals.varianceCents)}
              tone={tone(report.totals.varianceCents, null)}
            />
          </div>

          <p className="mt-3 text-caption text-text-secondary">
            {report.budget.name} · FY {report.budget.fiscalYear} ·{" "}
            {report.period.from} → {report.period.to} (prorate factor{" "}
            {(report.period.days / 365).toFixed(2)})
          </p>

          <div className="mt-6 overflow-hidden rounded-card border border-border-subtle bg-surface">
            <table className="w-full text-small">
              <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-4 py-2 text-left">Account</th>
                  <th className="px-4 py-2 text-left">Cost center</th>
                  <th className="px-4 py-2 text-right">Budget (annual)</th>
                  <th className="px-4 py-2 text-right">Budget (prorated)</th>
                  <th className="px-4 py-2 text-right">Actual</th>
                  <th className="px-4 py-2 text-right">Variance</th>
                  <th className="px-4 py-2 text-right">% used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {report.lines.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-caption text-text-secondary"
                    >
                      This budget has no lines yet.
                    </td>
                  </tr>
                ) : (
                  report.lines.map((l) => (
                    <tr key={`${l.accountId}-${l.costCenterId ?? "all"}`}>
                      <td className="px-4 py-2 text-text-primary">
                        <span className="font-mono text-text-secondary">
                          {l.accountCode}
                        </span>{" "}
                        {l.accountName}
                      </td>
                      <td className="px-4 py-2 text-text-secondary">
                        {l.costCenterCode
                          ? `${l.costCenterCode} — ${l.costCenterName}`
                          : "All centers"}
                      </td>
                      <td className="px-4 py-2 text-right text-text-primary">
                        {formatLKR(l.budgetedAnnualCents)}
                      </td>
                      <td className="px-4 py-2 text-right text-text-secondary">
                        {formatLKR(l.budgetedProratedCents)}
                      </td>
                      <td className="px-4 py-2 text-right text-text-primary">
                        {formatLKR(l.actualCents)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right ${tone(l.varianceCents, l.pctConsumed)}`}
                      >
                        {formatLKR(l.varianceCents)}
                      </td>
                      <td className="px-4 py-2 text-right text-text-secondary">
                        {l.pctConsumed == null
                          ? "—"
                          : `${(l.pctConsumed * 100).toFixed(0)}%`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "text-text-primary",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-card border border-border-subtle bg-surface p-4">
      <div className="text-caption uppercase tracking-wide text-text-secondary">
        {label}
      </div>
      <div className={`mt-1 text-h2 ${tone}`}>{value}</div>
    </div>
  );
}
