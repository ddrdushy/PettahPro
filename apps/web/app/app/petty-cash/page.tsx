import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PettyCashListClient } from "./list-client";
import type { PettyCashFloatRow, Branch, UserWithRoles } from "@/lib/api";

export const metadata: Metadata = { title: "Petty cash" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [f, b, u] = await Promise.all([
    fetch(`${base}/petty-cash/floats`, { headers, cache: "no-store" }),
    fetch(`${base}/branches`, { headers, cache: "no-store" }),
    fetch(`${base}/roles/users`, { headers, cache: "no-store" }),
  ]);
  return {
    floats: f.ok ? ((await f.json()) as { floats: PettyCashFloatRow[] }).floats : [],
    branches: b.ok ? ((await b.json()) as { branches: Branch[] }).branches : [],
    users: u.ok ? ((await u.json()) as { users: UserWithRoles[] }).users : [],
  };
}

export default async function PettyCashPage() {
  const data = await fetchAll();
  return <PettyCashListClient {...data} />;
}
