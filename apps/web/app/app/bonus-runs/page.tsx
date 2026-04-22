import type { Metadata } from "next";
import { cookies } from "next/headers";
import { BonusRunsClient } from "./bonus-runs-client";
import type { BonusRunRow } from "@/lib/api";

export const metadata: Metadata = { title: "Bonus runs" };

async function fetchRuns(): Promise<BonusRunRow[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/bonus-runs`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { runs: BonusRunRow[] };
  return data.runs;
}

export default async function BonusRunsPage() {
  const runs = await fetchRuns();
  return <BonusRunsClient runs={runs} />;
}
