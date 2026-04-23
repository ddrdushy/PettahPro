import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PettyCashDetailClient } from "./detail-client";
import type {
  PettyCashFloatRow,
  PettyCashTransactionRow,
  PettyCashTopUpRequestRow,
  PettyCashReconciliationRow,
  Account,
  EmployeeListRow,
  UserWithRoles,
  Branch,
} from "@/lib/api";

export const metadata: Metadata = { title: "Petty cash float" };

async function fetchAll(id: string) {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [floatRes, txnsRes, topRes, reconRes, accRes, empRes, usrRes, brRes] =
    await Promise.all([
      fetch(`${base}/petty-cash/floats/${id}`, { headers, cache: "no-store" }),
      fetch(`${base}/petty-cash/floats/${id}/transactions`, {
        headers,
        cache: "no-store",
      }),
      fetch(`${base}/petty-cash/top-up-requests?floatId=${id}`, {
        headers,
        cache: "no-store",
      }),
      fetch(`${base}/petty-cash/floats/${id}/reconciliations`, {
        headers,
        cache: "no-store",
      }),
      fetch(`${base}/coa`, { headers, cache: "no-store" }),
      fetch(`${base}/employees`, { headers, cache: "no-store" }),
      fetch(`${base}/roles/users`, { headers, cache: "no-store" }),
      fetch(`${base}/branches`, { headers, cache: "no-store" }),
    ]);

  if (!floatRes.ok) return null;
  const floatPayload = (await floatRes.json()) as { float: PettyCashFloatRow };

  return {
    float: floatPayload.float,
    transactions: txnsRes.ok
      ? ((await txnsRes.json()) as { transactions: PettyCashTransactionRow[] })
          .transactions
      : [],
    requests: topRes.ok
      ? ((await topRes.json()) as { requests: PettyCashTopUpRequestRow[] })
          .requests
      : [],
    reconciliations: reconRes.ok
      ? ((await reconRes.json()) as {
          reconciliations: PettyCashReconciliationRow[];
        }).reconciliations
      : [],
    accounts: accRes.ok
      ? ((await accRes.json()) as { accounts: Account[] }).accounts
      : [],
    employees: empRes.ok
      ? ((await empRes.json()) as { employees: EmployeeListRow[] }).employees
      : [],
    users: usrRes.ok
      ? ((await usrRes.json()) as { users: UserWithRoles[] }).users
      : [],
    branches: brRes.ok
      ? ((await brRes.json()) as { branches: Branch[] }).branches
      : [],
  };
}

export default async function PettyCashDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await fetchAll(params.id);
  if (!data) notFound();
  return <PettyCashDetailClient {...data} />;
}
