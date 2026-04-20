import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Check, AlertTriangle } from "lucide-react";
import type { BalanceSheet, BalanceSheetSection } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Balance sheet" };

async function fetchBalanceSheet(asOf?: string): Promise<BalanceSheet | null> {
  const qs = asOf ? `?asOf=${asOf}` : "";
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/reports/balance-sheet${qs}`,
    {
      headers: { cookie: cookies().toString() },
      cache: "no-store",
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as BalanceSheet;
}

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: { asOf?: string };
}) {
  const data = await fetchBalanceSheet(searchParams.asOf);

  if (!data) {
    return (
      <main className="container-p py-10">
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">Couldn't load the balance sheet.</p>
        </div>
      </main>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Reports"
        title="Balance sheet"
        description={`Snapshot as at ${formatDate(data.asOf)} · every asset, liability, and equity position at a point in time.`}
      />

      <form className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="asOf" className="block text-caption uppercase tracking-wide text-text-tertiary">
            As at
          </label>
          <input
            id="asOf"
            name="asOf"
            type="date"
            defaultValue={searchParams.asOf ?? today}
            className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          />
        </div>
        <button type="submit" className="btn-secondary text-small">Apply</button>
      </form>

      <div
        className={`mt-6 flex items-center justify-between gap-4 rounded-card border-hairline px-5 py-4 ${
          data.balanced
            ? "border-mint/40 bg-mint-surface/60"
            : "border-danger/40 bg-danger-bg/60"
        }`}
      >
        <div className="flex items-start gap-3">
          {data.balanced ? (
            <span className="grid h-8 w-8 place-items-center rounded-full bg-mint text-mint-dark">
              <Check className="h-4 w-4" aria-hidden />
            </span>
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded-full bg-danger/20 text-danger">
              <AlertTriangle className="h-4 w-4" aria-hidden />
            </span>
          )}
          <div>
            <p className="text-small font-medium text-charcoal">
              {data.balanced ? "Books balance" : "Books don't balance"}
            </p>
            <p className="text-caption text-text-secondary">
              Assets {formatLKR(data.totalAssetsCents)} · Liabilities {formatLKR(data.totalLiabilitiesCents)} · Equity {formatLKR(data.totalEquityCents)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card section={data.sections[0]!} tone="assets" />
        <div className="space-y-6">
          <Card section={data.sections[1]!} tone="liabilities" />
          <Card section={data.sections[2]!} tone="equity" />

          <section className="rounded-card border-hairline border-charcoal bg-surface-elevated p-5">
            <div className="flex items-center justify-between">
              <p className="text-small font-medium text-charcoal">Liabilities + Equity</p>
              <p className="tabular-nums text-h3 text-charcoal">
                {formatLKR(data.liabilitiesAndEquityCents)}
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Card({ section, tone }: { section: BalanceSheetSection; tone: "assets" | "liabilities" | "equity" }) {
  const toneHeader: Record<typeof tone, string> = {
    assets: "text-mint-dark",
    liabilities: "text-warning",
    equity: "text-charcoal",
  };
  return (
    <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
      <header className="flex items-center justify-between border-b-hairline border-border px-5 py-4">
        <h2 className={`text-h3 ${toneHeader[tone]}`}>{section.label}</h2>
        <p className="tabular-nums text-body font-medium text-charcoal">
          {formatLKR(section.totalCents)}
        </p>
      </header>
      {section.accounts.length === 0 ? (
        <div className="px-5 py-8 text-center text-caption text-text-tertiary">
          No {section.label.toLowerCase()} recorded yet.
        </div>
      ) : (
        <ul className="divide-y-hairline divide-border">
          {section.accounts.map((a) => (
            <li
              key={a.accountId}
              className="flex items-center justify-between gap-4 px-5 py-3 text-small"
            >
              <div className="min-w-0">
                <p className="text-charcoal">{a.name}</p>
                <p className="text-caption text-text-tertiary">
                  {a.code === "—" ? a.subtype : a.code}
                </p>
              </div>
              <p className="tabular-nums text-charcoal">{formatLKR(a.balanceCents)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
