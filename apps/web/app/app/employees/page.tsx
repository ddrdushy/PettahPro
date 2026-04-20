import type { Metadata } from "next";
import { cookies } from "next/headers";
import { EmployeesClient } from "./employees-client";
import type { EmployeeListRow, SalaryComponent } from "@/lib/api";

export const metadata: Metadata = { title: "Employees" };

async function fetchAll(): Promise<{
  employees: EmployeeListRow[];
  components: SalaryComponent[];
}> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookie = cookies().toString();
  const [empRes, compRes] = await Promise.all([
    fetch(`${base}/employees`, { headers: { cookie }, cache: "no-store" }),
    fetch(`${base}/salary-components`, { headers: { cookie }, cache: "no-store" }),
  ]);
  const employees = empRes.ok
    ? ((await empRes.json()) as { employees: EmployeeListRow[] }).employees
    : [];
  const components = compRes.ok
    ? ((await compRes.json()) as { components: SalaryComponent[] }).components
    : [];
  return { employees, components };
}

export default async function EmployeesPage() {
  const { employees, components } = await fetchAll();
  return <EmployeesClient initial={employees} components={components} />;
}
