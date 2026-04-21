import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewCreditNoteClient } from "./new-credit-note-client";
import type { Customer, Item, TaxCode, InvoiceListRow } from "@/lib/api";

export const metadata: Metadata = { title: "New credit note" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [c, i, t, inv] = await Promise.all([
    fetch(`${base}/customers`, { headers, cache: "no-store" }),
    fetch(`${base}/items`, { headers, cache: "no-store" }),
    fetch(`${base}/tax-codes`, { headers, cache: "no-store" }),
    fetch(`${base}/invoices`, { headers, cache: "no-store" }),
  ]);
  return {
    customers: c.ok ? ((await c.json()) as { customers: Customer[] }).customers : [],
    items: i.ok ? ((await i.json()) as { items: Item[] }).items : [],
    taxCodes: t.ok ? ((await t.json()) as { taxCodes: TaxCode[] }).taxCodes : [],
    invoices: inv.ok ? ((await inv.json()) as { invoices: InvoiceListRow[] }).invoices : [],
  };
}

export default async function NewCreditNotePage({
  searchParams,
}: {
  searchParams: { invoiceId?: string; customerId?: string };
}) {
  const data = await fetchAll();
  return (
    <NewCreditNoteClient
      {...data}
      initialInvoiceId={searchParams.invoiceId ?? ""}
      initialCustomerId={searchParams.customerId ?? ""}
    />
  );
}
