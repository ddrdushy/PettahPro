import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewFixedAssetClient } from "./new-fixed-asset-client";
import type { Account, Supplier } from "@/lib/api";

export const metadata: Metadata = { title: "Register asset" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [a, s] = await Promise.all([
    fetch(`${base}/coa`, { headers, cache: "no-store" }),
    fetch(`${base}/suppliers`, { headers, cache: "no-store" }),
  ]);
  return {
    accounts: a.ok ? ((await a.json()) as { accounts: Account[] }).accounts : [],
    suppliers: s.ok ? ((await s.json()) as { suppliers: Supplier[] }).suppliers : [],
  };
}

export default async function NewFixedAssetPage() {
  const data = await fetchAll();
  return <NewFixedAssetClient {...data} />;
}
