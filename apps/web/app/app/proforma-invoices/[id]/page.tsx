import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ProformaDetailClient } from "./proforma-detail-client";
import type {
  Customer,
  ProformaInvoiceDetail,
  ProformaInvoiceLine,
} from "@/lib/api";

export const metadata: Metadata = { title: "Proforma invoice" };

async function fetchProforma(id: string): Promise<{
  proformaInvoice: ProformaInvoiceDetail;
  lines: ProformaInvoiceLine[];
  customer: Customer | null;
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/proforma-invoices/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export default async function ProformaInvoiceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await fetchProforma(params.id);
  if (!data) notFound();
  return <ProformaDetailClient {...data} />;
}
