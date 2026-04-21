import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertCircle } from "lucide-react";
import type { VatReturn } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "VAT return" };

async function fetchVat(from: string, to: string): Promise<VatReturn | null> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/reports/vat-return?${params.toString()}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as VatReturn;
}

function firstOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastOfMonthISO(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

export default async function VatReturnPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const from = searchParams.from ?? firstOfMonthISO();
  const to = searchParams.to ?? lastOfMonthISO();
  const data = await fetchVat(from, to);

  if (!data) {
    return (
      <main className="container-p py-10">
        <PageHeader eyebrow="Reports · Tax" title="VAT return" description="Couldn't load the VAT return." />
      </main>
    );
  }

  const { outputSummary: out, inputSummary: inp } = data;
  const netOwed = data.netVatPayableCents;

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Reports · Tax"
        title="VAT return"
        description={`Output and input VAT for ${formatDate(data.asOfFrom)} — ${formatDate(data.asOfTo)}. Ready for the IRD portal.`}
      />

      <form className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="from" className="block text-caption uppercase tracking-wide text-text-tertiary">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
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
            defaultValue={to}
            className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          />
        </div>
        <button type="submit" className="btn-secondary text-small">Apply</button>
      </form>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Output VAT (on sales)"
          value={formatLKR(out.standardRatedVatCents)}
          sub={`${formatLKR(out.standardRatedTaxableCents)} standard-rated · ${out.totalInvoices} invoices`}
        />
        <SummaryCard
          label="Input VAT (on purchases)"
          value={formatLKR(inp.standardRatedVatCents)}
          sub={`${formatLKR(inp.standardRatedTaxableCents)} standard-rated · ${inp.totalBills} bills`}
        />
        <SummaryCard
          label={netOwed >= 0 ? "Net VAT payable to IRD" : "Net VAT refund due"}
          value={formatLKR(Math.abs(netOwed))}
          sub={netOwed >= 0 ? "Output minus input" : "Input exceeded output"}
          emphasis
        />
      </section>

      {(out.zeroRatedTaxableCents > 0 || out.exemptTaxableCents > 0) && (
        <section className="mt-4 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">
            Non-standard sales (declared, no output VAT)
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-small text-text-secondary">Zero-rated (e.g. exports)</p>
              <p className="tabular-nums text-body font-medium text-charcoal">
                {formatLKR(out.zeroRatedTaxableCents)}
              </p>
            </div>
            <div>
              <p className="text-small text-text-secondary">Exempt supplies</p>
              <p className="tabular-nums text-body font-medium text-charcoal">
                {formatLKR(out.exemptTaxableCents)}
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-h3 text-charcoal">Output register</h2>
            <p className="text-caption text-text-tertiary">
              Every posted invoice with VAT exposure in this period.
            </p>
          </div>
          <span className="tabular-nums text-small text-text-secondary">
            {data.outputRegister.length} {data.outputRegister.length === 1 ? "invoice" : "invoices"}
          </span>
        </div>

        {data.outputRegister.length === 0 ? (
          <EmptyBlock label="No taxable sales in this period." />
        ) : (
          <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <table className="w-full text-small">
              <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="w-28 px-4 py-3 text-left">Date</th>
                  <th className="w-32 px-4 py-3 text-left">Invoice</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="w-32 px-4 py-3 text-right">Taxable</th>
                  <th className="w-28 px-4 py-3 text-right">VAT</th>
                  <th className="w-32 px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y-hairline divide-border">
                {data.outputRegister.map((r) => (
                  <tr key={r.invoiceId}>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(r.issueDate)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/invoices/${r.invoiceId}`}
                        className="tabular-nums text-charcoal underline-offset-4 hover:underline"
                      >
                        {r.invoiceNumber ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-charcoal">{r.customerName}</p>
                      {r.customerVatNo && (
                        <p className="text-caption text-text-tertiary">VAT {r.customerVatNo}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatLKR(r.taxableCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatLKR(r.vatCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(r.totalCents)}</td>
                  </tr>
                ))}
                <tr className="bg-surface-recessed font-medium">
                  <td className="px-4 py-3" colSpan={3}>
                    <span className="text-charcoal">Totals</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(out.standardRatedTaxableCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(out.standardRatedVatCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(
                      data.outputRegister.reduce((s, r) => s + r.totalCents, 0),
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-h3 text-charcoal">Input register</h2>
            <p className="text-caption text-text-tertiary">
              Every posted bill with claimable input VAT in this period.
            </p>
          </div>
          <span className="tabular-nums text-small text-text-secondary">
            {data.inputRegister.length} {data.inputRegister.length === 1 ? "bill" : "bills"}
          </span>
        </div>

        {data.inputRegister.length === 0 ? (
          <EmptyBlock label="No taxable purchases in this period." />
        ) : (
          <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <table className="w-full text-small">
              <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="w-28 px-4 py-3 text-left">Date</th>
                  <th className="w-36 px-4 py-3 text-left">Supplier ref</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="w-32 px-4 py-3 text-right">Taxable</th>
                  <th className="w-28 px-4 py-3 text-right">VAT</th>
                  <th className="w-32 px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y-hairline divide-border">
                {data.inputRegister.map((r) => (
                  <tr key={r.billId}>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">{formatDate(r.billDate)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/bills/${r.billId}`}
                        className="tabular-nums text-charcoal underline-offset-4 hover:underline"
                      >
                        {r.supplierBillNumber ?? r.internalReference ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-charcoal">{r.supplierName}</p>
                      {r.supplierVatNo && (
                        <p className="text-caption text-text-tertiary">VAT {r.supplierVatNo}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatLKR(r.taxableCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatLKR(r.vatCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-charcoal">{formatLKR(r.totalCents)}</td>
                  </tr>
                ))}
                <tr className="bg-surface-recessed font-medium">
                  <td className="px-4 py-3" colSpan={3}>
                    <span className="text-charcoal">Totals</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(inp.standardRatedTaxableCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(inp.standardRatedVatCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(
                      data.inputRegister.reduce((s, r) => s + r.totalCents, 0),
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-8 flex items-start gap-3 rounded-card border-hairline border-border bg-surface-recessed/30 px-5 py-4 text-small text-text-secondary">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-text-tertiary" aria-hidden />
        <div>
          <p className="text-charcoal">Cross-check before filing.</p>
          <p className="mt-1">
            This report aggregates VAT from posted invoices and bills in range. Direct API filing to IRD isn't
            supported (IRD's portal isn't open enough) — the figures above are ready to transcribe into the VAT 3 form.
            Credit note adjustments and bad-debt relief will land here once those modules ship.
          </p>
        </div>
      </div>
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

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
      <p className="text-body text-text-secondary">{label}</p>
    </div>
  );
}
