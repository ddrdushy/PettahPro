import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewStaffLoanClient } from "./new-staff-loan-client";
import type { EmployeeListRow, LoanType } from "@/lib/api";

export const metadata: Metadata = { title: "New staff loan" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [empRes, ltRes] = await Promise.all([
    fetch(`${base}/employees`, { headers, cache: "no-store" }),
    fetch(`${base}/loan-types`, { headers, cache: "no-store" }),
  ]);
  const employees = empRes.ok
    ? ((await empRes.json()) as { employees: EmployeeListRow[] }).employees
    : [];
  const loanTypes = ltRes.ok
    ? ((await ltRes.json()) as { loanTypes: LoanType[] }).loanTypes
    : [];
  return { employees, loanTypes: loanTypes.filter((t) => t.isActive) };
}

export default async function NewStaffLoanPage() {
  const data = await fetchAll();
  return <NewStaffLoanClient {...data} />;
}
