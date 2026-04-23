import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { PortalPayment } from "@/lib/api";

export const metadata: Metadata = { title: "Your payments" };

function formatCurrency(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

function methodLabel(m: string): string {
  const map: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank transfer",
    cheque: "Cheque",
    card: "Card",
    lankaqr: "LankaQR",
    payhere: "PayHere",
    frimi: "FriMi",
    genie: "Genie",
    ipay: "iPay",
    other: "Other",
  };
  return map[m] ?? m;
}

async function fetchPayments(): Promise<PortalPayment[]> {
  const cookieHeader = cookies().toString();
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/portal/payments`,
    { headers: { cookie: cookieHeader }, cache: "no-store" },
  );
  if (res.status === 401) redirect("/portal/login");
  if (!res.ok) return [];
  return ((await res.json()) as { payments: PortalPayment[] }).payments;
}

export default async function PortalPaymentsPage() {
  const payments = await fetchPayments();

  return (
    <main className="container-p py-10">
      <header>
        <h1 className="text-h1 text-charcoal">Your payments</h1>
        <p className="mt-2 text-body text-text-secondary">
          Payments we've received from you, and which invoices each one went against.
        </p>
      </header>

      {payments.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-8 text-center text-body text-text-secondary">
          No payments recorded yet.
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-6 py-3 text-left">Receipt</th>
                <th className="px-6 py-3 text-left">Date</th>
                <th className="px-6 py-3 text-left">Method</th>
                <th className="px-6 py-3 text-left">Applied to</th>
                <th className="px-6 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-6 py-3 font-medium text-charcoal">
                    {p.paymentNumber ?? p.id.slice(0, 8)}
                    {p.reference && (
                      <p className="text-caption text-text-tertiary">Ref {p.reference}</p>
                    )}
                  </td>
                  <td className="px-6 py-3 text-text-secondary">{formatDate(p.paymentDate)}</td>
                  <td className="px-6 py-3 text-text-secondary">{methodLabel(p.method)}</td>
                  <td className="px-6 py-3 text-text-secondary">
                    {p.allocations.length === 0
                      ? "Unallocated"
                      : p.allocations
                          .map((a) => a.invoiceNumber ?? a.invoiceId.slice(0, 8))
                          .join(", ")}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums text-charcoal">
                    {formatCurrency(p.amountCents, p.currency)}
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
