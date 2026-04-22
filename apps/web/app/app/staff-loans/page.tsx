import type { Metadata } from "next";
import { cookies } from "next/headers";
import { StaffLoansClient } from "./staff-loans-client";
import type { EmployeeLoanRow } from "@/lib/api";

export const metadata: Metadata = { title: "Staff loans" };

async function fetchLoans(): Promise<EmployeeLoanRow[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/employee-loans`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { loans: EmployeeLoanRow[] };
  return data.loans;
}

export default async function StaffLoansPage() {
  const loans = await fetchLoans();
  return <StaffLoansClient loans={loans} />;
}
