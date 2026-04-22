import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { StaffLoanDetailClient } from "./staff-loan-detail-client";
import type { Account, EmployeeLoanRow, LoanScheduleRow } from "@/lib/api";

export const metadata: Metadata = { title: "Staff loan" };

async function fetchLoan(
  id: string,
): Promise<{ loan: EmployeeLoanRow; schedule: LoanScheduleRow[] } | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/employee-loans/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

async function fetchAccounts(): Promise<Account[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/coa`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { accounts: Account[] };
  return data.accounts;
}

export default async function StaffLoanDetailPage({ params }: { params: { id: string } }) {
  const [data, accounts] = await Promise.all([fetchLoan(params.id), fetchAccounts()]);
  if (!data) notFound();
  return (
    <StaffLoanDetailClient
      loan={data.loan}
      schedule={data.schedule}
      accounts={accounts}
    />
  );
}
