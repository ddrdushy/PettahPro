import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { Account, FiscalPeriod } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { PeriodsClient } from "./periods-client";

export const metadata: Metadata = { title: "Fiscal periods" };

async function fetchData(): Promise<{
  periods: FiscalPeriod[];
  equityAccounts: Account[];
} | null> {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [pRes, coaRes] = await Promise.all([
    fetch(`${base}/periods`, { headers, cache: "no-store" }),
    fetch(`${base}/coa`, { headers, cache: "no-store" }),
  ]);
  if (!pRes.ok || !coaRes.ok) return null;
  const { periods } = (await pRes.json()) as { periods: FiscalPeriod[] };
  const { accounts } = (await coaRes.json()) as { accounts: Account[] };
  const equityAccounts = accounts.filter((a) => a.accountType === "equity");
  return { periods, equityAccounts };
}

export default async function PeriodsPage() {
  const data = await fetchData();

  if (!data) {
    return (
      <main className="container-p py-10">
        <PageHeader eyebrow="Accounting" title="Fiscal periods" description="Couldn't load periods." />
      </main>
    );
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Accounting"
        title="Fiscal periods"
        description="Lock a month once you've finalised it — soft-close keeps the books tidy for month-end review, year-end hard-close runs the retained-earnings transfer and freezes the whole year. Both block new postings to that period until reopened."
      />
      <PeriodsClient initialPeriods={data.periods} equityAccounts={data.equityAccounts} />
    </main>
  );
}
