import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { CustomerStatement } from "@/lib/api";

export const metadata: Metadata = { title: "Your statement" };

function formatCurrency(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const str = abs.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `(${str})` : str;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

const BUCKET_LABELS: Record<string, string> = {
  current: "Not due yet",
  "0-30": "0–30 days overdue",
  "30-60": "30–60 days overdue",
  "60-90": "60–90 days overdue",
  "90+": "Over 90 days",
};

async function fetchStatement(
  from?: string,
  to?: string,
): Promise<CustomerStatement | null> {
  const cookieHeader = cookies().toString();
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const q = qs.toString();
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/portal/statement${q ? `?${q}` : ""}`,
    { headers: { cookie: cookieHeader }, cache: "no-store" },
  );
  if (res.status === 401) redirect("/portal/login");
  if (!res.ok) return null;
  return (await res.json()) as CustomerStatement;
}

export default async function PortalStatementPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const data = await fetchStatement(searchParams.from, searchParams.to);

  if (!data) {
    return (
      <main className="container-p py-10">
        <h1 className="text-h1 text-charcoal">Your statement</h1>
        <p className="mt-4 text-body text-text-secondary">Couldn't load your statement right now.</p>
      </main>
    );
  }

  return (
    <main className="container-p py-10">
      <header>
        <h1 className="text-h1 text-charcoal">Your statement</h1>
        <p className="mt-2 text-body text-text-secondary">
          {formatDate(data.asOfFrom)} → {formatDate(data.asOfTo)}
        </p>
      </header>

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <Kpi label="Opening balance" value={formatCurrency(data.openingBalanceCents)} />
        <Kpi label="Billed" value={formatCurrency(data.totalBilledCents)} />
        <Kpi label="Paid" value={formatCurrency(data.totalReceivedCents)} />
        <Kpi label="Closing balance" value={formatCurrency(data.closingBalanceCents)} emphasis />
      </section>

      <section className="mt-8">
        <h2 className="text-body font-medium text-charcoal">Aging</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          {data.aging.map((b) => (
            <div
              key={b.label}
              className="rounded-card border-hairline border-border bg-surface-elevated p-4"
            >
              <p className="text-caption text-text-tertiary">{BUCKET_LABELS[b.label] ?? b.label}</p>
              <p className="mt-2 text-h3 tabular-nums text-charcoal">
                {formatCurrency(b.balanceCents)}
              </p>
              <p className="mt-1 text-caption text-text-tertiary">
                {b.invoiceCount} invoice{b.invoiceCount === 1 ? "" : "s"}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="px-6 py-3 text-left">Date</th>
              <th className="px-6 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-right">Debit</th>
              <th className="px-4 py-3 text-right">Credit</th>
              <th className="px-6 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            <tr className="bg-surface-recessed/30">
              <td className="px-6 py-3 text-text-secondary">{formatDate(data.asOfFrom)}</td>
              <td className="px-6 py-3 text-text-secondary">Opening balance</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-6 py-3 text-right tabular-nums text-charcoal">
                {formatCurrency(data.openingBalanceCents)}
              </td>
            </tr>
            {data.transactions.map((t) => (
              <tr key={`${t.kind}-${t.id}`}>
                <td className="px-6 py-3 text-text-secondary">{formatDate(t.date)}</td>
                <td className="px-6 py-3 text-charcoal">
                  <span className="text-charcoal">{t.number ?? (t.kind === "invoice" ? "Invoice" : "Payment")}</span>
                  {t.description && (
                    <span className="ml-2 text-text-tertiary">· {t.description}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                  {t.debitCents ? formatCurrency(t.debitCents) : ""}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                  {t.creditCents ? formatCurrency(t.creditCents) : ""}
                </td>
                <td className="px-6 py-3 text-right tabular-nums text-charcoal">
                  {formatCurrency(t.runningBalanceCents)}
                </td>
              </tr>
            ))}
            <tr className="bg-surface-recessed/30">
              <td className="px-6 py-3 text-text-secondary">{formatDate(data.asOfTo)}</td>
              <td className="px-6 py-3 font-medium text-charcoal">Closing balance</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-6 py-3 text-right font-medium tabular-nums text-charcoal">
                {formatCurrency(data.closingBalanceCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Kpi({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-4">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p
        className={
          emphasis
            ? "mt-2 text-h2 tabular-nums text-charcoal"
            : "mt-2 text-h3 tabular-nums text-charcoal"
        }
      >
        {value}
      </p>
    </div>
  );
}
