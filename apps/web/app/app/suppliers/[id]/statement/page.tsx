import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { SupplierStatement, PartyAgingBucket } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Supplier statement" };

async function fetchStatement({
  id,
  from,
  to,
}: {
  id: string;
  from?: string;
  to?: string;
}): Promise<SupplierStatement | null> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/suppliers/${id}/statement${qs ? `?${qs}` : ""}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as SupplierStatement;
}

function agingLabel(b: PartyAgingBucket["label"]): string {
  if (b === "current") return "Not yet due";
  if (b === "90+") return "90+ days";
  return `${b} days`;
}

export default async function SupplierStatementPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string; to?: string };
}) {
  const data = await fetchStatement({ id: params.id, from: searchParams.from, to: searchParams.to });
  if (!data) notFound();

  const { supplier, transactions, aging } = data;
  const agingTotal = aging.reduce((s, b) => s + b.balanceCents, 0);

  return (
    <main className="container-p py-10">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href={`/app/suppliers/${supplier.id}`} className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to {supplier.name}
        </Link>
        <form className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="from" className="block text-caption uppercase tracking-wide text-text-tertiary">
              From
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={data.asOfFrom}
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
              defaultValue={data.asOfTo}
              className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
            />
          </div>
          <button type="submit" className="btn-secondary text-small">Apply</button>
        </form>
      </div>

      <PageHeader
        eyebrow="Statement"
        title={supplier.name}
        description={`${formatDate(data.asOfFrom)} — ${formatDate(data.asOfTo)}${supplier.vatNo ? ` · VAT ${supplier.vatNo}` : ""}`}
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        <SummaryCard label="Opening balance" value={formatLKR(data.openingBalanceCents)} sub={`We owed as at ${formatDate(data.asOfFrom)}`} />
        <SummaryCard label="Billed in period" value={formatLKR(data.totalBilledCents)} sub={`${transactions.filter((t) => t.kind === "bill").length} bills`} />
        <SummaryCard label="Paid in period" value={formatLKR(data.totalPaidCents)} sub={`${transactions.filter((t) => t.kind === "payment").length} payments`} />
        <SummaryCard label="Balance owed" value={formatLKR(data.closingBalanceCents)} sub={`As at ${formatDate(data.asOfTo)}`} emphasis />
      </section>

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-28 px-4 py-3 text-left">Date</th>
              <th className="w-32 px-4 py-3 text-left">Document</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="w-28 px-4 py-3 text-left">Due</th>
              <th className="w-32 px-4 py-3 text-right">Debit (paid)</th>
              <th className="w-32 px-4 py-3 text-right">Credit (billed)</th>
              <th className="w-36 px-4 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            <tr className="bg-surface-recessed/40">
              <td className="px-4 py-2 tabular-nums text-text-secondary">{formatDate(data.asOfFrom)}</td>
              <td className="px-4 py-2 text-caption text-text-secondary" colSpan={4}>
                Opening balance
              </td>
              <td className="px-4 py-2" />
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                {formatLKR(data.openingBalanceCents)}
              </td>
            </tr>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-tertiary">
                  No bills or payments in this period.
                </td>
              </tr>
            ) : (
              transactions.map((t) => (
                <tr key={`${t.kind}-${t.id}`}>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(t.date)}</td>
                  <td className="px-4 py-3">
                    {t.kind === "bill" ? (
                      <Link href={`/app/bills/${t.id}`} className="tabular-nums text-charcoal underline-offset-4 hover:underline">
                        {t.number ?? "—"}
                      </Link>
                    ) : (
                      <span className="tabular-nums text-charcoal">{t.number ?? "Payment"}</span>
                    )}
                    <p className="text-caption text-text-tertiary">
                      {t.kind === "bill" ? "Bill" : "Payment"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-text-primary">
                      {t.description || <span className="text-text-tertiary">—</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {t.dueDate ? formatDate(t.dueDate) : <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {t.debitCents > 0 ? formatLKR(t.debitCents) : <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {t.creditCents > 0 ? formatLKR(t.creditCents) : <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(t.runningBalanceCents)}
                  </td>
                </tr>
              ))
            )}
            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3 tabular-nums text-charcoal">{formatDate(data.asOfTo)}</td>
              <td className="px-4 py-3 text-charcoal" colSpan={3}>
                Closing balance
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(data.totalPaidCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(data.totalBilledCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(data.closingBalanceCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {agingTotal > 0 && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-6">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Aging as at {formatDate(data.asOfTo)}</p>
              <p className="text-caption text-text-tertiary">Open bills only</p>
            </div>
            <span className="tabular-nums text-small font-medium text-charcoal">{formatLKR(agingTotal)}</span>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-5">
            {aging.map((b) => (
              <div key={b.label}>
                <p className="text-caption uppercase tracking-wide text-text-tertiary">{agingLabel(b.label)}</p>
                <p className="tabular-nums mt-1 text-body font-medium text-charcoal">{formatLKR(b.balanceCents)}</p>
                {b.invoiceCount > 0 && (
                  <p className="text-caption text-text-tertiary">{b.invoiceCount} {b.invoiceCount === 1 ? "bill" : "bills"}</p>
                )}
              </div>
            ))}
          </div>
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
