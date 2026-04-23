import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CategoriesClient } from "./categories-client";
import type { Account, ItemCategoryNode, TaxCode } from "@/lib/api";

export const metadata: Metadata = { title: "Categories" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [catRes, taxRes, accRes] = await Promise.all([
    fetch(`${base}/item-categories`, { headers, cache: "no-store" }),
    fetch(`${base}/tax-codes`, { headers, cache: "no-store" }),
    fetch(`${base}/coa`, { headers, cache: "no-store" }),
  ]);
  const categories = catRes.ok
    ? ((await catRes.json()) as { categories: ItemCategoryNode[] }).categories
    : [];
  const taxCodes = taxRes.ok
    ? ((await taxRes.json()) as { taxCodes: TaxCode[] }).taxCodes
    : [];
  const accounts = accRes.ok
    ? ((await accRes.json()) as { accounts: Account[] }).accounts
    : [];
  return { categories, taxCodes, accounts };
}

export default async function ItemCategoriesPage() {
  const data = await fetchAll();
  return <CategoriesClient {...data} />;
}
