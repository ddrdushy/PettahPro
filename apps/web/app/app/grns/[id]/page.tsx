import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { GrnDetailClient } from "./grn-detail-client";
import type { GrnDetail, GrnLine, Supplier } from "@/lib/api";

export const metadata: Metadata = { title: "GRN" };

async function fetchGrn(id: string): Promise<{
  grn: GrnDetail;
  lines: GrnLine[];
  supplier: Supplier | null;
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/grns/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export default async function GrnDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchGrn(params.id);
  if (!data) notFound();
  return <GrnDetailClient {...data} />;
}
