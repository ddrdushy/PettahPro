import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewJournalClient } from "./new-journal-client";
import type { Account, CostCenter, Customer, Supplier } from "@/lib/api";

export const metadata: Metadata = { title: "New journal entry" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [a, c, s, cc] = await Promise.all([
    fetch(`${base}/coa`, { headers, cache: "no-store" }),
    fetch(`${base}/customers`, { headers, cache: "no-store" }),
    fetch(`${base}/suppliers`, { headers, cache: "no-store" }),
    fetch(`${base}/cost-centers`, { headers, cache: "no-store" }),
  ]);
  return {
    accounts: a.ok ? ((await a.json()) as { accounts: Account[] }).accounts : [],
    customers: c.ok ? ((await c.json()) as { customers: Customer[] }).customers : [],
    suppliers: s.ok ? ((await s.json()) as { suppliers: Supplier[] }).suppliers : [],
    costCenters: cc.ok
      ? ((await cc.json()) as { costCenters: CostCenter[] }).costCenters.filter(
          (x) => x.isActive,
        )
      : [],
  };
}

export default async function NewJournalPage() {
  const data = await fetchAll();
  return <NewJournalClient {...data} />;
}
