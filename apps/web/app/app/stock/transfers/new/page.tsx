import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { Item, WarehouseRow } from "@/lib/api";
import { NewTransferClient } from "./new-transfer-client";

export const metadata: Metadata = { title: "New stock transfer" };

async function fetchAll() {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const headers = { cookie: cookies().toString() };
  const [wRes, iRes] = await Promise.all([
    fetch(`${base}/stock/warehouses`, { headers, cache: "no-store" }),
    fetch(`${base}/items`, { headers, cache: "no-store" }),
  ]);
  return {
    warehouses: wRes.ok ? ((await wRes.json()) as { warehouses: WarehouseRow[] }).warehouses : [],
    items: iRes.ok ? ((await iRes.json()) as { items: Item[] }).items : [],
  };
}

export default async function NewStockTransferPage() {
  const data = await fetchAll();
  return <NewTransferClient {...data} />;
}
