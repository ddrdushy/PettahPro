import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewBankImportClient } from "./new-bank-import-client";
import type { Account } from "@/lib/api";

export const metadata: Metadata = { title: "Import bank statement" };

async function fetchBankAccounts(): Promise<Account[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/coa`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { accounts: Account[] };
  return data.accounts.filter(
    (a) => a.accountType === "asset" && (a.accountSubtype === "bank" || a.accountSubtype === "cash") && a.isActive,
  );
}

export default async function NewBankImportPage() {
  const bankAccounts = await fetchBankAccounts();
  return <NewBankImportClient bankAccounts={bankAccounts} />;
}
