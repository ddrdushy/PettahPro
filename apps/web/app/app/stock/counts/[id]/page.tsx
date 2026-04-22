import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { StockCountDetail } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { StockCountClient } from "./stock-count-client";

export const metadata: Metadata = { title: "Stock count" };

async function fetchCount(id: string): Promise<StockCountDetail | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/stock-counts/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return ((await res.json()) as { count: StockCountDetail }).count;
}

export default async function StockCountDetailPage({ params }: { params: { id: string } }) {
  const count = await fetchCount(params.id);
  if (!count) notFound();

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/stock/counts" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to counts
        </Link>
      </div>

      <PageHeader
        eyebrow="Stock"
        title={count.countNumber ?? "Draft stock count"}
        description={
          count.warehouse
            ? `${count.warehouse.code} · ${count.warehouse.name}`
            : undefined
        }
      />

      <StockCountClient count={count} />
    </main>
  );
}
