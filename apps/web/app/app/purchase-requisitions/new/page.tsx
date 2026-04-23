import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewPurchaseRequisitionClient } from "./new-client";
import type { Supplier, Item, Branch } from "@/lib/api";

export const metadata: Metadata = { title: "New purchase requisition" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [s, i, b] = await Promise.all([
    fetch(`${base}/suppliers`, { headers, cache: "no-store" }),
    fetch(`${base}/items`, { headers, cache: "no-store" }),
    fetch(`${base}/branches`, { headers, cache: "no-store" }),
  ]);
  return {
    suppliers: s.ok ? ((await s.json()) as { suppliers: Supplier[] }).suppliers : [],
    items: i.ok ? ((await i.json()) as { items: Item[] }).items : [],
    branches: b.ok ? ((await b.json()) as { branches: Branch[] }).branches : [],
  };
}

export default async function NewPurchaseRequisitionPage() {
  const data = await fetchAll();
  return <NewPurchaseRequisitionClient {...data} />;
}
