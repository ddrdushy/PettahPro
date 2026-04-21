import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewGrnClient } from "./new-grn-client";
import type { Supplier, Item, PurchaseOrderListRow, BillListRow } from "@/lib/api";

export const metadata: Metadata = { title: "New GRN" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [s, i, po, bill] = await Promise.all([
    fetch(`${base}/suppliers`, { headers, cache: "no-store" }),
    fetch(`${base}/items`, { headers, cache: "no-store" }),
    fetch(`${base}/purchase-orders`, { headers, cache: "no-store" }),
    fetch(`${base}/bills`, { headers, cache: "no-store" }),
  ]);
  return {
    suppliers: s.ok ? ((await s.json()) as { suppliers: Supplier[] }).suppliers : [],
    items: i.ok ? ((await i.json()) as { items: Item[] }).items : [],
    purchaseOrders: po.ok ? ((await po.json()) as { purchaseOrders: PurchaseOrderListRow[] }).purchaseOrders : [],
    bills: bill.ok ? ((await bill.json()) as { bills: BillListRow[] }).bills : [],
  };
}

export default async function NewGrnPage() {
  const data = await fetchAll();
  return <NewGrnClient {...data} />;
}
