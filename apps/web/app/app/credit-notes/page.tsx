import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";
import type { CreditNoteListRow, CreditNoteStatus, CreditNoteReason } from "@/lib/api";

export const metadata: Metadata = { title: "Credit notes" };

const statusStyles: Record<CreditNoteStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  posted: "bg-mint-surface text-mint-dark",
  void: "bg-danger-bg/60 text-danger",
};

const statusLabels: Record<CreditNoteStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  void: "Void",
};

const reasonLabels: Record<CreditNoteReason, string> = {
  return: "Return",
  price_adjustment: "Price adjustment",
  discount: "Discount",
  goodwill: "Goodwill",
  write_off: "Write-off",
  other: "Other",
};

async function fetchCreditNotes(): Promise<CreditNoteListRow[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/credit-notes`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { creditNotes: CreditNoteListRow[] };
  return data.creditNotes;
}

export default async function CreditNotesPage() {
  const notes = await fetchCreditNotes();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Sell"
        title="Credit notes"
        description="Sales returns, goodwill adjustments, and discounts that reverse a previously posted invoice's GL impact."
        action={
          <Link href="/app/credit-notes/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New credit note
          </Link>
        }
      />

      {notes.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <FileText className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No credit notes yet.</p>
          <p className="mt-1 text-small text-text-secondary">
            Issue one when a customer returns goods, you give a goodwill discount, or an invoice was overstated.
          </p>
          <Link href="/app/credit-notes/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New credit note
          </Link>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Issued</th>
                <th className="w-36 px-4 py-3 text-left">Number</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="w-32 px-4 py-3 text-left">Reason</th>
                <th className="w-32 px-4 py-3 text-right">Total</th>
                <th className="w-32 px-4 py-3 text-right">Applied</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {notes.map((cn) => {
                const remainder = cn.totalCents - cn.appliedCents;
                return (
                  <tr key={cn.id} className="transition-colors hover:bg-surface-recessed/40">
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      {formatDate(cn.issueDate)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/credit-notes/${cn.id}`}
                        className="tabular-nums text-charcoal underline-offset-4 hover:underline"
                      >
                        {cn.creditNoteNumber ?? (
                          <span className="italic text-text-tertiary">Draft</span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-charcoal">{cn.customerName}</td>
                    <td className="px-4 py-3 text-text-secondary">{reasonLabels[cn.reason]}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                      {formatLKR(cn.totalCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {cn.status === "posted" ? (
                        <span className="text-text-secondary">
                          {formatLKR(cn.appliedCents)}
                          {remainder > 0 && (
                            <span className="ml-1 text-caption text-text-tertiary">
                              (+{formatLKR(remainder)} credit)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[cn.status]}`}
                      >
                        {statusLabels[cn.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
