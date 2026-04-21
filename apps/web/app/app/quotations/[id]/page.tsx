import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { QuotationDetailClient } from "./quotation-detail-client";
import type { QuotationDetail, QuotationLine, Customer } from "@/lib/api";

export const metadata: Metadata = { title: "Quotation" };

async function fetchQuotation(id: string): Promise<{
  quotation: QuotationDetail;
  lines: QuotationLine[];
  customer: Customer | null;
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/quotations/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export default async function QuotationDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchQuotation(params.id);
  if (!data) notFound();
  return <QuotationDetailClient {...data} />;
}
