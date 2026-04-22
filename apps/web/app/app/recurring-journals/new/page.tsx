import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { Account, Customer, Supplier } from "@/lib/api";
import { NewRecurringJournalClient } from "./new-recurring-journal-client";

export const metadata: Metadata = { title: "New recurring journal" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [a, c, s] = await Promise.all([
    fetch(`${base}/coa`, { headers, cache: "no-store" }),
    fetch(`${base}/customers`, { headers, cache: "no-store" }),
    fetch(`${base}/suppliers`, { headers, cache: "no-store" }),
  ]);
  const accounts = a.ok ? ((await a.json()) as { accounts: Account[] }).accounts : [];
  const customers = c.ok ? ((await c.json()) as { customers: Customer[] }).customers : [];
  const suppliers = s.ok ? ((await s.json()) as { suppliers: Supplier[] }).suppliers : [];
  const postable = accounts.filter((a) => a.isActive);
  return { accounts: postable, customers, suppliers };
}

export default async function NewRecurringJournalPage() {
  const data = await fetchAll();
  return <NewRecurringJournalClient {...data} />;
}
