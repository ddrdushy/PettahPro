import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ExpenseCategoriesClient } from "./expense-categories-client";
import type { Account, ExpenseCategory } from "@/lib/api";

export const metadata: Metadata = { title: "Expense categories" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [catRes, accRes] = await Promise.all([
    fetch(`${base}/expense-categories`, { headers, cache: "no-store" }),
    fetch(`${base}/coa`, { headers, cache: "no-store" }),
  ]);
  const categories = catRes.ok
    ? ((await catRes.json()) as { categories: ExpenseCategory[] }).categories
    : [];
  const accounts = accRes.ok
    ? ((await accRes.json()) as { accounts: Account[] }).accounts
    : [];
  return { categories, accounts };
}

export default async function ExpenseCategoriesPage() {
  const data = await fetchAll();
  return <ExpenseCategoriesClient {...data} />;
}
