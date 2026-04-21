import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BankImportDetailClient } from "./bank-import-detail-client";
import type { BankImportDetail, BankStatementLineRow, Account } from "@/lib/api";

export const metadata: Metadata = { title: "Bank reconciliation" };

async function fetchImport(id: string): Promise<{
  import: BankImportDetail;
  bank: Account | null;
  lines: BankStatementLineRow[];
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/bank-reconciliation/imports/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export default async function BankImportDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchImport(params.id);
  if (!data) notFound();
  return <BankImportDetailClient {...data} />;
}
