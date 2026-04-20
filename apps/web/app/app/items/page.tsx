import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ItemsClient } from "./items-client";
import type { Item, TaxCode } from "@/lib/api";

export const metadata: Metadata = { title: "Items" };

async function fetchAll(): Promise<{ items: Item[]; taxCodes: TaxCode[] }> {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [itemsRes, taxRes] = await Promise.all([
    fetch(`${base}/items`, { headers, cache: "no-store" }),
    fetch(`${base}/tax-codes`, { headers, cache: "no-store" }),
  ]);
  const items = itemsRes.ok ? ((await itemsRes.json()) as { items: Item[] }).items : [];
  const taxCodes = taxRes.ok ? ((await taxRes.json()) as { taxCodes: TaxCode[] }).taxCodes : [];
  return { items, taxCodes };
}

export default async function ItemsPage() {
  const { items, taxCodes } = await fetchAll();
  return <ItemsClient initial={items} taxCodes={taxCodes} />;
}
