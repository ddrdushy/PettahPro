import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ExpenseClaimDetailClient } from "./expense-claim-detail-client";
import type { Account, ExpenseClaimRow } from "@/lib/api";

export const metadata: Metadata = { title: "Expense claim" };

async function fetchClaim(id: string): Promise<ExpenseClaimRow | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/expense-claims/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data = (await res.json()) as { claim: ExpenseClaimRow };
  return data.claim;
}

async function fetchAccounts(): Promise<Account[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/coa`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { accounts: Account[] };
  return data.accounts;
}

export default async function ExpenseClaimDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [claim, accounts] = await Promise.all([fetchClaim(params.id), fetchAccounts()]);
  if (!claim) notFound();
  return <ExpenseClaimDetailClient claim={claim} accounts={accounts} />;
}
