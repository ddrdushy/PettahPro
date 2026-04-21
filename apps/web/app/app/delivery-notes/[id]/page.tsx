import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { DeliveryNoteDetailClient } from "./delivery-note-detail-client";
import type { DeliveryNoteDetail, DeliveryNoteLine, Customer } from "@/lib/api";

export const metadata: Metadata = { title: "Delivery note" };

async function fetchDN(id: string): Promise<{
  deliveryNote: DeliveryNoteDetail;
  lines: DeliveryNoteLine[];
  customer: Customer | null;
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/delivery-notes/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export default async function DNPage({ params }: { params: { id: string } }) {
  const data = await fetchDN(params.id);
  if (!data) notFound();
  return <DeliveryNoteDetailClient {...data} />;
}
