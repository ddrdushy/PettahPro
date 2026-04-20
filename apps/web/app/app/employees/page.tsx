import type { Metadata } from "next";
import { cookies } from "next/headers";
import { EmployeesClient } from "./employees-client";
import type { EmployeeListRow } from "@/lib/api";

export const metadata: Metadata = { title: "Employees" };

async function fetchEmployees(): Promise<EmployeeListRow[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/employees`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { employees: EmployeeListRow[] };
  return data.employees;
}

export default async function EmployeesPage() {
  const employees = await fetchEmployees();
  return <EmployeesClient initial={employees} />;
}
