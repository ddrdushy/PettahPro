import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Check, AlertTriangle } from "lucide-react";
import type { TrialBalance, TrialBalanceAccount } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Trial balance" };

const typeOrder: Record<TrialBalanceAccount["accountType"], number> = {
  asset: 1,
  liability: 2,
  equity: 3,
  income: 4,
  expense: 5,
};

const typeLabel: Record<TrialBalanceAccount["accountType"], string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

async function fetchTrialBalance({
  from,
  to,
}: {
  from?: string;
  to?: string;
}): Promise<TrialBalance | null> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/reports/trial-balance${qs ? `?${qs}` : ""}`,
    {
      headers: { cookie: cookies().toString() },
      cache: "no-store",
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as TrialBalance;
}

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const data = await fetchTrialBalance({
    from: searchParams.from,
    to: searchParams.to,
  });

  if (!data) {
    return (
      <main className="container-p py-10">
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">Couldn't load the trial balance.</p>
        </div>
      </main>
    );
  }

  // Group accounts by type, keep only accounts with activity OR a non-zero balance
  const active = data.accounts.filter(
    (a) => a.debitCents > 0 || a.creditCents > 0,
  );
  const grouped = new Map<TrialBalanceAccount["accountType"], TrialBalanceAccount[]>();
  for (const a of active) {
    const arr = grouped.get(a.accountType) ?? [];
    arr.push(a);
    grouped.set(a.accountType, arr);
  }
  const orderedGroups = Array.from(grouped.entries()).sort(
    (a, b) => typeOrder[a[0]] - typeOrder[b[0]],
  );

  const periodLabel = (() => {
    if (data.asOfFrom && data.asOfTo) return `${formatDate(data.asOfFrom)} — ${formatDate(data.asOfTo)}`;
    if (data.asOfTo) return `As at ${formatDate(data.asOfTo)}`;
    if (data.asOfFrom) return `From ${formatDate(data.asOfFrom)}`;
    return "All time (inception to date)";
  })();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Reports"
        title="Trial balance"
        description={periodLabel + " · every account's debit and credit activity with its closing balance."}
      />

      <form className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="from" className="block text-caption uppercase tracking-wide text-text-tertiary">
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
          <label htmlFor="to" className="block text-caption uppercase tracking-wide text-text-tertiary">
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
        <button type="submit" className="btn-secondary text-small">Apply</button>
        {(searchParams.from || searchParams.to) && (
          <a href="/app/reports/trial-balance" className="btn-link text-small">
            Clear
          </a>
        )}
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
              {data.balanced
                ? "Every journal entry in scope sums to zero."
                : "A journal entry has fallen out of balance. Investigate before period close."}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="tabular-nums text-small text-text-secondary">
            Total DR {formatLKR(data.totalDebits)}
          </p>
          <p className="tabular-nums text-small text-text-secondary">
            Total CR {formatLKR(data.totalCredits)}
          </p>
        </div>
      </div>

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-20 px-4 py-3 text-left">Code</th>
              <th className="px-4 py-3 text-left">Account</th>
              <th className="w-36 px-4 py-3 text-right">Debits</th>
              <th className="w-36 px-4 py-3 text-right">Credits</th>
              <th className="w-36 px-4 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {orderedGroups.map(([type, rows]) => {
              const sectionDr = rows.reduce((s, r) => s + r.debitCents, 0);
              const sectionCr = rows.reduce((s, r) => s + r.creditCents, 0);
              return (
                <>
                  <tr key={`header-${type}`} className="bg-surface-recessed/40">
                    <td colSpan={5} className="px-4 py-2">
                      <span className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
                        {typeLabel[type]}
                      </span>
                    </td>
                  </tr>
                  {rows.map((a) => {
                    const glParams = new URLSearchParams({ accountId: a.accountId });
                    if (data.asOfFrom) glParams.set("from", data.asOfFrom);
                    if (data.asOfTo) glParams.set("to", data.asOfTo);
                    return (
                    <tr key={a.accountId} className="group">
                      <td className="px-4 py-3 tabular-nums text-text-secondary">{a.code}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/reports/general-ledger?${glParams.toString()}`}
                          className="text-charcoal underline-offset-4 hover:underline"
                        >
                          {a.name}
                        </Link>
                        {a.accountSubtype && (
                          <p className="text-caption text-text-tertiary">{a.accountSubtype}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {a.debitCents > 0 ? (
                          formatLKR(a.debitCents)
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {a.creditCents > 0 ? (
                          formatLKR(a.creditCents)
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                        {formatLKR(a.balanceCents)}
                      </td>
                    </tr>
                    );
                  })}
                  <tr key={`sub-${type}`} className="bg-surface-recessed/30">
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 text-caption text-text-secondary">
                      Subtotal {typeLabel[type].toLowerCase()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                      {formatLKR(sectionDr)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                      {formatLKR(sectionCr)}
                    </td>
                    <td className="px-4 py-2" />
                  </tr>
                </>
              );
            })}
            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-charcoal">Totals</td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(data.totalDebits)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(data.totalCredits)}
              </td>
              <td className="px-4 py-3" />
            </tr>
          </tbody>
        </table>
      </section>

      {active.length === 0 && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">No journal activity in this period yet.</p>
        </div>
      )}
    </main>
  );
}
