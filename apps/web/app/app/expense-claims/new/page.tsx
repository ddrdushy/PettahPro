import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewExpenseClaimClient } from "./new-expense-claim-client";
import type { EmployeeListRow, ExpenseCategory } from "@/lib/api";

export const metadata: Metadata = { title: "New expense claim" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [empRes, catRes] = await Promise.all([
    fetch(`${base}/employees`, { headers, cache: "no-store" }),
    fetch(`${base}/expense-categories`, { headers, cache: "no-store" }),
  ]);
  const employees = empRes.ok
    ? ((await empRes.json()) as { employees: EmployeeListRow[] }).employees
    : [];
  const categories = catRes.ok
    ? ((await catRes.json()) as { categories: ExpenseCategory[] }).categories
    : [];
  return {
    employees,
    categories: categories.filter((c) => c.isActive),
  };
}

export default async function NewExpenseClaimPage() {
  const data = await fetchAll();
  return <NewExpenseClaimClient {...data} />;
}
