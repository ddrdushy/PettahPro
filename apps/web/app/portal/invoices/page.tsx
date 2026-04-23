import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { PortalInvoice } from "@/lib/api";

export const metadata: Metadata = { title: "Your invoices" };

function formatCurrency(cents: number, currency: string): string {
  const base = (cents / 100).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${base}`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === "partially_paid"
      ? "Partially paid"
      : status.charAt(0).toUpperCase() + status.slice(1);
  const classes = (() => {
    switch (status) {
      case "paid":
        return "bg-mint-surface text-mint-dark";
      case "partially_paid":
        return "bg-amber-100 text-amber-900";
      case "posted":
        return "bg-surface-recessed text-text-secondary";
      case "void":
        return "bg-gray-100 text-text-tertiary line-through";
      default:
        return "bg-surface-recessed text-text-secondary";
    }
  })();
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro ${classes}`}>
      {label}
    </span>
  );
}

async function fetchInvoices(): Promise<PortalInvoice[]> {
  const cookieHeader = cookies().toString();
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/portal/invoices`,
    { headers: { cookie: cookieHeader }, cache: "no-store" },
  );
  if (res.status === 401) redirect("/portal/login");
  if (!res.ok) return [];
  const json = (await res.json()) as { invoices: PortalInvoice[] };
  return json.invoices;
}

export default async function PortalInvoicesPage() {
  const invoices = await fetchInvoices();

  const openCount = invoices.filter(
    (i) => i.status === "posted" || i.status === "partially_paid",
  ).length;
  const outstanding = invoices.reduce(
    (sum, i) =>
      i.status === "posted" || i.status === "partially_paid"
        ? sum + i.balanceDueCents
        : sum,
    0,
  );

  return (
    <main className="container-p py-10">
      <header>
        <h1 className="text-h1 text-charcoal">Your invoices</h1>
        <p className="mt-2 text-body text-text-secondary">
          {openCount === 0
            ? "You're all caught up — nothing outstanding."
            : `${openCount} invoice${openCount === 1 ? "" : "s"} open · ${formatCurrency(
                outstanding,
                invoices[0]?.currency ?? "LKR",
              )} outstanding`}
        </p>
      </header>

      {invoices.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-8 text-center text-body text-text-secondary">
          No invoices yet.
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-6 py-3 text-left">Number</th>
                <th className="px-6 py-3 text-left">Date</th>
                <th className="px-6 py-3 text-left">Due</th>
                <th className="px-6 py-3 text-right">Total</th>
                <th className="px-6 py-3 text-right">Balance</th>
                <th className="px-6 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {invoices.map((inv) => (
                <tr key={inv.id} className="transition-colors hover:bg-surface-recessed/40">
                  <td className="px-6 py-3">
                    <Link
                      href={`/portal/invoices/${inv.id}`}
                      className="font-medium text-charcoal underline-offset-4 hover:underline"
                    >
                      {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                    </Link>
                    {inv.poNumber && (
                      <p className="text-caption text-text-tertiary">PO {inv.poNumber}</p>
                    )}
                  </td>
                  <td className="px-6 py-3 text-text-secondary">{formatDate(inv.issueDate)}</td>
                  <td className="px-6 py-3 text-text-secondary">{formatDate(inv.dueDate)}</td>
                  <td className="px-6 py-3 text-right tabular-nums text-charcoal">
                    {formatCurrency(inv.totalCents, inv.currency)}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums text-charcoal">
                    {formatCurrency(inv.balanceDueCents, inv.currency)}
                  </td>
                  <td className="px-6 py-3">
                    <StatusBadge status={inv.status} />
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
