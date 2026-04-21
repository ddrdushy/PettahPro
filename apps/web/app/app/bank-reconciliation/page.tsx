import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Plus, ScrollText } from "lucide-react";
import type { BankImportRow, BankImportStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Bank reconciliation" };

const statusStyles: Record<BankImportStatus, string> = {
  pending: "bg-warning-bg text-warning",
  reconciled: "bg-mint text-mint-dark",
};

async function fetchImports(): Promise<BankImportRow[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/bank-reconciliation/imports`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { imports: BankImportRow[] };
  return data.imports;
}

export default async function BankRecPage() {
  const rows = await fetchImports();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Accounting"
        title="Bank reconciliation"
        description="Import a bank statement CSV, auto-match against posted payments, mark anomalies manually, and lock the period."
        action={
          <Link href="/app/bank-reconciliation/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New import
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <ScrollText className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No bank statements imported yet.</p>
          <p className="mt-1 text-small text-text-secondary">
            Paste a CSV from your bank portal, pick the account, and we'll match against your posted payments.
          </p>
          <Link href="/app/bank-reconciliation/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New import
          </Link>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-32 px-4 py-3 text-left">Imported</th>
                <th className="px-4 py-3 text-left">Bank account</th>
                <th className="w-40 px-4 py-3 text-left">Period</th>
                <th className="w-32 px-4 py-3 text-right">Matched / total</th>
                <th className="w-32 px-4 py-3 text-right">Closing balance</th>
                <th className="w-28 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-surface-recessed/40">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {formatDate(r.createdAt.slice(0, 10))}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/app/bank-reconciliation/${r.id}`} className="text-charcoal underline-offset-4 hover:underline">
                      <span className="tabular-nums">{r.bankAccountCode}</span> · {r.bankAccountName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {formatDate(r.statementFromDate)} — {formatDate(r.statementToDate)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={r.matchedLines === r.totalLines ? "text-charcoal" : "text-warning-accent"}>
                      {r.matchedLines} / {r.totalLines}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.closingBalanceCents !== null ? formatLKR(r.closingBalanceCents) : <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[r.status]}`}>
                      {r.status === "pending" ? "Pending" : "Reconciled"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
