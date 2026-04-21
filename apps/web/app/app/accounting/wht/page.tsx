import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { Account, WhtSummary } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { WhtClient } from "./wht-client";

export const metadata: Metadata = { title: "WHT" };

async function fetchData(): Promise<{ summary: WhtSummary; bankAccounts: Account[] } | null> {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [wRes, coaRes] = await Promise.all([
    fetch(`${base}/wht`, { headers, cache: "no-store" }),
    fetch(`${base}/coa`, { headers, cache: "no-store" }),
  ]);
  if (!wRes.ok || !coaRes.ok) return null;
  const summary = (await wRes.json()) as WhtSummary;
  const { accounts } = (await coaRes.json()) as { accounts: Account[] };
  const bankAccounts = accounts.filter(
    (a) => a.accountType === "asset" && (a.accountSubtype === "bank" || a.accountSubtype === "cash"),
  );
  return { summary, bankAccounts };
}

export default async function WhtPage() {
  const data = await fetchData();
  if (!data) {
    return (
      <main className="container-p py-10">
        <PageHeader eyebrow="Accounting" title="WHT" description="Couldn't load withholding tax summary." />
      </main>
    );
  }
  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Accounting"
        title="Withholding tax"
        description="What you've withheld from supplier payments and haven't yet remitted to IRD. Lodge the monthly return in ACES, then record it here to clear the balance."
      />
      <WhtClient initialSummary={data.summary} bankAccounts={data.bankAccounts} />
    </main>
  );
}
