import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { Customer, Item, TaxCode } from "@/lib/api";
import { NewRecurringInvoiceClient } from "./new-recurring-client";

export const metadata: Metadata = { title: "New recurring invoice" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [c, i, t] = await Promise.all([
    fetch(`${base}/customers`, { headers, cache: "no-store" }),
    fetch(`${base}/items`, { headers, cache: "no-store" }),
    fetch(`${base}/tax-codes`, { headers, cache: "no-store" }),
  ]);
  return {
    customers: c.ok ? ((await c.json()) as { customers: Customer[] }).customers : [],
    items: i.ok ? ((await i.json()) as { items: Item[] }).items : [],
    taxCodes: t.ok ? ((await t.json()) as { taxCodes: TaxCode[] }).taxCodes : [],
  };
}

export default async function NewRecurringInvoicePage() {
  const data = await fetchAll();
  return <NewRecurringInvoiceClient {...data} />;
}
