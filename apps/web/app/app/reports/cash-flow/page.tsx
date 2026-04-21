import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { CashFlow } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Cash flow" };

async function fetchCashFlow(from: string, to: string): Promise<CashFlow | null> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/reports/cash-flow?${params.toString()}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as CashFlow;
}

function firstOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const from = searchParams.from ?? firstOfMonthISO();
  const to = searchParams.to ?? todayISO();
  const data = await fetchCashFlow(from, to);

  if (!data) {
    return (
      <main className="container-p py-10">
        <PageHeader eyebrow="Reports" title="Cash flow" description="Couldn't load the cash flow statement." />
      </main>
    );
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Reports"
        title="Cash flow statement"
        description={`Movement of cash and bank balances from ${formatDate(data.asOfFrom)} to ${formatDate(data.asOfTo)} — classified by operating, investing, and financing activities.`}
      />

      <form className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="from" className="block text-caption uppercase tracking-wide text-text-tertiary">From</label>
          <input id="from" name="from" type="date" defaultValue={from} className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="to" className="block text-caption uppercase tracking-wide text-text-tertiary">To</label>
          <input id="to" name="to" type="date" defaultValue={to} className="input mt-1.5" />
        </div>
        <button type="submit" className="btn-secondary text-small">Apply</button>
      </form>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Opening cash" value={formatLKR(data.openingCashCents)} sub={`As at ${formatDate(data.asOfFrom)}`} />
        <SummaryCard
          label={data.netChangeCents >= 0 ? "Net cash inflow" : "Net cash outflow"}
          value={formatLKR(Math.abs(data.netChangeCents))}
          sub="Sum of all cash movements in period"
        />
        <SummaryCard label="Closing cash" value={formatLKR(data.closingCashCents)} sub={`As at ${formatDate(data.asOfTo)}`} emphasis />
      </section>

      <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-24 px-4 py-3 text-left">Code</th>
              <th className="px-4 py-3 text-left">Account</th>
              <th className="w-40 px-4 py-3 text-right">Cash effect</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {data.sections.map((section) => (
              <SectionBlock key={section.kind} section={section} />
            ))}
            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-charcoal">Net change in cash</td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(data.netChangeCents)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <p className="mt-4 text-caption text-text-tertiary">
        Derived from posted journal entries that touched a cash or bank account. Non-cash legs are attributed
        to operating, investing, or financing based on account type + subtype.
      </p>
    </main>
  );
}

function SectionBlock({ section }: { section: CashFlow["sections"][number] }) {
  return (
    <>
      <tr className="bg-surface-recessed/40">
        <td colSpan={3} className="px-4 py-2">
          <span className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
            {section.label}
          </span>
        </td>
      </tr>
      {section.accounts.length === 0 ? (
        <tr>
          <td colSpan={3} className="px-4 py-3 text-caption text-text-tertiary">
            No activity in this category.
          </td>
        </tr>
      ) : (
        section.accounts.map((a) => (
          <tr key={a.accountId}>
            <td className="px-4 py-3 tabular-nums text-text-secondary">{a.code}</td>
            <td className="px-4 py-3 text-charcoal">{a.name}</td>
            <td className="px-4 py-3 text-right tabular-nums">
              <span className={a.flowCents >= 0 ? "text-charcoal" : "text-danger"}>
                {formatLKR(a.flowCents)}
              </span>
            </td>
          </tr>
        ))
      )}
      <tr className="bg-surface-recessed/30">
        <td className="px-4 py-2" />
        <td className="px-4 py-2 text-caption text-text-secondary">
          Subtotal · {section.label.toLowerCase()}
        </td>
        <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
          {formatLKR(section.totalCents)}
        </td>
      </tr>
    </>
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
