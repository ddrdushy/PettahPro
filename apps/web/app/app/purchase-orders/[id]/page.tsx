import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PurchaseOrderDetailClient } from "./purchase-order-detail-client";
import type { PurchaseOrderDetail, PurchaseOrderLine, Supplier } from "@/lib/api";

export const metadata: Metadata = { title: "Purchase order" };

async function fetchPO(id: string): Promise<{
  purchaseOrder: PurchaseOrderDetail;
  lines: PurchaseOrderLine[];
  supplier: Supplier | null;
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/purchase-orders/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export default async function POPage({ params }: { params: { id: string } }) {
  const data = await fetchPO(params.id);
  if (!data) notFound();
  return <PurchaseOrderDetailClient {...data} />;
}
