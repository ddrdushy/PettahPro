import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ExpenseClaimsClient } from "./expense-claims-client";
import type { ExpenseClaimRow } from "@/lib/api";

export const metadata: Metadata = { title: "Expense claims" };

async function fetchClaims(): Promise<ExpenseClaimRow[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/expense-claims`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { claims: ExpenseClaimRow[] };
  return data.claims;
}

export default async function ExpenseClaimsPage() {
  const claims = await fetchClaims();
  return <ExpenseClaimsClient claims={claims} />;
}
