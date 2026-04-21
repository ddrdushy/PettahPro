import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { DebitNoteDetailClient } from "./debit-note-detail-client";
import type {
  DebitNoteDetail,
  DebitNoteLine,
  DebitNoteLinkedBill,
  Supplier,
} from "@/lib/api";

export const metadata: Metadata = { title: "Debit note" };

async function fetchDN(id: string): Promise<{
  debitNote: DebitNoteDetail;
  lines: DebitNoteLine[];
  supplier: Supplier | null;
  bill: DebitNoteLinkedBill | null;
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/debit-notes/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return await res.json();
}

export default async function DebitNoteDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchDN(params.id);
  if (!data) notFound();
  return <DebitNoteDetailClient {...data} />;
}
