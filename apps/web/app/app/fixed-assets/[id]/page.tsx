import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type {
  FixedAssetRow,
  FixedAssetDepreciationEntry,
  FixedAssetTaxDepreciationEntry,
} from "@/lib/api";
import { FixedAssetDetailClient } from "./detail-client";

export const metadata: Metadata = { title: "Fixed asset" };

async function fetchAsset(id: string): Promise<{
  asset: FixedAssetRow;
  history: FixedAssetDepreciationEntry[];
  taxHistory: FixedAssetTaxDepreciationEntry[];
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/fixed-assets/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export default async function FixedAssetDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchAsset(params.id);
  if (!data) notFound();
  return (
    <FixedAssetDetailClient
      asset={data.asset}
      history={data.history}
      taxHistory={data.taxHistory}
    />
  );
}
