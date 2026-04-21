import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";
import type { DebitNoteListRow, DebitNoteStatus, DebitNoteReason } from "@/lib/api";

export const metadata: Metadata = { title: "Debit notes" };

const statusStyles: Record<DebitNoteStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  posted: "bg-mint-surface text-mint-dark",
  void: "bg-danger-bg/60 text-danger",
};

const statusLabels: Record<DebitNoteStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  void: "Void",
};

const reasonLabels: Record<DebitNoteReason, string> = {
  return: "Return",
  price_adjustment: "Price adjustment",
  discount: "Discount",
  goodwill: "Goodwill",
  shortage: "Shortage",
  other: "Other",
};

async function fetchDebitNotes(): Promise<DebitNoteListRow[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/debit-notes`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { debitNotes: DebitNoteListRow[] };
  return data.debitNotes;
}

export default async function DebitNotesPage() {
  const notes = await fetchDebitNotes();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Buy"
        title="Debit notes"
        description="Returns to suppliers, price adjustments, and shortage claims that reverse a previously posted bill's GL impact."
        action={
          <Link href="/app/debit-notes/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New debit note
          </Link>
        }
      />

      {notes.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <FileText className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No debit notes yet.</p>
          <p className="mt-1 text-small text-text-secondary">
            Issue one when you return goods to a supplier, catch a pricing error, or claim a shortage.
          </p>
          <Link href="/app/debit-notes/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New debit note
          </Link>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Issued</th>
                <th className="w-36 px-4 py-3 text-left">Our ref</th>
                <th className="w-36 px-4 py-3 text-left">Supplier ref</th>
                <th className="px-4 py-3 text-left">Supplier</th>
                <th className="w-32 px-4 py-3 text-left">Reason</th>
                <th className="w-32 px-4 py-3 text-right">Total</th>
                <th className="w-32 px-4 py-3 text-right">Applied</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {notes.map((dn) => {
                const remainder = dn.totalCents - dn.appliedCents;
                return (
                  <tr key={dn.id} className="transition-colors hover:bg-surface-recessed/40">
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      {formatDate(dn.issueDate)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/debit-notes/${dn.id}`}
                        className="tabular-nums text-charcoal underline-offset-4 hover:underline"
                      >
                        {dn.internalReference ?? (
                          <span className="italic text-text-tertiary">Draft</span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      {dn.supplierDebitNumber ?? <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="px-4 py-3 text-charcoal">{dn.supplierName}</td>
                    <td className="px-4 py-3 text-text-secondary">{reasonLabels[dn.reason]}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                      {formatLKR(dn.totalCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {dn.status === "posted" ? (
                        <span className="text-text-secondary">
                          {formatLKR(dn.appliedCents)}
                          {remainder > 0 && (
                            <span className="ml-1 text-caption text-text-tertiary">
                              (+{formatLKR(remainder)} standing)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[dn.status]}`}
                      >
                        {statusLabels[dn.status]}
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
