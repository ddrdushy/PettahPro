import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewDebitNoteClient } from "./new-debit-note-client";
import type { Supplier, Item, TaxCode, BillListRow } from "@/lib/api";

export const metadata: Metadata = { title: "New debit note" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [s, i, t, bills] = await Promise.all([
    fetch(`${base}/suppliers`, { headers, cache: "no-store" }),
    fetch(`${base}/items`, { headers, cache: "no-store" }),
    fetch(`${base}/tax-codes`, { headers, cache: "no-store" }),
    fetch(`${base}/bills`, { headers, cache: "no-store" }),
  ]);
  return {
    suppliers: s.ok ? ((await s.json()) as { suppliers: Supplier[] }).suppliers : [],
    items: i.ok ? ((await i.json()) as { items: Item[] }).items : [],
    taxCodes: t.ok ? ((await t.json()) as { taxCodes: TaxCode[] }).taxCodes : [],
    bills: bills.ok ? ((await bills.json()) as { bills: BillListRow[] }).bills : [],
  };
}

export default async function NewDebitNotePage({
  searchParams,
}: {
  searchParams: { billId?: string; supplierId?: string };
}) {
  const data = await fetchAll();
  return (
    <NewDebitNoteClient
      {...data}
      initialBillId={searchParams.billId ?? ""}
      initialSupplierId={searchParams.supplierId ?? ""}
    />
  );
}
