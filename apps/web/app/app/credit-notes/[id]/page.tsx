import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { CreditNoteDetailClient } from "./credit-note-detail-client";
import type {
  CreditNoteDetail,
  CreditNoteLine,
  CreditNoteLinkedInvoice,
  Customer,
} from "@/lib/api";

export const metadata: Metadata = { title: "Credit note" };

async function fetchCN(id: string): Promise<{
  creditNote: CreditNoteDetail;
  lines: CreditNoteLine[];
  customer: Customer | null;
  invoice: CreditNoteLinkedInvoice | null;
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/credit-notes/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return await res.json();
}

export default async function CreditNoteDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchCN(params.id);
  if (!data) notFound();
  return <CreditNoteDetailClient {...data} />;
}
