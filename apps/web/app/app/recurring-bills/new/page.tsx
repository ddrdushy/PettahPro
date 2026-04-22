import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { Account, Item, Supplier, TaxCode } from "@/lib/api";
import { NewRecurringBillClient } from "./new-recurring-bill-client";

export const metadata: Metadata = { title: "New recurring bill" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [s, i, t, c] = await Promise.all([
    fetch(`${base}/suppliers`, { headers, cache: "no-store" }),
    fetch(`${base}/items`, { headers, cache: "no-store" }),
    fetch(`${base}/tax-codes`, { headers, cache: "no-store" }),
    fetch(`${base}/coa`, { headers, cache: "no-store" }),
  ]);
  const suppliers = s.ok ? ((await s.json()) as { suppliers: Supplier[] }).suppliers : [];
  const items = i.ok ? ((await i.json()) as { items: Item[] }).items : [];
  const taxCodes = t.ok ? ((await t.json()) as { taxCodes: TaxCode[] }).taxCodes : [];
  const accounts = c.ok ? ((await c.json()) as { accounts: Account[] }).accounts : [];
  const expenseAccounts = accounts.filter((a) => a.accountType === "expense");
  // Same filter as new-bill-client — WHT is handled at payment time, not bill time.
  const vatCodes = taxCodes.filter((t) => t.taxKind !== "wht");
  return { suppliers, items, taxCodes: vatCodes, expenseAccounts };
}

export default async function NewRecurringBillPage() {
  const data = await fetchAll();
  return <NewRecurringBillClient {...data} />;
}
