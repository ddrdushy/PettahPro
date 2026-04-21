import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { Account, OpeningBalanceState } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { OpeningBalanceClient } from "./opening-balance-client";

export const metadata: Metadata = { title: "Opening balance" };

async function fetchData(): Promise<{ state: OpeningBalanceState; accounts: Account[] } | null> {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [obRes, coaRes] = await Promise.all([
    fetch(`${base}/opening-balance`, { headers, cache: "no-store" }),
    fetch(`${base}/coa`, { headers, cache: "no-store" }),
  ]);
  if (!obRes.ok || !coaRes.ok) return null;
  const state = (await obRes.json()) as OpeningBalanceState;
  const { accounts } = (await coaRes.json()) as { accounts: Account[] };
  return { state, accounts };
}

export default async function OpeningBalancePage() {
  const data = await fetchData();
  if (!data) {
    return (
      <main className="container-p py-10">
        <PageHeader eyebrow="Accounting" title="Opening balance" description="Couldn't load opening balance state." />
      </main>
    );
  }
  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Accounting"
        title="Opening balance"
        description="Migrating from BUSY, Tally, or spreadsheets? Enter your closing trial balance from the old system here. Every new invoice and bill you post builds on top — so this is the foundation your whole ledger stands on. Do it once, at setup."
      />
      <OpeningBalanceClient initialState={data.state} accounts={data.accounts} />
    </main>
  );
}
