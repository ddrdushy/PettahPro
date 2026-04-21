import type { Metadata } from "next";
import { cookies } from "next/headers";
import { FixedAssetsClient } from "./fixed-assets-client";
import type { FixedAssetRow } from "@/lib/api";

export const metadata: Metadata = { title: "Fixed assets" };

async function fetchAssets(): Promise<{
  assets: FixedAssetRow[];
  totals: { costCents: number; accumulatedCents: number; netBookValueCents: number; count: number };
}> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/fixed-assets`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) {
    return { assets: [], totals: { costCents: 0, accumulatedCents: 0, netBookValueCents: 0, count: 0 } };
  }
  return res.json();
}

export default async function FixedAssetsPage() {
  const data = await fetchAssets();
  return <FixedAssetsClient {...data} />;
}
