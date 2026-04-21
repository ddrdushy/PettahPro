import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Plus } from "lucide-react";
import type { JournalEntryListRow } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Journal entries" };

async function fetchEntries(): Promise<JournalEntryListRow[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/journal-entries?limit=100`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { entries: JournalEntryListRow[] };
  return data.entries;
}

function sourceLabel(s: string | null): string {
  if (!s) return "—";
  const map: Record<string, string> = {
    invoice: "Invoice",
    bill: "Bill",
    customer_payment: "Receipt",
    supplier_payment: "Supplier payment",
    payroll_run: "Payroll",
    payroll_payment: "Payroll payment",
    statutory_remittance: "Statutory",
    invoice_void: "Invoice void",
    bill_void: "Bill void",
    manual: "Manual",
    opening_balance: "Opening balance",
    stock_movement: "Stock",
    cheque_clear: "Cheque clear",
  };
  return map[s] ?? s;
}

export default async function JournalsPage() {
  const entries = await fetchEntries();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Accounting"
        title="Journal entries"
        description="Every posting that's hit the ledger — system-generated and manually adjusted."
        action={
          <Link href="/app/journals/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New manual entry
          </Link>
        }
      />

      {entries.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">No journal entries yet.</p>
          <p className="mt-1 text-caption text-text-tertiary">
            Post an invoice, a bill, or a manual entry and it'll show up here.
          </p>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Date</th>
                <th className="w-32 px-4 py-3 text-left">Entry</th>
                <th className="w-32 px-4 py-3 text-left">Source</th>
                <th className="px-4 py-3 text-left">Memo</th>
                <th className="w-20 px-4 py-3 text-right">Lines</th>
                <th className="w-36 px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {entries.map((e) => (
                <tr key={e.id} className="transition-colors hover:bg-surface-recessed/40">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(e.entryDate)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/journals/${e.id}`}
                      className="tabular-nums text-charcoal underline-offset-4 hover:underline"
                    >
                      {e.entryNumber}
                    </Link>
                    {e.isReversed && (
                      <p className="text-caption text-warning-accent">Reversed</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{sourceLabel(e.sourceType)}</td>
                  <td className="px-4 py-3 text-text-primary">
                    {e.memo ?? <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {e.lineCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(e.totalCents)}
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
