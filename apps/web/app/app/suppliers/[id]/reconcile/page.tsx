import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { Supplier } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { ReconcileClient } from "./reconcile-client";

export const metadata: Metadata = { title: "Reconcile supplier statement" };

async function fetchSupplier(id: string): Promise<Supplier | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/suppliers/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data = (await res.json()) as { supplier: Supplier };
  return data.supplier;
}

export default async function SupplierReconcilePage({ params }: { params: { id: string } }) {
  const supplier = await fetchSupplier(params.id);
  if (!supplier) notFound();

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href={`/app/suppliers/${supplier.id}`} className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to {supplier.name}
        </Link>
      </div>
      <PageHeader
        eyebrow="Reconcile"
        title={`Match ${supplier.name} statement`}
        description="Paste the supplier's open items (one row per line: bill reference, amount — date is optional). We'll compare against our open bills and show where you agree, disagree, and where each side is missing lines."
      />
      <ReconcileClient supplierId={supplier.id} />
    </main>
  );
}
