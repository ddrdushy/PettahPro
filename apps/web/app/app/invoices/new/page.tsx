import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewInvoiceClient } from "./new-invoice-client";
import type {
  CommissionSalesperson,
  CostCenter,
  Customer,
  Item,
  TaxCode,
} from "@/lib/api";

export const metadata: Metadata = { title: "New invoice" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [c, i, t, s, cc] = await Promise.all([
    fetch(`${base}/customers`, { headers, cache: "no-store" }),
    fetch(`${base}/items`, { headers, cache: "no-store" }),
    fetch(`${base}/tax-codes`, { headers, cache: "no-store" }),
    fetch(`${base}/commissions/salespeople`, { headers, cache: "no-store" }),
    fetch(`${base}/cost-centers`, { headers, cache: "no-store" }),
  ]);
  return {
    customers: c.ok ? ((await c.json()) as { customers: Customer[] }).customers : [],
    items: i.ok ? ((await i.json()) as { items: Item[] }).items : [],
    taxCodes: t.ok ? ((await t.json()) as { taxCodes: TaxCode[] }).taxCodes : [],
    salespeople: s.ok
      ? ((await s.json()) as { salespeople: CommissionSalesperson[] }).salespeople.filter(
          (x) => x.isActive,
        )
      : [],
    costCenters: cc.ok
      ? ((await cc.json()) as { costCenters: CostCenter[] }).costCenters.filter(
          (x) => x.isActive,
        )
      : [],
  };
}

export default async function NewInvoicePage() {
  const data = await fetchAll();
  return <NewInvoiceClient {...data} />;
}
