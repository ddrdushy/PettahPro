import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { FileX } from "lucide-react";
import type { BadDebtReport } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate, formatLKR } from "@/lib/format";

export const metadata: Metadata = { title: "Bad debts" };

async function fetchReport(): Promise<BadDebtReport | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/reports/bad-debts`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as BadDebtReport;
}

export default async function BadDebtsPage() {
  const data = await fetchReport();
  if (!data) {
    return (
      <main className="container-p py-10">
        <PageHeader eyebrow="Reports" title="Bad debts" description="Couldn't load the bad debts report." />
      </main>
    );
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Reports"
        title="Bad debts"
        description="Written-off invoices and the VAT you've reclaimed. Use the VAT-relief total when filing your next VAT return."
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card label="Written off" value={data.totals.count.toString()} sub={`${data.totals.count === 1 ? "invoice" : "invoices"}`} />
        <Card label="Principal (expense)" value={formatLKR(data.totals.principalCents)} sub="To 6500 Bad debt expense" />
        <Card label="VAT relief claimed" value={formatLKR(data.totals.vatReliefCents)} sub="Reclaimed from IRD" tone="mint" />
      </section>

      {data.writeOffs.length === 0 ? (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <FileX className="mx-auto h-6 w-6 text-text-tertiary" aria-hidden />
          <p className="mt-3 text-body text-text-secondary">No write-offs recorded yet.</p>
          <p className="mt-1 text-caption text-text-tertiary">
            Write off from the invoice detail page when you've given up on collection.
          </p>
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Invoice</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="w-32 px-4 py-3 text-left">Issued</th>
                <th className="w-32 px-4 py-3 text-left">Written off</th>
                <th className="w-36 px-4 py-3 text-right">Principal</th>
                <th className="w-36 px-4 py-3 text-right">VAT relief</th>
                <th className="w-36 px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {data.writeOffs.map((w) => (
                <tr key={w.invoiceId}>
                  <td className="px-4 py-3">
                    <Link href={`/app/invoices/${w.invoiceId}`} className="text-charcoal underline-offset-4 hover:underline">
                      {w.invoiceNumber ?? w.invoiceId.slice(0, 8)}
                    </Link>
                    {w.writeoffReason && (
                      <p className="mt-0.5 text-caption italic text-text-tertiary">&quot;{w.writeoffReason}&quot;</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/app/customers/${w.customerId}`} className="text-text-secondary underline-offset-4 hover:underline">
                      {w.customerName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-tertiary">{formatDate(w.issueDate)}</td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(w.writtenOffAt.slice(0, 10))}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{formatLKR(w.principalCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-mint-dark">
                    {w.vatReliefCents > 0 ? formatLKR(w.vatReliefCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                    {formatLKR(w.principalCents + w.vatReliefCents)}
                  </td>
                </tr>
              ))}
              <tr className="bg-surface-recessed/60 font-medium">
                <td colSpan={4} className="px-4 py-3 text-charcoal">Totals</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatLKR(data.totals.principalCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-mint-dark">{formatLKR(data.totals.vatReliefCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(data.totals.totalCents)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function Card({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "mint";
}) {
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className={`mt-2 text-h3 font-medium tabular-nums ${tone === "mint" ? "text-mint-dark" : "text-charcoal"}`}>{value}</p>
      <p className="text-caption text-text-tertiary">{sub}</p>
    </div>
  );
}
