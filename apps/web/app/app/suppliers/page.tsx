import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SuppliersClient } from "./suppliers-client";
import type { Supplier, TaxCode } from "@/lib/api";

export const metadata: Metadata = { title: "Suppliers" };

async function fetchAll(): Promise<{ suppliers: Supplier[]; whtCodes: TaxCode[] }> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const headers = { cookie: cookies().toString() };
  const [sRes, tRes] = await Promise.all([
    fetch(`${base}/suppliers`, { headers, cache: "no-store" }),
    fetch(`${base}/tax-codes`, { headers, cache: "no-store" }),
  ]);
  const suppliers = sRes.ok ? ((await sRes.json()) as { suppliers: Supplier[] }).suppliers : [];
  const allTax = tRes.ok ? ((await tRes.json()) as { taxCodes: TaxCode[] }).taxCodes : [];
  return { suppliers, whtCodes: allTax.filter((t) => t.taxKind === "wht") };
}

export default async function SuppliersPage() {
  const data = await fetchAll();
  return <SuppliersClient {...data} />;
}
