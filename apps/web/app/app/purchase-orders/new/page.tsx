import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewPurchaseOrderClient } from "./new-purchase-order-client";
import type { Supplier, Item, TaxCode } from "@/lib/api";

export const metadata: Metadata = { title: "New purchase order" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [s, i, t] = await Promise.all([
    fetch(`${base}/suppliers`, { headers, cache: "no-store" }),
    fetch(`${base}/items`, { headers, cache: "no-store" }),
    fetch(`${base}/tax-codes`, { headers, cache: "no-store" }),
  ]);
  return {
    suppliers: s.ok ? ((await s.json()) as { suppliers: Supplier[] }).suppliers : [],
    items: i.ok ? ((await i.json()) as { items: Item[] }).items : [],
    taxCodes: t.ok ? ((await t.json()) as { taxCodes: TaxCode[] }).taxCodes : [],
  };
}

export default async function NewPurchaseOrderPage() {
  const data = await fetchAll();
  return <NewPurchaseOrderClient {...data} />;
}
