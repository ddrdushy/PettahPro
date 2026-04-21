import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { JournalEntryHeader, JournalEntryLine } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Journal entry" };

async function fetchEntry(
  id: string,
): Promise<{ entry: JournalEntryHeader; lines: JournalEntryLine[] } | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/journal-entries/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as { entry: JournalEntryHeader; lines: JournalEntryLine[] };
}

function sourceLabel(s: string | null): string {
  if (!s) return "System";
  const map: Record<string, string> = {
    invoice: "Sales invoice",
    bill: "Supplier bill",
    customer_payment: "Customer receipt",
    supplier_payment: "Supplier payment",
    payroll_run: "Payroll run",
    payroll_payment: "Payroll disbursement",
    statutory_remittance: "EPF/ETF/PAYE remittance",
    invoice_void: "Invoice void",
    bill_void: "Bill void",
    manual: "Manual entry",
    opening_balance: "Opening balance",
    stock_movement: "Stock movement",
    cheque_clear: "Cheque clearing",
  };
  return map[s] ?? s;
}

function sourceHref(sourceType: string | null, sourceId: string | null): string | null {
  if (!sourceType || !sourceId) return null;
  const map: Record<string, string> = {
    invoice: `/app/invoices/${sourceId}`,
    bill: `/app/bills/${sourceId}`,
    customer_payment: `/app/payments`,
    supplier_payment: `/app/supplier-payments`,
    payroll_run: `/app/payroll/${sourceId}`,
  };
  return map[sourceType] ?? null;
}

export default async function JournalDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchEntry(params.id);
  if (!data) notFound();
  const { entry, lines } = data;

  const drTotal = lines.reduce((s, l) => s + l.drCents, 0);
  const crTotal = lines.reduce((s, l) => s + l.crCents, 0);
  const href = sourceHref(entry.sourceType, entry.sourceId);

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/journals" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to journals
        </Link>
      </div>

      <PageHeader
        eyebrow={`Journal · ${sourceLabel(entry.sourceType)}`}
        title={entry.entryNumber}
        description={`${formatDate(entry.entryDate)}${entry.memo ? ` · ${entry.memo}` : ""}`}
      />

      {entry.isReversed && (
        <div className="mt-6 rounded-card border-hairline border-warning-accent/40 bg-warning-bg/60 px-5 py-3 text-small text-charcoal">
          This entry has been reversed by a subsequent journal.
        </div>
      )}

      {href && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated px-5 py-3 text-small">
          <span className="text-text-secondary">Source document: </span>
          <Link href={href} className="text-charcoal underline-offset-4 hover:underline">
            View {sourceLabel(entry.sourceType).toLowerCase()}
          </Link>
        </div>
      )}

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-12 px-4 py-3 text-center">#</th>
              <th className="w-24 px-4 py-3 text-left">Code</th>
              <th className="px-4 py-3 text-left">Account</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="w-32 px-4 py-3 text-right">Debit</th>
              <th className="w-32 px-4 py-3 text-right">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 text-center tabular-nums text-text-tertiary">{l.lineNo}</td>
                <td className="px-4 py-3 tabular-nums text-text-secondary">{l.accountCode}</td>
                <td className="px-4 py-3">
                  <p className="text-charcoal">{l.accountName}</p>
                  {(l.customerName || l.supplierName) && (
                    <p className="text-caption text-text-tertiary">
                      {l.customerName ? `Customer: ${l.customerName}` : `Supplier: ${l.supplierName}`}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-text-primary">
                  {l.description ?? <span className="text-text-tertiary">—</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {l.drCents > 0 ? formatLKR(l.drCents) : <span className="text-text-tertiary">—</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {l.crCents > 0 ? formatLKR(l.crCents) : <span className="text-text-tertiary">—</span>}
                </td>
              </tr>
            ))}
            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-charcoal" colSpan={3}>
                Totals
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(drTotal)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(crTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
