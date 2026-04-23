import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CommissionsClient } from "./commissions-client";
import type {
  CommissionEarning,
  CommissionLedgerRow,
  CommissionRule,
  CommissionSalesperson,
} from "@/lib/api";

export const metadata: Metadata = { title: "Commissions" };

const INTERNAL = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchFrom<T>(path: string, fallback: T): Promise<T> {
  const res = await fetch(`${INTERNAL}${path}`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return fallback;
  return (await res.json()) as T;
}

export default async function CommissionsPage() {
  const [rules, salespeople, earnings, ledger] = await Promise.all([
    fetchFrom<{ rules: CommissionRule[] }>("/commissions/rules", { rules: [] }),
    fetchFrom<{ salespeople: CommissionSalesperson[] }>(
      "/commissions/salespeople",
      { salespeople: [] },
    ),
    fetchFrom<{ earnings: CommissionEarning[] }>("/commissions/earnings", {
      earnings: [],
    }),
    fetchFrom<{ ledger: CommissionLedgerRow[] }>("/commissions/ledger", {
      ledger: [],
    }),
  ]);

  return (
    <CommissionsClient
      initialRules={rules.rules}
      initialSalespeople={salespeople.salespeople}
      initialEarnings={earnings.earnings}
      initialLedger={ledger.ledger}
    />
  );
}
