import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/app/page-header";
import type { Account } from "@/lib/api";
import { CoaCustomizeClient } from "./coa-customize-client";

export const metadata: Metadata = { title: "Chart of accounts" };

async function fetchCoa(): Promise<Account[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/coa`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { accounts: Account[] };
  return data.accounts;
}

export default async function CoaPage() {
  const accounts = await fetchCoa();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Accounting"
        title="Chart of accounts"
        description="The structure your books post to. We seed a Sri-Lanka-typical template at signup — rename anything, deactivate accounts you don't use, and add custom ones to fit your business. Posted accounts can't be deleted (deactivate to hide them from pickers without losing history)."
      />
      <div className="mt-6">
        <CoaCustomizeClient initialAccounts={accounts} />
      </div>
    </main>
  );
}
