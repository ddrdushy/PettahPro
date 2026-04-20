import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CustomersClient } from "./customers-client";
import type { Customer } from "@/lib/api";

export const metadata: Metadata = { title: "Customers" };

async function fetchCustomers(): Promise<Customer[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/customers`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { customers: Customer[] };
  return data.customers;
}

export default async function CustomersPage() {
  const initial = await fetchCustomers();
  return <CustomersClient initial={initial} />;
}
