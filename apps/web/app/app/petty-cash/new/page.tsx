import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewPettyCashFloatClient } from "./new-client";
import type { Account, Branch, UserWithRoles } from "@/lib/api";

export const metadata: Metadata = { title: "Open petty cash float" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [a, b, u] = await Promise.all([
    fetch(`${base}/coa`, { headers, cache: "no-store" }),
    fetch(`${base}/branches`, { headers, cache: "no-store" }),
    fetch(`${base}/roles/users`, { headers, cache: "no-store" }),
  ]);
  return {
    accounts: a.ok ? ((await a.json()) as { accounts: Account[] }).accounts : [],
    branches: b.ok ? ((await b.json()) as { branches: Branch[] }).branches : [],
    users: u.ok ? ((await u.json()) as { users: UserWithRoles[] }).users : [],
  };
}

export default async function NewPettyCashFloatPage() {
  const data = await fetchAll();
  return <NewPettyCashFloatClient {...data} />;
}
