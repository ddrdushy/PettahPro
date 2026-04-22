import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import type { Account, BillDetail, BillLine, Supplier, TaxCode } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { formatLKR, formatDate } from "@/lib/format";
import { PostBillButton } from "./post-button";
import { BillVoidButton } from "@/components/app/void-button";
import { RecordPaymentOutButton } from "./record-payment-out-button";

export const metadata: Metadata = { title: "Bill" };

async function fetchBill(id: string) {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  const [bRes, coaRes, txRes] = await Promise.all([
    fetch(`${base}/bills/${id}`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/coa`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/tax-codes`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
  ]);
  if (bRes.status === 404) return null;
  if (!bRes.ok) return null;
  const data = (await bRes.json()) as {
    bill: BillDetail;
    lines: BillLine[];
    supplier: Supplier | null;
  };
  const coa = coaRes.ok ? ((await coaRes.json()) as { accounts: Account[] }).accounts : [];
  const bankAccounts = coa.filter(
    (a) => a.accountType === "asset" && (a.accountSubtype === "bank" || a.accountSubtype === "cash"),
  );
  const taxCodes = txRes.ok ? ((await txRes.json()) as { taxCodes: TaxCode[] }).taxCodes : [];
  const whtTaxCodes = taxCodes.filter((t) => t.taxType === "wht");
  return { ...data, bankAccounts, whtTaxCodes };
}

export default async function BillDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchBill(params.id);
  if (!data) notFound();
  const { bill, lines, supplier, bankAccounts, whtTaxCodes } = data;

  const isPayable =
    (bill.status === "posted" || bill.status === "partially_paid") && bill.balanceDueCents > 0;

  const canVoid =
    (bill.status === "posted" || bill.status === "partially_paid") && bill.amountPaidCents === 0;
  const voidDisabledReason =
    bill.status === "void"
      ? "Already void."
      : bill.status === "draft"
        ? "Drafts don't need voiding — delete them instead."
        : bill.amountPaidCents > 0
          ? "Reverse the payments first, then void."
          : undefined;

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/bills" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to bills
        </Link>
      </div>

      <PageHeader
        eyebrow={bill.status === "draft" ? "Draft" : bill.internalReference ?? "Bill"}
        title={bill.internalReference ? `Bill ${bill.internalReference}` : "Draft bill"}
        description={supplier ? `From ${supplier.name}` : undefined}
        action={
          <div className="flex items-center gap-3">
            <StatusBadge status={bill.status} />
            <a
              href={`/app/bills/${bill.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="btn-secondary inline-flex items-center gap-1 text-small"
              title={bill.status === "draft" ? "Printable preview — watermarked as draft" : "Printable bill"}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              PDF
            </a>
            {bill.status === "draft" && <PostBillButton id={bill.id} />}
            {isPayable && supplier && (
              <RecordPaymentOutButton
                billId={bill.id}
                supplierId={supplier.id}
                supplierName={supplier.name}
                billReference={bill.internalReference ?? bill.id.slice(0, 8)}
                balanceDueCents={bill.balanceDueCents}
                bankAccounts={bankAccounts}
                whtTaxCodes={whtTaxCodes}
                defaultWhtTaxCodeId={supplier.defaultWhtTaxCodeId ?? null}
              />
            )}
            {(canVoid || bill.status === "void") && (
              <BillVoidButton
                billId={bill.id}
                label={`bill ${bill.internalReference ?? bill.id.slice(0, 8)}`}
                disabled={!canVoid}
                disabledReason={voidDisabledReason}
              />
            )}
          </div>
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Meta label="Bill date" value={formatDate(bill.billDate)} />
              <Meta label="Due date" value={formatDate(bill.dueDate)} />
              <Meta label="Currency" value={bill.currency} />
              {bill.supplierBillNumber && <Meta label="Supplier ref" value={bill.supplierBillNumber} />}
              {bill.postedAt && <Meta label="Posted" value={formatDate(bill.postedAt)} />}
            </dl>
          </section>

          <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <div className="overflow-x-auto">
              <table className="w-full text-small">
                <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="w-10 px-4 py-3 text-center">#</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="w-24 px-4 py-3 text-right">Qty</th>
                    <th className="w-32 px-4 py-3 text-right">Unit</th>
                    <th className="w-28 px-4 py-3 text-right">Tax</th>
                    <th className="w-32 px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y-hairline divide-border">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-3 text-center text-caption text-text-tertiary">{l.lineNo}</td>
                      <td className="px-4 py-3">
                        <p className="text-charcoal">{l.description}</p>
                        {l.discountCents > 0 && (
                          <p className="text-caption text-text-tertiary">
                            Discount {(l.discountPctBps / 100).toFixed(2)}% · {formatLKR(l.discountCents)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {Number(l.quantity).toLocaleString("en-LK")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatLKR(l.unitPriceCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {l.taxCents > 0 ? (
                          <>
                            <p>{formatLKR(l.taxCents)}</p>
                            <p className="text-caption text-text-tertiary">{(l.taxRateBps / 100).toFixed(2)}%</p>
                          </>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                        {formatLKR(l.lineTotalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {bill.notes && (
            <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Notes</p>
              <p className="mt-2 whitespace-pre-wrap text-body text-charcoal">{bill.notes}</p>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          {supplier && (
            <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Billed from</p>
              <p className="mt-2 font-medium text-charcoal">{supplier.name}</p>
              {supplier.email && <p className="text-small text-text-secondary">{supplier.email}</p>}
              {supplier.phone && <p className="text-small text-text-secondary">{supplier.phone}</p>}
              {supplier.city && <p className="text-small text-text-secondary">{supplier.city}</p>}
              {supplier.vatNo && (
                <p className="mt-2 text-caption text-text-tertiary">VAT: {supplier.vatNo}</p>
              )}
              {supplier.bankName && (
                <p className="mt-3 text-caption text-text-tertiary">
                  Bank: {supplier.bankName}
                  {supplier.bankAccountNo && ` · ${supplier.bankAccountNo}`}
                </p>
              )}
            </section>
          )}

          <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Totals</p>
            <dl className="mt-4 space-y-2 text-small">
              <Row label="Subtotal" value={bill.subtotalCents} />
              {bill.discountCents > 0 && <Row label="Discount" value={-bill.discountCents} />}
              <Row label="Input tax" value={bill.taxCents} />
              <div className="border-t-hairline border-border pt-2">
                <Row label="Bill total" value={bill.totalCents} emphasize />
              </div>
              <Row label="Paid" value={bill.amountPaidCents} muted />
              <Row label="Balance due" value={bill.balanceDueCents} emphasize />
            </dl>
          </section>

          {bill.journalEntryId && (
            <section className="rounded-card border-hairline border-mint bg-mint-surface/40 p-5">
              <p className="text-caption uppercase tracking-wide text-mint-dark">Ledger</p>
              <p className="mt-1 text-small text-charcoal">
                Posted to the general ledger. Journal entry is immutable.
              </p>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className="mt-1 text-small text-charcoal">{value}</dd>
    </div>
  );
}

function Row({
  label,
  value,
  emphasize,
  muted,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt
        className={
          emphasize
            ? "font-medium text-charcoal"
            : muted
              ? "text-text-tertiary"
              : "text-text-secondary"
        }
      >
        {label}
      </dt>
      <dd
        className={`tabular-nums ${
          emphasize ? "text-h3 text-charcoal" : muted ? "text-text-tertiary" : "text-charcoal"
        }`}
      >
        {formatLKR(value)}
      </dd>
    </div>
  );
}
