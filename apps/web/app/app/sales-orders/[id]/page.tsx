import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SalesOrderDetailClient } from "./sales-order-detail-client";
import type { SalesOrderDetail, SalesOrderLine, Customer } from "@/lib/api";

export const metadata: Metadata = { title: "Sales order" };

async function fetchSO(id: string): Promise<{
  salesOrder: SalesOrderDetail;
  lines: SalesOrderLine[];
  customer: Customer | null;
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/sales-orders/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export default async function SOPage({ params }: { params: { id: string } }) {
  const data = await fetchSO(params.id);
  if (!data) notFound();
  return <SalesOrderDetailClient {...data} />;
}
