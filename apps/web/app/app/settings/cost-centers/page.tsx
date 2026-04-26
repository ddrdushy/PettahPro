import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import type { CostCenter } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { CostCentersClient } from "./cost-centers-client";

export const metadata: Metadata = { title: "Cost centers" };

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchCostCenters(): Promise<CostCenter[] | null> {
  const res = await fetch(`${INTERNAL_API}/cost-centers?includeArchived=true`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return ((await res.json()) as { costCenters: CostCenter[] }).costCenters;
}

export default async function CostCentersPage() {
  const items = await fetchCostCenters();
  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/settings" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to settings
        </Link>
      </div>

      <PageHeader
        eyebrow="Admin"
        title="Cost centers"
        description="Tag invoices with a cost center so the P&L can split by branch / project / department. Tag at the document; reports filter from the same dimension."
      />

      {items === null ? (
        <p className="mt-6 text-body text-text-secondary">
          Couldn't load cost centers. Refresh, or contact support.
        </p>
      ) : (
        <CostCentersClient initial={items} />
      )}
    </main>
  );
}
