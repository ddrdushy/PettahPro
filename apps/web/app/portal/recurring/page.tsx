import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { PortalRecurringTemplate } from "@/lib/api";

export const metadata: Metadata = { title: "Recurring invoices" };

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

function frequencyLabel(f: string): string {
  return f.charAt(0).toUpperCase() + f.slice(1);
}

async function fetchRecurring(): Promise<PortalRecurringTemplate[]> {
  const cookieHeader = cookies().toString();
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/portal/recurring`,
    { headers: { cookie: cookieHeader }, cache: "no-store" },
  );
  if (res.status === 401) redirect("/portal/login");
  if (!res.ok) return [];
  return ((await res.json()) as { recurring: PortalRecurringTemplate[] }).recurring;
}

export default async function PortalRecurringPage() {
  const templates = await fetchRecurring();

  return (
    <main className="container-p py-10">
      <header>
        <h1 className="text-h1 text-charcoal">Recurring invoices</h1>
        <p className="mt-2 text-body text-text-secondary">
          Standing orders that generate a fresh invoice on a schedule. These are set up on your
          supplier's side — contact them to change or cancel one.
        </p>
      </header>

      {templates.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-8 text-center text-body text-text-secondary">
          No recurring invoices set up.
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-6 py-3 text-left">Schedule</th>
                <th className="px-6 py-3 text-left">Frequency</th>
                <th className="px-6 py-3 text-left">Next run</th>
                <th className="px-6 py-3 text-left">Last run</th>
                <th className="px-6 py-3 text-left">Ends</th>
                <th className="px-6 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="px-6 py-3 font-medium text-charcoal">
                    {t.scheduleName}
                    {t.reference && (
                      <p className="text-caption text-text-tertiary">Ref {t.reference}</p>
                    )}
                  </td>
                  <td className="px-6 py-3 text-text-secondary">{frequencyLabel(t.frequency)}</td>
                  <td className="px-6 py-3 text-text-secondary">{formatDate(t.nextRunDate)}</td>
                  <td className="px-6 py-3 text-text-secondary">{formatDate(t.lastRunDate)}</td>
                  <td className="px-6 py-3 text-text-secondary">{formatDate(t.endDate)}</td>
                  <td className="px-6 py-3">
                    <span
                      className={
                        t.status === "paused"
                          ? "inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-micro text-amber-900"
                          : "inline-flex items-center rounded-full bg-mint-surface px-2 py-0.5 text-micro text-mint-dark"
                      }
                    >
                      {t.status === "paused" ? "Paused" : "Active"}
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
