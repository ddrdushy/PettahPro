import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import type { Account } from "@/lib/api";

export const metadata: Metadata = { title: "Chart of accounts" };

async function fetchCoa(): Promise<Account[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/coa`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { accounts: Account[] };
  return data.accounts;
}

const typeBadge: Record<Account["accountType"], string> = {
  asset: "bg-mint-surface text-mint-dark",
  liability: "bg-warning-bg text-warning",
  equity: "bg-surface-recessed text-text-secondary",
  income: "bg-mint-surface text-mint-dark",
  expense: "bg-danger-bg/50 text-danger",
};

export default async function CoaPage() {
  const accounts = await fetchCoa();

  const columns: Column<Account>[] = [
    {
      header: "Code",
      accessor: (a) => <span className="tabular-nums font-medium text-charcoal">{a.code}</span>,
    },
    {
      header: "Name",
      accessor: (a) => (
        <div>
          <p className="text-charcoal">{a.name}</p>
          {a.accountSubtype && (
            <p className="text-caption text-text-tertiary">{a.accountSubtype}</p>
          )}
        </div>
      ),
    },
    {
      header: "Type",
      accessor: (a) => (
        <span className={`rounded-full px-2.5 py-0.5 text-caption capitalize ${typeBadge[a.accountType]}`}>
          {a.accountType}
        </span>
      ),
    },
    {
      header: "Normal",
      align: "center",
      accessor: (a) => <span className="text-caption uppercase text-text-tertiary">{a.normalSide}</span>,
    },
    {
      header: "Currency",
      align: "center",
      accessor: (a) => (
        <span
          className={`text-caption tabular-nums ${
            a.currency && a.currency !== "LKR" ? "font-medium text-mint-dark" : "text-text-tertiary"
          }`}
        >
          {a.currency || "LKR"}
        </span>
      ),
    },
    {
      header: "Source",
      align: "center",
      accessor: (a) =>
        a.isSystem ? (
          <span className="rounded-full bg-surface-recessed px-2 py-0.5 text-caption text-text-secondary">
            System
          </span>
        ) : (
          <span className="text-caption text-text-tertiary">Custom</span>
        ),
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Accounting"
        title="Chart of accounts"
        description="The structure your books post to. We seed an SL-typical template on signup — you can extend or customize as you grow."
      />

      <div className="mt-6">
        <DataTable
          rows={accounts}
          columns={columns}
          empty="No accounts loaded yet."
        />
      </div>

      <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
        <p className="text-small text-text-secondary">
          <span className="font-medium text-charcoal">Heads up —</span> editing and adding accounts will land in the next update. Your tenant defaults are good to go for invoicing.
        </p>
      </div>
    </main>
  );
}
