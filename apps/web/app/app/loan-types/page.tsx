import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LoanTypesClient } from "./loan-types-client";
import type { LoanType } from "@/lib/api";

export const metadata: Metadata = { title: "Loan types" };

async function fetchLoanTypes(): Promise<LoanType[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/loan-types`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { loanTypes: LoanType[] };
  return data.loanTypes;
}

export default async function LoanTypesPage() {
  const loanTypes = await fetchLoanTypes();
  return <LoanTypesClient initial={loanTypes} />;
}
