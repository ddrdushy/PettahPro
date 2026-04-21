import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewDeliveryNoteClient } from "./new-delivery-note-client";
import type { Customer, Item, SalesOrderListRow, InvoiceListRow } from "@/lib/api";

export const metadata: Metadata = { title: "New delivery note" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [c, i, so, inv] = await Promise.all([
    fetch(`${base}/customers`, { headers, cache: "no-store" }),
    fetch(`${base}/items`, { headers, cache: "no-store" }),
    fetch(`${base}/sales-orders`, { headers, cache: "no-store" }),
    fetch(`${base}/invoices`, { headers, cache: "no-store" }),
  ]);
  return {
    customers: c.ok ? ((await c.json()) as { customers: Customer[] }).customers : [],
    items: i.ok ? ((await i.json()) as { items: Item[] }).items : [],
    salesOrders: so.ok ? ((await so.json()) as { salesOrders: SalesOrderListRow[] }).salesOrders : [],
    invoices: inv.ok ? ((await inv.json()) as { invoices: InvoiceListRow[] }).invoices : [],
  };
}

export default async function NewDNPage() {
  const data = await fetchAll();
  return <NewDeliveryNoteClient {...data} />;
}
