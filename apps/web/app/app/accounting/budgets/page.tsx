import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import type { Account, Budget, CostCenter } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { BudgetsClient } from "./budgets-client";

export const metadata: Metadata = { title: "Budgets" };

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchAll(): Promise<{
  budgets: Budget[];
  accounts: Account[];
  costCenters: CostCenter[];
}> {
  const headers = { cookie: cookies().toString() };
  const [b, a, c] = await Promise.all([
    fetch(`${INTERNAL_API}/budgets`, { headers, cache: "no-store" }),
    fetch(`${INTERNAL_API}/coa`, { headers, cache: "no-store" }),
    fetch(`${INTERNAL_API}/cost-centers`, { headers, cache: "no-store" }),
  ]);
  return {
    budgets: b.ok ? ((await b.json()) as { budgets: Budget[] }).budgets : [],
    accounts: a.ok ? ((await a.json()) as { accounts: Account[] }).accounts : [],
    costCenters: c.ok
      ? ((await c.json()) as { costCenters: CostCenter[] }).costCenters.filter(
          (x) => x.isActive,
        )
      : [],
  };
}

export default async function BudgetsPage() {
  const { budgets, accounts, costCenters } = await fetchAll();
  const incomeExpenseAccounts = accounts.filter(
    (a) => a.isActive && (a.accountType === "income" || a.accountType === "expense"),
  );
  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to dashboard
        </Link>
      </div>

      <PageHeader
        eyebrow="Accounting"
        title="Budgets"
        description="Annual amounts per account, optionally split by cost center. The budget vs actual report compares actuals against the prorated annual figure."
      />

      <BudgetsClient
        initialBudgets={budgets}
        accounts={incomeExpenseAccounts}
        costCenters={costCenters}
      />
    </main>
  );
}
